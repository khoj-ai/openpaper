"""
Celery tasks for PDF processing.
"""
import logging
import tempfile
import base64
import time
import psutil
import os
from datetime import datetime, timezone
from typing import Dict, Any
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed

from src.celery_app import celery_app
from src.schemas import PDFProcessingResult
from src.s3_service import s3_service
from src.parser import extract_text_from_pdf, generate_pdf_preview, map_pages_to_text_offsets
from src.llm_client import llm_client

logger = logging.getLogger(__name__)


def process_pdf_file(
    pdf_bytes: bytes,
    job_id: str
) -> PDFProcessingResult:
    """
    Process a PDF file by extracting metadata and uploading to S3.

    Args:
        pdf_bytes: The PDF file content as bytes
        filename: Original filename
        job_id: Job ID for tracking

    Returns:
        PDFProcessingResult: Processing results
    """
    start_time = datetime.now(timezone.utc)

    try:
        logger.info(f"Starting PDF processing for job {job_id}")

        # Save the PDF to a temporary file
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as temp_file:
            temp_file.write(pdf_bytes)
            temp_file_path = temp_file.name

            # Sanitize filename
            safe_filename = f"pdf-{job_id}.pdf"

            # Extract text content from PDF first (needed for metadata extraction)
            try:
                pdf_text = extract_text_from_pdf(temp_file_path)
                logger.info(f"Extracted {len(pdf_text)} characters of text from PDF")
                page_offsets = map_pages_to_text_offsets(temp_file_path)
            except Exception as e:
                logger.error(f"Failed to extract text from PDF: {e}")
                raise Exception(f"Failed to extract text from PDF: {e}")

            # Define functions for parallel execution
            def upload_pdf():
                return s3_service.upload_any_file(
                    temp_file_path, safe_filename, "application/pdf"
                )

            def generate_preview():
                try:
                    return generate_pdf_preview(temp_file_path)
                except Exception as e:
                    logger.warning(f"Failed to generate preview for {safe_filename}: {str(e)}")
                    return None, None

            def extract_metadata():
                try:
                    return llm_client.extract_paper_metadata(pdf_text)
                except Exception as e:
                    logger.error(f"Error extracting metadata: {str(e)}")
                    raise Exception(f"Failed to extract metadata: {str(e)}")

            # Execute operations in parallel
            with ThreadPoolExecutor(max_workers=3) as executor:
                # Submit all tasks
                future_to_operation = {
                    executor.submit(upload_pdf): 'upload_pdf',
                    executor.submit(generate_preview): 'generate_preview',
                    executor.submit(extract_metadata): 'extract_metadata'
                }

                # Collect results
                object_key = None
                file_url = None
                preview_object_key = None
                preview_url = None
                metadata = None

                for future in as_completed(future_to_operation):
                    operation = future_to_operation[future]
                    try:
                        result = future.result()
                        if operation == 'upload_pdf':
                            object_key, file_url = result
                            logger.info(f"Uploaded PDF to S3: {file_url}")
                        elif operation == 'generate_preview':
                            preview_object_key, preview_url = result
                            if preview_url:
                                logger.info(f"Generated preview for {safe_filename}: {preview_url}")
                        elif operation == 'extract_metadata':
                            metadata = result
                            logger.info(f"Successfully extracted metadata for {safe_filename}")
                    except Exception as e:
                        if operation == 'upload_pdf':
                            logger.error(f"Failed to upload PDF: {e}")
                            raise e
                        elif operation == 'extract_metadata':
                            logger.error(f"Failed to extract metadata: {e}")
                            raise e
                        # Preview generation failure is non-critical, already logged

            # Process the publication date if available
            if metadata and metadata.publish_date:
                try:
                    # Try different date formats
                    for date_format in ["%Y-%m-%d", "%Y", "%Y-%m"]:
                        try:
                            if date_format == "%Y" and metadata.publish_date.isdigit() and len(metadata.publish_date) == 4:
                                metadata.publish_date = f"{metadata.publish_date}-01-01"
                            parsed_date = datetime.strptime(metadata.publish_date, "%Y-%m-%d")
                            metadata.publish_date = parsed_date.strftime("%Y-%m-%d")
                            break
                        except ValueError:
                            continue
                except Exception:
                    logger.warning(f"Could not parse date: {metadata.publish_date}")
                    metadata.publish_date = None

            end_time = datetime.now(timezone.utc)
            duration = (end_time - start_time).total_seconds()

            logger.info(f"PDF processing completed successfully for {safe_filename} in {duration:.2f} seconds")

            # Clean up temporary file
            try:
                os.unlink(temp_file_path)
            except Exception as cleanup_error:
                logger.warning(f"Failed to clean up temporary file: {str(cleanup_error)}")

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

        # Clean up temporary file
        try:
            if 'temp_file_path' in locals():
                os.unlink(temp_file_path)
        except Exception as cleanup_error:
            logger.warning(f"Failed to clean up temporary file: {str(cleanup_error)}")

        # Clean up S3 objects if they were created
        try:
            if 'object_key' in locals() and object_key:
                s3_service.delete_file(object_key)
            if 'preview_object_key' in locals() and preview_object_key:
                s3_service.delete_file(preview_object_key)
        except Exception as cleanup_error:
            logger.warning(f"Failed to clean up S3 objects: {str(cleanup_error)}")

        return PDFProcessingResult(
            success=False,
            error=str(e),
            job_id=job_id,
        )


