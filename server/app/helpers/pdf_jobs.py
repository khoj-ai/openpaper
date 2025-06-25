"""
PDF Jobs Client for integrating with the separate PDF processing jobs service.

This client connects to the Celery broker to submit PDF processing tasks
to the separate jobs service worker, and uses the HTTP API to check task status.
"""

import base64
import os
from typing import Any, Dict, Optional

import requests
from celery import Celery
from dotenv import load_dotenv

load_dotenv()


class PDFJobsClient:
    """Client for submitting PDF processing jobs to the separate Celery service."""

    def __init__(
        self,
        webhook_base_url: Optional[str] = None,
        celery_broker_url: Optional[str] = None,
        celery_api_url: Optional[str] = None,
    ):
        """
        Initialize the client.

        Args:
            webhook_base_url: The base URL where your app receives webhooks
                             (e.g., "https://your-app.com")
            celery_broker_url: Redis/RabbitMQ URL where Celery tasks are queued
            celery_api_url: Base URL of the Celery API service for status checks
                           (e.g., "http://localhost:8001")
        """
        self.webhook_base_url = webhook_base_url or os.getenv(
            "WEBHOOK_BASE_URL", "http://localhost:8000"
        )
        self.celery_broker_url = celery_broker_url or os.getenv(
            "CELERY_BROKER_URL", "redis://localhost:6379"
        )
        self.celery_api_url = celery_api_url or os.getenv(
            "CELERY_API_URL", "http://localhost:8001"
        )

    def submit_pdf_processing_job(self, pdf_bytes: bytes, job_id: str) -> str:
        """
        Submit a PDF processing job to the separate Celery service.

        Args:
            pdf_bytes: The PDF file content as bytes
            job_id: Your internal job ID for tracking

        Returns:
            str: Celery task ID

        Raises:
            ImportError: If Celery is not available
            Exception: If task submission fails
        """
        # Validate input data
        if pdf_bytes is None:
            raise ValueError("pdf_bytes cannot be None")
        if not isinstance(pdf_bytes, bytes):
            raise ValueError(f"pdf_bytes must be bytes, got {type(pdf_bytes)}")
        if len(pdf_bytes) == 0:
            raise ValueError("pdf_bytes cannot be empty")

        print(
            f"DEBUG: Submitting PDF job - Size: {len(pdf_bytes)} bytes, Job ID: {job_id}"
        )

        # Connect to Celery broker directly to submit task
        try:
            # Create Celery app instance (this connects to the broker, not the worker code)
            celery_app = Celery("pdf_jobs", broker=self.celery_broker_url)

            # Configure Celery to be more tolerant of connection issues
            celery_app.conf.update(
                broker_connection_retry_on_startup=True,
                broker_connection_retry=True,
                broker_connection_max_retries=3,
                task_serializer="json",
                accept_content=["json"],
                result_serializer="json",
                task_always_eager=False,
            )

            # Build webhook URL that includes your job ID
            webhook_url = (
                f"{self.webhook_base_url}/api/webhooks/paper-processing/{job_id}"
            )
            print(f"DEBUG: Webhook URL: {webhook_url}")

            # Encode bytes to base64 string for JSON serialization
            pdf_base64 = base64.b64encode(pdf_bytes).decode("utf-8")
            print(f"DEBUG: Base64 encoded length: {len(pdf_base64)} characters")

            # Submit the task to the queue (the separate jobs service will pick it up)
            task = celery_app.send_task(
                "upload_and_process_file",  # Task name as registered by the worker
                kwargs={"pdf_base64": pdf_base64, "webhook_url": webhook_url},
            )

            print(f"DEBUG: Task submitted successfully with ID: {task.id}")
            return task.id
        except Exception as e:
            # Provide more specific error information
            error_msg = str(e)
            print(f"DEBUG: Task submission failed: {error_msg}")
            if "ACCESS_REFUSED" in error_msg:
                raise Exception(
                    f"Failed to authenticate with message broker. Please check your CELERY_BROKER_URL "
                    f"and ensure it includes proper credentials. Current URL: {self.celery_broker_url[:20]}... "
                    f"Error: {error_msg}"
                ) from e
            else:
                raise Exception(
                    f"Failed to submit PDF processing job: {error_msg}"
                ) from e

    def check_celery_task_status(self, task_id: str) -> Dict[str, Any]:
        """
        Check the status of a Celery task using the HTTP API.

        Args:
            task_id: The Celery task ID to check

        Returns:
            Dict containing task status information
        """
        try:
            # Make HTTP request to the Celery API service
            response = requests.get(
                f"{self.celery_api_url}/task/{task_id}/status", timeout=10
            )
            response.raise_for_status()

            task_status = response.json()

            # Transform the API response to match our expected format
            return {
                "task_id": task_status.get("task_id", task_id),
                "status": task_status.get("status", "unknown"),
                "result": task_status.get("result"),
                "meta": task_status.get("meta"),
                "error": task_status.get("error"),
                "progress": task_status.get("progress"),
                "progress_message": task_status.get("progress_message"),
            }

        except requests.exceptions.RequestException as e:
            return {
                "task_id": task_id,
                "status": "API_ERROR",
                "error": f"Failed to connect to Celery API: {str(e)}",
            }
        except Exception as e:
            return {
                "task_id": task_id,
                "status": "ERROR",
                "error": f"Unexpected error checking task status: {str(e)}",
            }

    def cancel_celery_task(self, task_id: str) -> Dict[str, Any]:
        """
        Cancel a Celery task using the HTTP API.

        Args:
            task_id: The Celery task ID to cancel

        Returns:
            Dict containing cancellation result
        """
        try:
            response = requests.delete(
                f"{self.celery_api_url}/task/{task_id}", timeout=10
            )
            response.raise_for_status()

            return {
                "task_id": task_id,
                "status": "cancelled",
                "message": response.json().get(
                    "message", "Task cancelled successfully"
                ),
            }

        except requests.exceptions.RequestException as e:
            return {
                "task_id": task_id,
                "status": "CANCEL_ERROR",
                "error": f"Failed to cancel task via API: {str(e)}",
            }
        except Exception as e:
            return {
                "task_id": task_id,
                "status": "ERROR",
                "error": f"Unexpected error cancelling task: {str(e)}",
            }


# Create a client instance to use throughout the application
pdf_jobs_client = PDFJobsClient()
