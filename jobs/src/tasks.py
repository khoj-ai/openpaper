"""
Celery tasks for PDF processing.
"""
import logging
import tempfile
import base64
import time
import psutil
import os
import asyncio
from datetime import datetime, timezone
from typing import Dict, Any, Callable
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed

from src.celery_app import celery_app
from src.schemas import PDFProcessingResult, PaperMetadataExtraction
from src.s3_service import s3_service
from src.parser import extract_text_from_pdf, generate_pdf_preview, map_pages_to_text_offsets
from src.llm_client import llm_client

logger = logging.getLogger(__name__)


async def process_pdf_file(
    pdf_bytes: bytes,
    job_id: str,
    status_callback: Callable[[str], None],
) -> PDFProcessingResult:
    """
    Process a PDF file by extracting metadata and uploading to S3.

    Args:
        pdf_bytes: The PDF file content as bytes
        job_id: Job ID for tracking
        status_callback: Function to update task status

    Returns:
        PDFProcessingResult: Processing results
    """
    start_time = datetime.now(timezone.utc)
    temp_file_path = None
    object_key = None
    preview_object_key = None

    try:
        logger.info(f"Starting PDF processing for job {job_id}")

        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as temp_file:
            temp_file.write(pdf_bytes)
            temp_file_path = temp_file.name

        safe_filename = f"pdf-{job_id}.pdf"

        # Extract text and page offsets from PDF
        try:
            pdf_text = extract_text_from_pdf(temp_file_path)
            status_callback(f"Processed bits and bytes")
            logger.info(f"Extracted {len(pdf_text)} characters of text from PDF")
            page_offsets = map_pages_to_text_offsets(temp_file_path)
        except Exception as e:
            logger.error(f"Failed to extract text from PDF: {e}")
            raise Exception(f"Failed to extract text from PDF: {e}")

        # Define async functions for I/O-bound operations
        async def upload_pdf_async():
            status_callback("PDF ascending to the cloud")
            return await asyncio.to_thread(
                s3_service.upload_any_file,
                temp_file_path,
                safe_filename,
                "application/pdf"
            )

        async def generate_preview_async():
            status_callback("Taking a snapshot")
            try:
                return await asyncio.to_thread(generate_pdf_preview, temp_file_path)
            except Exception as e:
                logger.warning(f"Failed to generate preview for {safe_filename}: {str(e)}")
                return None, None

        # Run I/O-bound tasks and LLM extraction concurrently
        upload_task = asyncio.create_task(upload_pdf_async())
        preview_task = asyncio.create_task(generate_preview_async())
        metadata_task = asyncio.create_task(
            llm_client.extract_paper_metadata(
                pdf_text, status_callback=status_callback
            )
        )

        # Await all tasks
        results = await asyncio.gather(
            upload_task,
            preview_task,
            metadata_task,
            return_exceptions=True
        )

        # Process results
        upload_result, preview_result, metadata_result = results

        if isinstance(upload_result, Exception):
            logger.error(f"Failed to upload PDF: {upload_result}")
            raise upload_result
        object_key, file_url = upload_result # type: ignore
        logger.info(f"Uploaded PDF to S3: {file_url}")

        if isinstance(preview_result, Exception):
            logger.warning(f"Failed to generate preview: {preview_result}")
            preview_object_key, preview_url = None, None
        else:
            preview_object_key, preview_url = preview_result # type: ignore
            if preview_url:
                logger.info(f"Generated preview for {safe_filename}: {preview_url}")

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
            s3_object_key=object_key,
            file_url=file_url,
            preview_url=preview_url,
            preview_object_key=preview_object_key,
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
    pdf_base64: str,
    webhook_url: str,
    **processing_kwargs
) -> Dict[str, Any]:
    """
    Process a PDF file from base64 string and send results to webhook.
    """
    task_id = self.request.id
    pdf_bytes = base64.b64decode(pdf_base64)

    def write_to_status(new_status: str):
        """Helper to update task status."""
        logger.info(f"Updating task {task_id} status: {new_status}")
        try:
            self.update_state(state="PROGRESS", meta={"status": new_status})
        except Exception as e:
            logger.error(f"Failed to update task {task_id} status: {e}. New status: {new_status}")

    try:
        logger.info(f"Starting PDF processing for task {task_id}")
        write_to_status("Processing PDF file")

        # Run the async processing function
        result = asyncio.run(
            process_pdf_file(pdf_bytes, task_id, status_callback=write_to_status)
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
