"""
Paper Upload API - Microservice Integration

This module handles PDF upload and processing by integrating with a separate
PDF processing microservice. The architecture is:

1. Client uploads PDF to this API
2. API creates a PaperUploadJob record with status 'pending'
3. API submits the PDF to the separate jobs service via Celery/HTTP
4. Jobs service processes PDF (S3 upload, metadata extraction, preview generation)
5. Jobs service sends results back via webhook
6. Webhook handler updates PaperUploadJob status and creates Paper record

The client can poll the job status using the same job_id throughout the process.
"""

import logging
from datetime import datetime, timezone
from typing import Union

import requests
from app.auth.dependencies import get_required_user
from app.database.crud.paper_crud import paper_crud
from app.database.crud.paper_upload_crud import (
    PaperUploadJobCreate,
    PaperUploadJobUpdate,
    paper_upload_job_crud,
)
from app.database.database import get_db
from app.database.models import PaperUploadJob
from app.database.telemetry import track_event
from app.helpers.pdf_jobs import pdf_jobs_client
from app.helpers.s3 import s3_service
from app.helpers.subscription_limits import (
    can_user_access_knowledge_base,
    can_user_upload_paper,
)
from app.schemas.user import CurrentUser
from dotenv import load_dotenv
from fastapi import APIRouter, BackgroundTasks, Depends, File, Request, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, HttpUrl
from sqlalchemy.orm import Session

load_dotenv()

logger = logging.getLogger(__name__)

# Create API router with prefix
paper_upload_router = APIRouter()


class UploadFromUrlSchema(BaseModel):
    url: HttpUrl


@paper_upload_router.get("/status/{job_id}")
async def get_upload_status(
    job_id: str,
    current_user: CurrentUser = Depends(get_required_user),
    db: Session = Depends(get_db),
):
    """
    Get the status of a paper upload job, including real-time Celery task status.
    """
    paper_upload_job = paper_upload_job_crud.get(db=db, id=job_id, user=current_user)

    if not paper_upload_job:
        return JSONResponse(status_code=404, content={"message": "Job not found"})

    paper = paper_crud.get_by_upload_job_id(
        db=db, upload_job_id=str(paper_upload_job.id), user=current_user
    )

    if paper_upload_job.status == "completed":
        # Verify the paper exists
        if not paper:
            return JSONResponse(status_code=404, content={"message": "Paper not found"})

    # Get real-time Celery task status if we have a task_id
    celery_task_status = None
    if paper_upload_job.task_id:
        try:
            celery_task_status = pdf_jobs_client.check_celery_task_status(
                str(paper_upload_job.task_id)
            )
        except Exception as e:
            logger.warning(
                f"Failed to get Celery task status for {paper_upload_job.task_id}: {e}"
            )

    # Build response with both job status and task status
    response_content = {
        "job_id": str(paper_upload_job.id),
        "status": paper_upload_job.status,
        "task_id": paper_upload_job.task_id,
        "started_at": paper_upload_job.started_at.isoformat(),
        "completed_at": (
            paper_upload_job.completed_at.isoformat()
            if paper_upload_job.completed_at
            else None
        ),
        "has_file_url": bool(paper.file_url) if paper else False,
        "has_metadata": bool(paper.abstract) if paper else False,
        "paper_id": str(paper.id) if paper else None,
    }

    # Add Celery task information if available
    if celery_task_status:
        response_content.update(
            {
                "celery_status": celery_task_status.get("status"),
                "celery_progress_message": celery_task_status.get("progress_message"),
                "celery_error": celery_task_status.get("error"),
            }
        )

    return JSONResponse(status_code=200, content=response_content)


@paper_upload_router.post("/from-url/")
async def upload_pdf_from_url(
    request: UploadFromUrlSchema,
    background_tasks: BackgroundTasks,
    current_user: CurrentUser = Depends(get_required_user),
    db: Session = Depends(get_db),
):
    """
    Upload a document from a given URL, rather than the raw file.
    """

    # Check subscription limits before proceeding
    err_message = await check_subscription_limits(current_user, db)
    if err_message:
        return JSONResponse(
            status_code=403,
            content={
                "message": err_message,
                "error_code": "SUBSCRIPTION_LIMIT_EXCEEDED",
            },
        )

    # Validate the URL
    url = request.url
    if not url or not str(url).lower().endswith(".pdf"):
        return JSONResponse(status_code=400, content={"message": "URL must be a PDF"})

    # Create the paper upload job
    paper_upload_job_obj = PaperUploadJobCreate(
        started_at=datetime.now(timezone.utc),
    )

    paper_upload_job: PaperUploadJob = paper_upload_job_crud.create(
        db=db,
        obj_in=paper_upload_job_obj,
        user=current_user,
    )

    if not paper_upload_job:
        return JSONResponse(
            status_code=500,
            content={"message": "Failed to create paper upload job"},
        )

    background_tasks.add_task(
        upload_file_from_url_microservice,
        url=url,
        paper_upload_job=paper_upload_job,
        current_user=current_user,
        db=db,
    )

    return JSONResponse(
        status_code=202,
        content={
            "message": "File upload started",
            "job_id": str(paper_upload_job.id),
        },
    )


