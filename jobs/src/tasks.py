"""
Celery tasks for Open Paper jobs
"""
import logging
import psutil
import os
import asyncio
from datetime import datetime, timezone
from typing import Dict, Any, TypeVar, Coroutine
import requests

from src.schemas import DataTableSchema
from src.data_table_processor import construct_data_table
from src.pdf_processor import process_pdf_file
from src.celery_app import celery_app
from src.s3_service import s3_service
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

@celery_app.task(bind=True, name="process_data_table", soft_time_limit=900, time_limit=960)
def construct_data_table_task(
    self,
    data_table: DataTableSchema,
    webhook_url: str
) -> None:
    """
    Celery task to construct a data table based on the provided schema.
    """
    task_id = self.request.id

    def write_to_status(new_status: str):
        """Helper to update task status."""
        logger.info(f"Updating task {task_id} status: {new_status}")
        try:
            self.update_state(state="PROGRESS", meta={"status": new_status})
        except Exception as e:
            logger.error(f"Failed to update task {task_id} status: {e}. New status: {new_status}")

    write_to_status("Starting data table construction")

    data_table = DataTableSchema.model_validate(data_table)

    try:
        result = run_async_safely(
            construct_data_table(
                data_table_schema=data_table,
                status_callback=write_to_status
            )
        )

        write_to_status("Data table construction complete!")

        # Send webhook notification
        webhook_payload = {
            "task_id": task_id,
            "status": "completed" if result[0].success else "failed",
            "result": result[0].model_dump(),
            "error": result[1] if not result[0].success else None,
        }

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
        return

    except Exception as exc:
        logger.error(f"Data table construction task {task_id} failed: {exc}", exc_info=True)

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

            return
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
