"""
PDF Jobs Client for integrating with the separate PDF processing jobs service.

This client connects to the Celery broker to submit PDF processing tasks
to the separate jobs service worker, and uses the HTTP API to check task status.
"""

import logging
import os
import time
from io import BytesIO
from typing import Any, Dict, Optional
from uuid import UUID

import requests
from app.database.crud.paper_crud import PaperCreate, paper_crud
from app.database.crud.projects.project_paper_crud import (
    ProjectPaperCreate,
    project_paper_crud,
)
from app.database.models import PaperUploadJob
from app.database.telemetry import track_event
from app.helpers.s3 import s3_service
from app.schemas.user import CurrentUser
from celery import Celery
from dotenv import load_dotenv
from sqlalchemy.orm import Session

load_dotenv()

logger = logging.getLogger(__name__)


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

    def submit_pdf_processing_job(self, s3_object_key: str, job_id: str) -> str:
        """
        Submit a PDF processing job to the separate Celery service.

        Args:
            s3_object_key: The S3 object key for the PDF file
            job_id: Your internal job ID for tracking

        Returns:
            str: Celery task ID

        Raises:
            ImportError: If Celery is not available
            Exception: If task submission fails
        """
        # Validate input data
        if s3_object_key is None:
            raise ValueError("s3_object_key cannot be None")
        if not isinstance(s3_object_key, str):
            raise ValueError(f"s3_object_key must be str, got {type(s3_object_key)}")
        if len(s3_object_key) == 0:
            raise ValueError("s3_object_key cannot be empty")

        print(
            f"DEBUG: Submitting PDF job - S3 Object Key: {s3_object_key}, Job ID: {job_id}"
        )

        # Connect to Celery broker directly to submit task
        try:
            # Create Celery app instance (this connects to the broker, not the worker code)
            celery_app = Celery("openpaper_tasks", broker=self.celery_broker_url)

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

            # Submit the task to the queue (the separate jobs service will pick it up)
            task = celery_app.send_task(
                "upload_and_process_file",  # Task name as registered by the worker
                kwargs={"s3_object_key": s3_object_key, "webhook_url": webhook_url},
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

    async def submit_pdf_processing_job_with_upload(
        self,
        pdf_bytes: bytes,
        paper_upload_job: PaperUploadJob,
        db: Session,
        user: CurrentUser,
        project_id: Optional[UUID] = None,
    ) -> str:
        """
        Upload a PDF file to S3 and submit a processing job.

        Args:
            pdf_bytes: The PDF file content as bytes
            job_id: Your internal job ID for tracking

        Returns:
            tuple: (Celery task ID, S3 object key)

        Raises:
            ValueError: If input validation fails
            Exception: If upload or task submission fails
        """

        # Validate input data
        if pdf_bytes is None:
            raise ValueError("pdf_bytes cannot be None")
        if not isinstance(pdf_bytes, bytes):
            raise ValueError(f"pdf_bytes must be bytes, got {type(pdf_bytes)}")
        if len(pdf_bytes) == 0:
            raise ValueError("pdf_bytes cannot be empty")

        job_id = str(paper_upload_job.id)

        # Generate filename based on job_id
        filename = f"{job_id}.pdf"

        logger.info(
            f"Uploading PDF and submitting job - Size: {len(pdf_bytes)} bytes, Filename: {filename}, Job ID: {job_id}"
        )

        # Track created resources for potential rollback
        s3_object_key: Optional[str] = None
        created_paper = None
        created_project_paper = None

        try:
            # Upload PDF to S3
            file_obj = BytesIO(pdf_bytes)

            # Start timer for S3 upload
            upload_start_time = time.time()
            s3_object_key, file_url = await s3_service.upload_file(file_obj, filename)
            upload_end_time = time.time()
            upload_duration = upload_end_time - upload_start_time

            logger.debug(f"PDF uploaded to S3 with key: {s3_object_key}")
            logger.info(f"S3 upload took {upload_duration:.2f} seconds")

            track_event(
                "timer:initial_pdf_upload_for_microservice",
                user_id=job_id,
                properties={
                    "duration": upload_duration,
                },
                sync=True,
            )

            new_paper = PaperCreate(
                file_url=file_url,
                s3_object_key=s3_object_key,
                upload_job_id=str(job_id),
            )

            created_paper = paper_crud.create(
                db=db,
                obj_in=new_paper,
                user=user,
            )

            if not created_paper:
                raise Exception(
                    "Failed to create paper record after S3 upload. Check permissions or if the paper already exists."
                )

            if project_id and created_paper.id:
                casted_uuid = UUID(str(created_paper.id))

                # Create project paper association if project_id is provided
                created_project_paper = project_paper_crud.create(
                    db=db,
                    obj_in=ProjectPaperCreate(paper_id=casted_uuid),
                    user=user,
                    project_id=project_id,
                )

                if not created_project_paper:
                    raise Exception(
                        "Failed to associate paper with project. Check permissions or if the paper already exists in the project."
                    )

            # Submit processing job with S3 object key
            task_id = self.submit_pdf_processing_job(s3_object_key, job_id)

            return task_id

        except Exception as e:
            error_msg = str(e)
            logger.error(
                f"PDF upload and job submission failed: {error_msg}", exc_info=True
            )

            # Rollback: Clean up created resources
            logger.info("Rolling back created resources due to task submission failure")

            # Remove project paper association if it was created
            if created_project_paper and project_id and created_paper:
                try:
                    project_paper_crud.remove_by_paper_and_project(
                        db=db,
                        paper_id=UUID(str(created_paper.id)),
                        project_id=project_id,
                        user=user,
                    )
                    logger.info(
                        f"Rolled back project paper association for paper {created_paper.id}"
                    )
                except Exception as rollback_error:
                    logger.error(
                        f"Failed to rollback project paper association: {rollback_error}"
                    )

            # Remove paper record if it was created
            if created_paper and created_paper.id:
                try:
                    paper_crud.remove(db=db, id=created_paper.id, user=user)
                    logger.info(f"Rolled back paper record with ID {created_paper.id}")
                except Exception as rollback_error:
                    logger.error(f"Failed to rollback paper record: {rollback_error}")

            # Delete S3 file if it was uploaded
            if s3_object_key:
                try:
                    s3_service.delete_file(s3_object_key)
                    logger.info(f"Rolled back S3 file with key {s3_object_key}")
                except Exception as rollback_error:
                    logger.error(f"Failed to rollback S3 file: {rollback_error}")

            raise Exception(
                f"Failed to upload PDF and submit processing job: {error_msg}"
            ) from e


# Create a client instance to use throughout the application
pdf_jobs_client = PDFJobsClient()
