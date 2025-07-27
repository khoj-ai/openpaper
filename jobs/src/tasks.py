"""
Celery tasks for PDF processing.
"""
import logging
import tempfile
import psutil
import os
import asyncio
from datetime import datetime, timezone
from typing import Dict, Any, Callable, TypeVar, Coroutine, List
import requests

from src.celery_app import celery_app
from src.schemas import PDFProcessingResult, PaperMetadataExtraction, PDFImage
from src.s3_service import s3_service
from src.parser import extract_text_and_images_combined, generate_pdf_preview, map_pages_to_text_offsets, extract_captions_for_images
from src.llm_client import llm_client
from src.utils import time_it

logger = logging.getLogger(__name__)

T = TypeVar('T')

def run_async_safely(coro: Coroutine[Any, Any, T]) -> T:
    """
    Run an async function safely in a Celery task by creating a new event loop.

    This ensures proper cleanup of the event loop to avoid "Event loop is closed" errors.

    Args:
        coro: Coroutine to run

    Returns:
        The result of the coroutine
    """
    # Store the old loop if one exists
    try:
        old_loop = asyncio.get_event_loop()
    except RuntimeError:
        old_loop = None

    # Create a new event loop for this task
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    try:
        # Run the coroutine and return its result
        return loop.run_until_complete(coro)
    finally:
        try:
            # Properly clean up pending tasks
            pending = asyncio.all_tasks(loop)
            for task in pending:
                task.cancel()

            # Run the event loop until all tasks are done
            if pending:
                loop.run_until_complete(
                    asyncio.gather(*pending, return_exceptions=True)
                )

            # Shutdown async generators
            if not loop.is_closed():
                loop.run_until_complete(loop.shutdown_asyncgens())

        except Exception as e:
            logger.warning(f"Error during event loop cleanup: {e}")

        finally:
            # Close the event loop
            try:
                if not loop.is_closed():
                    loop.close()
            except Exception as e:
                logger.warning(f"Error closing event loop: {e}")

            # Restore the old event loop if it was valid
            if old_loop is not None and not old_loop.is_closed():
                asyncio.set_event_loop(old_loop)