@paper_upload_router.post("/")
async def upload_pdf(
    request: Request,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(get_required_user),
    db: Session = Depends(get_db),
):
    """
    Upload a PDF file
    """
    # Check subscription limits before proceeding
    err_message = await check_subscription_limits(current_user, db)
    if err_message:
        return JSONResponse(
            status_code=403,
            content={
                "message": err_message,
                "error_code": "SUBSCRIPTION_LIMIT_EXCEEDED",
            },
        )

    if not file.filename or not file.filename.lower().endswith(".pdf"):
        return JSONResponse(status_code=400, content={"message": "File must be a PDF"})

    # Read the file contents BEFORE adding to background task. We need this because the UploadFile object becomes inaccessible after the request is processed.
    try:
        file_contents = await file.read()
        filename = file.filename
    except Exception as e:
        logger.error(f"Error reading uploaded file: {str(e)}", exc_info=True)
        return JSONResponse(
            status_code=400, content={"message": "Error reading uploaded file"}
        )

    # Create the paper upload job
    paper_upload_job_obj = PaperUploadJobCreate(
        started_at=datetime.now(timezone.utc),
    )

    paper_upload_job: PaperUploadJob = paper_upload_job_crud.create(
        db=db,
        obj_in=paper_upload_job_obj,
        user=current_user,
    )

    if not paper_upload_job:
        return JSONResponse(
            status_code=500,
            content={"message": "Failed to create paper upload job"},
        )

    # Pass file contents and filename instead of the UploadFile object
    background_tasks.add_task(
        upload_raw_file_microservice,
        file_contents=file_contents,
        filename=filename,
        paper_upload_job=paper_upload_job,
        current_user=current_user,
        db=db,
    )

    return JSONResponse(
        status_code=202,
        content={
            "message": "File upload started",
            "job_id": str(paper_upload_job.id),
        },
    )


async def upload_file_from_url_microservice(
    url: HttpUrl,
    paper_upload_job: PaperUploadJob,
    current_user: CurrentUser,
    db: Session,
) -> None:
    """
    Helper function to upload a file from a URL using the microservice.
    """

    paper_upload_job_crud.mark_as_running(
        db=db,
        job_id=str(paper_upload_job.id),
        user=current_user,
    )

    try:
        # Download the file to get its contents
        response = requests.get(str(url), timeout=30)
        response.raise_for_status()
        file_contents = response.content

        # Submit to microservice
        task_id = await pdf_jobs_client.submit_pdf_processing_job_with_upload(
            pdf_bytes=file_contents,
            paper_upload_job=paper_upload_job,
            db=db,
            user=current_user,
        )

        # Update job with task_id
        paper_upload_job_crud.update(
            db=db,
            db_obj=paper_upload_job,
            obj_in=PaperUploadJobUpdate(task_id=task_id),
            user=current_user,
        )

    except Exception as e:
        logger.error(
            f"Error submitting file from URL to microservice: {str(e)}", exc_info=True
        )
        paper_upload_job_crud.mark_as_failed(
            db=db,
            job_id=str(paper_upload_job.id),
            user=current_user,
        )


async def check_subscription_limits(
    current_user: CurrentUser,
    db: Session,
) -> Union[str, None]:
    """
    Check if the user can upload a new paper based on their subscription limits.
    Returns a JSONResponse with an error message if limits are exceeded.
    """
    can_upload, error_message = can_user_upload_paper(db, current_user)
    if not can_upload and error_message:
        return error_message

    can_access, error_message = can_user_access_knowledge_base(db, current_user)
    if not can_access and error_message:
        return error_message

    return None


async def upload_raw_file_microservice(
    file_contents: bytes,
    filename: str,
    paper_upload_job: PaperUploadJob,
    current_user: CurrentUser,
    db: Session,
) -> None:
    """
    Helper function to upload a raw file using the microservice.
    """

    if not filename or not filename.lower().endswith(".pdf"):
        paper_upload_job_crud.mark_as_failed(
            db=db,
            job_id=str(paper_upload_job.id),
            user=current_user,
        )
        return

    paper_upload_job_crud.mark_as_running(
        db=db,
        job_id=str(paper_upload_job.id),
        user=current_user,
    )

    try:
        # Submit to microservice
        task_id = await pdf_jobs_client.submit_pdf_processing_job_with_upload(
            pdf_bytes=file_contents,
            paper_upload_job=paper_upload_job,
            db=db,
            user=current_user,
        )

        # Update job with task_id
        paper_upload_job_crud.update(
            db=db,
            db_obj=paper_upload_job,
            obj_in=PaperUploadJobUpdate(task_id=task_id),
            user=current_user,
        )

        # Track paper upload event
        track_event(
            "paper_upload_submitted_to_microservice",
            properties={
                "task_id": task_id,
            },
            user_id=str(current_user.id),
        )

    except Exception as e:
        logger.error(f"Error submitting file to microservice: {str(e)}", exc_info=True)
        paper_upload_job_crud.mark_as_failed(
            db=db,
            job_id=str(paper_upload_job.id),
            user=current_user,
        )