@celery_app.task(bind=True, name="upload_and_process_file")
def upload_and_process_file(
    self,
    pdf_base64: str,
    webhook_url: str,
    **processing_kwargs
) -> Dict[str, Any]:
    """
    Process a PDF file from base64 string and send results to webhook.

    Args:
        pdf_base64: The PDF file content as base64 string
        filename: Original filename
        webhook_url: URL to send processing results to
        **processing_kwargs: Additional parameters for PDF processing

    Returns:
        Dict containing task results
    """
    task_id = self.request.id

    pdf_bytes = base64.b64decode(pdf_base64)

    try:
        logger.info(f"Starting PDF processing for task {task_id}")

        # Update task state to PROGRESS
        self.update_state(
            state="PROGRESS",
            meta={
                "status": "Processing PDF file",
                "progress": 0
            }
        )

        # Process the PDF file
        logger.info(f"has some pdf bytes: {len(pdf_bytes)}")
        result = process_pdf_file(pdf_bytes, task_id)

        # Update progress
        self.update_state(
            state="PROGRESS",
            meta={
                "status": "PDF processing complete, sending webhook",
                "progress": 90
            }
        )

        # Prepare webhook payload
        webhook_payload = {
            "task_id": task_id,
            "status": "completed" if result.success else "failed",
            "result": result.model_dump(),
            "error": result.error if not result.success else None
        }

        # Send webhook notification
        retries = 3
        backoff_factor = 0.5
        for i in range(retries):
            try:
                response = requests.post(
                    webhook_url,
                    json=webhook_payload,
                    timeout=60,
                    headers={"Content-Type": "application/json"}
                )
                response.raise_for_status()
                logger.info(f"Webhook sent successfully for task {task_id}")
                break
            except requests.RequestException as e:
                logger.warning(f"Webhook attempt {i+1}/{retries} failed for task {task_id}: {e}")
                if i < retries - 1:
                    time.sleep(backoff_factor * (2 ** i))
                else:
                    logger.error(f"Failed to send webhook for task {task_id} after {retries} retries.")
                    webhook_payload["webhook_error"] = str(e)

        logger.info(f"Task {task_id} completed successfully")
        return webhook_payload

    except Exception as exc:
        logger.error(f"Task {task_id} failed: {exc}")

        # Send failure webhook
        failure_payload = {
            "task_id": task_id,
            "status": "failed",
            "result": None,
            "error": str(exc)
        }

        try:
            response = requests.post(
                webhook_url,
                json=failure_payload,
                timeout=60,
                headers={"Content-Type": "application/json"}
            )
            response.raise_for_status()
        except requests.RequestException:
            logger.error(f"Failed to send failure webhook for task {task_id}")

        # Re-raise the exception to mark task as failed
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