async def process_pdf_file(
    pdf_bytes: bytes,
    s3_object_key: str,
    job_id: str,
    status_callback: Callable[[str], None],
    extract_images: bool = True,
) -> PDFProcessingResult:
    """
    Process a PDF file by extracting metadata from bytes.

    Args:
        pdf_bytes: The PDF file content as bytes
        s3_object_key: The S3 object key of the PDF file
        job_id: Job ID for tracking
        status_callback: Function to update task status

    Returns:
        PDFProcessingResult: Processing results
    """
    start_time = datetime.now(timezone.utc)
    temp_file_path = None
    preview_object_key = None
    extracted_images: List[PDFImage] = []

    try:
        logger.info(f"Starting PDF processing for job {job_id}")

        # Write to temporary file
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as temp_file:
            temp_file.write(pdf_bytes)
            temp_file_path = temp_file.name

        safe_filename = f"pdf-{job_id}.pdf"

        # Extract text and page offsets from PDF
        try:
            async with time_it("Extracting text, images, and page offsets from PDF", job_id=job_id):
                pdf_text, extracted_images, placeholder_to_path = await extract_text_and_images_combined(
                    temp_file_path,
                    job_id,
                    extract_images=extract_images
                )
                status_callback(f"Processed bits and bytes")
                logger.info(f"Extracted {len(pdf_text)} characters of text from PDF")
                page_offsets = map_pages_to_text_offsets(temp_file_path)
        except Exception as e:
            logger.error(f"Failed to extract text from PDF: {e}")
            raise Exception(f"Failed to extract text from PDF: {e}")

        # Define async functions for I/O-bound operations
        logger.info(f"About to define async functions for job {job_id}")

        async def generate_preview_async():
            status_callback("Taking a snapshot")
            try:
                return await asyncio.to_thread(generate_pdf_preview, temp_file_path)
            except Exception as e:
                logger.warning(f"Failed to generate preview for {safe_filename}: {str(e)}")
                return None, None

        async def extract_images_async():
            if extract_images:
                status_callback("Extracting images from PDF")
                logger.info(f"About to call extract_images_from_pdf for job {job_id}")
                try:
                    result = await extract_captions_for_images(
                        images=extracted_images,
                        file_path=temp_file_path,
                        image_id_to_location=placeholder_to_path,
                    )
                    logger.info(f"extract_images_from_pdf returned {len(result) if result else 0} images")
                    return result
                except Exception as e:
                    logger.error(f"Failed to extract images from {safe_filename}: {str(e)}", exc_info=True)
                    return []
            else:
                logger.info(f"Image extraction skipped for {safe_filename}")
                return []

        # Run I/O-bound tasks and LLM extraction concurrently
        async with time_it("Running I/O-bound tasks and LLM extraction concurrently", job_id=job_id):
            preview_task = asyncio.create_task(generate_preview_async())
            images_task = asyncio.create_task(extract_images_async())
            metadata_task = asyncio.create_task(
                llm_client.extract_paper_metadata(
                    pdf_text, job_id=job_id, status_callback=status_callback
                )
            )

            # Await all tasks
            results = await asyncio.gather(
                preview_task,
                images_task,
                metadata_task,
                return_exceptions=True
            )

        # Process results
        preview_result, images_result, metadata_result = results

        # Generate file URL from the existing S3 object key
        file_url = f"https://{s3_service.cloudflare_bucket_name}/{s3_object_key}"
        logger.info(f"PDF already uploaded to S3: {file_url}")

        if isinstance(preview_result, Exception):
            logger.warning(f"Failed to generate preview: {preview_result}")
            preview_object_key, preview_url = None, None
        else:
            preview_object_key, preview_url = preview_result # type: ignore
            if preview_url:
                logger.info(f"Generated preview for {safe_filename}: {preview_url}")

        if isinstance(images_result, Exception):
            logger.warning(f"Failed to extract images: {images_result}")
            extracted_images = []
        elif isinstance(images_result, list):
            extracted_images = images_result
            # Filter out images that do not have a valid caption
            extracted_images = [img for img in extracted_images if img.caption]
            if extracted_images:
                logger.info(f"Successfully extracted {len(extracted_images)} images from {safe_filename}")
            else:
                logger.info(f"No images found in {safe_filename}")
        else:
            extracted_images = []

        if isinstance(metadata_result, Exception):
            logger.error(f"Failed to extract metadata: {metadata_result}")
            raise metadata_result
        metadata: PaperMetadataExtraction = metadata_result # type: ignore
        logger.info(f"Successfully extracted metadata for {safe_filename}")

        # Process publication date
        if metadata and metadata.publish_date:
            try:
                # Simplified date parsing logic
                parsed_date = datetime.fromisoformat(metadata.publish_date.replace("Z", "+00:00"))
                metadata.publish_date = parsed_date.strftime("%Y-%m-%d")
            except (ValueError, TypeError):
                logger.warning(f"Could not parse date: {metadata.publish_date}, setting to None")
                metadata.publish_date = None

        end_time = datetime.now(timezone.utc)
        duration = (end_time - start_time).total_seconds()

        logger.info(f"PDF processing completed successfully for {safe_filename} in {duration:.2f} seconds")

        return PDFProcessingResult(
            success=True,
            metadata=metadata,
            s3_object_key=s3_object_key,
            file_url=file_url,
            preview_url=preview_url,
            preview_object_key=preview_object_key,
            extracted_images=extracted_images,
            job_id=job_id,
            raw_content=pdf_text,
            page_offset_map=page_offsets,
            duration=duration,
        )

    except Exception as e:
        logger.error(f"PDF processing failed for {job_id}: {str(e)}", exc_info=True)
        # Cleanup logic remains the same
        return PDFProcessingResult(
            success=False,
            error=str(e),
            job_id=job_id,
        )
    finally:
        # Clean up temporary file
        if temp_file_path and os.path.exists(temp_file_path):
            try:
                os.unlink(temp_file_path)
            except Exception as cleanup_error:
                logger.warning(f"Failed to clean up temporary file: {str(cleanup_error)}")


@celery_app.task(bind=True, name="upload_and_process_file")
def upload_and_process_file(
    self,
    s3_object_key: str,
    webhook_url: str,
    **processing_kwargs
) -> Dict[str, Any]:
    """
    Process a PDF file from S3 object key and send results to webhook.
    """
    task_id = self.request.id

    def write_to_status(new_status: str):
        """Helper to update task status."""
        logger.info(f"Updating task {task_id} status: {new_status}")
        try:
            self.update_state(state="PROGRESS", meta={"status": new_status})
        except Exception as e:
            logger.error(f"Failed to update task {task_id} status: {e}. New status: {new_status}")

    try:
        logger.info(f"Starting PDF processing for task {task_id}")
        write_to_status("Downloading PDF from S3")

        # Download PDF from S3
        async def download_with_timer():
            async with time_it("Downloading PDF from S3", job_id=task_id):
                return s3_service.download_file_to_bytes(s3_object_key)

        pdf_bytes = run_async_safely(download_with_timer())

        write_to_status("Processing PDF file")

        # Run the async processing function in a way that properly manages the event loop
        # This prevents "Event loop is closed" errors
        result = run_async_safely(
            process_pdf_file(
                pdf_bytes,
                s3_object_key,
                task_id,
                status_callback=write_to_status,
                extract_images=False,
            )
        )

        write_to_status("PDF processing complete!")

        webhook_payload = {
            "task_id": task_id,
            "status": "completed" if result.success else "failed",
            "result": result.model_dump(),
            "error": result.error if not result.success else None,
        }

        # Send webhook notification
        try:
            response = requests.post(
                webhook_url,
                json=webhook_payload,
                timeout=60,
                headers={"Content-Type": "application/json"},
            )
            response.raise_for_status()
            logger.info(f"Webhook sent successfully for task {task_id}")
        except requests.RequestException as e:
            logger.error(f"Failed to send webhook for task {task_id}: {e}")
            webhook_payload["webhook_error"] = str(e)

        logger.info(f"Task {task_id} completed successfully")
        return webhook_payload

    except Exception as exc:
        logger.error(f"Task {task_id} failed: {exc}", exc_info=True)
        # Send failure webhook
        failure_payload = {
            "task_id": task_id,
            "status": "failed",
            "result": None,
            "error": str(exc),
        }
        try:
            requests.post(
                webhook_url,
                json=failure_payload,
                timeout=60,
                headers={"Content-Type": "application/json"},
            ).raise_for_status()
        except requests.RequestException as e:
            logger.error(f"Failed to send failure webhook for task {task_id}: {e}")

        # Re-raise the exception to mark task as failed in Celery
        raise exc


@celery_app.task(bind=True, name="health_check")
def health_check(self):
    """
    Health check task to monitor worker status.
    Returns system metrics and worker health status.
    """
    try:
        # Get system metrics
        memory_info = psutil.virtual_memory()
        cpu_percent = psutil.cpu_percent(interval=1)
        disk_usage = psutil.disk_usage('/')

        # Get process info
        process = psutil.Process(os.getpid())
        process_memory = process.memory_info()

        health_data = {
            "status": "healthy",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "worker_id": self.request.hostname,
            "task_id": self.request.id,
            "system_metrics": {
                "memory_percent": memory_info.percent,
                "memory_available_mb": memory_info.available / (1024 * 1024),
                "cpu_percent": cpu_percent,
                "disk_percent": disk_usage.percent,
            },
            "process_metrics": {
                "memory_mb": process_memory.rss / (1024 * 1024),
                "cpu_percent": process.cpu_percent(),
                "num_threads": process.num_threads(),
            }
        }

        # Check if worker is unhealthy
        if (memory_info.percent > 90 or
            cpu_percent > 95 or
            process_memory.rss / (1024 * 1024) > 1500):  # 1.5GB
            health_data["status"] = "unhealthy"
            health_data["alert"] = "High resource usage detected"

        return health_data

    except Exception as e:
        logger.error(f"Health check failed: {str(e)}")
        return {
            "status": "unhealthy",
            "error": str(e),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "worker_id": self.request.hostname,
        }
