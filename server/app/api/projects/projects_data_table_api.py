import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import List

from app.auth.dependencies import get_required_user
from app.database.crud.projects.project_data_table_crud import (
    DataTableJobCreate,
    data_table_job_crud,
    data_table_result_crud,
)
from app.database.crud.projects.project_paper_crud import project_paper_crud
from app.database.database import get_db
from app.database.models import JobStatus
from app.helpers.pdf_jobs import jobs_client
from app.helpers.subscription_limits import can_user_create_data_table_job
from app.schemas.responses import DataTableSchema, DocumentMapping
from app.schemas.user import CurrentUser
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# Maximum time a data table job can run before being marked as failed
MAX_DATA_TABLES_JOB_RUNTIME = timedelta(minutes=10)

# Create API router
projects_data_table_router = APIRouter()


class CreateDataTableRequest(BaseModel):
    project_id: str
    columns: List[str]


@projects_data_table_router.post("")
async def create_data_table(
    request: CreateDataTableRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
) -> JSONResponse:
    """
    Create a data table extraction job for a project.
    """
    try:

        can_create, error_message = can_user_create_data_table_job(db, current_user)
        if not can_create:
            return JSONResponse(
                status_code=403,
                content={"message": error_message},
            )

        papers: List[DocumentMapping] = []

        project_papers = project_paper_crud.get_all_papers_by_project_id(
            db, project_id=uuid.UUID(request.project_id), user=current_user
        )

        for pp in project_papers:
            papers.append(
                DocumentMapping(
                    id=str(pp.id),
                    title=str(pp.title),
                    s3_object_key=str(pp.s3_object_key),
                )
            )

        # Create the job in the database first
        job = data_table_job_crud.create(
            db=db,
            obj_in=DataTableJobCreate(
                project_id=uuid.UUID(request.project_id),
                columns=request.columns,
            ),
            user=current_user,
        )

        if not job:
            return JSONResponse(
                status_code=403,
                content={
                    "message": "Failed to create data table job - permission denied"
                },
            )

        job_id = str(job.id)

        data_table = DataTableSchema(
            columns=request.columns,
            papers=papers,
        )

        # Submit the data table processing job
        task_id = jobs_client.submit_data_table_processing_job(
            data_table=data_table,
            job_id=job_id,
        )

        # Update status to running
        data_table_job_crud.update_status(
            db=db,
            job_id=uuid.UUID(job_id),
            status=JobStatus.RUNNING,
        )

        # Update the job with the task ID
        data_table_job_crud.update_task_id(
            db=db,
            job_id=uuid.UUID(job_id),
            task_id=task_id,
        )

        return JSONResponse(
            status_code=202,
            content={
                "message": "Data table processing job submitted",
                "job_id": job_id,
                "task_id": task_id,
            },
        )
    except Exception as e:
        logger.error(f"Error creating data table job: {e}")
        return JSONResponse(
            status_code=400,
            content={"message": f"Failed to create data table job: {str(e)}"},
        )


@projects_data_table_router.get("/jobs/{project_id}")
async def list_data_table_jobs(
    project_id: str,
    all: bool = False,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
) -> JSONResponse:
    """
    List all pending data table extraction jobs for a given project.
    """
    try:
        jobs = data_table_job_crud.get_by_project(
            db=db,
            project_id=uuid.UUID(project_id),
            user=current_user,
        )

        # Check and update status for pending/running jobs
        for job in jobs:
            if (
                job.status not in (JobStatus.COMPLETED, JobStatus.FAILED)
                and job.task_id
            ):
                try:
                    celery_status = jobs_client.check_celery_task_status(
                        str(job.task_id)
                    )
                    job_age = datetime.now(timezone.utc) - job.created_at

                    # If job has been running longer than max runtime and Celery still shows pending,
                    # assume it's lost and mark as failed
                    if (
                        job_age > MAX_DATA_TABLES_JOB_RUNTIME
                        and celery_status.get("status", "") == JobStatus.PENDING
                    ):
                        data_table_job_crud.update_status(
                            db=db,
                            job_id=uuid.UUID(str(job.id)),
                            status=JobStatus.FAILED,
                        )
                except Exception as e:
                    logger.warning(
                        f"Failed to check Celery task status for {job.task_id}: {e}"
                    )

        if not all:
            # Filter out failed jobs from more than 1 hour ago
            one_hour_ago = datetime.now(timezone.utc) - timedelta(hours=1)
            jobs = [
                job
                for job in jobs
                if not (
                    job.status == JobStatus.FAILED and job.started_at < one_hour_ago
                )
            ]

        job_list = [data_table_job_crud.job_to_dict(job) for job in jobs]

        return JSONResponse(
            status_code=200,
            content={"jobs": job_list},
        )
    except Exception as e:
        logger.error(f"Error listing data table jobs: {e}")
        return JSONResponse(
            status_code=400,
            content={"message": f"Failed to list data table jobs: {str(e)}"},
        )


@projects_data_table_router.get("/{job_id}")
async def get_data_table_job_status(
    job_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
) -> JSONResponse:
    """
    Get the status of a data table extraction job, including real-time Celery task status.
    """
    try:
        job = data_table_job_crud.get(
            db=db,
            id=uuid.UUID(job_id),
            user=current_user,
        )

        if not job:
            return JSONResponse(
                status_code=404,
                content={"message": "Data table job not found"},
            )

        # Get real-time Celery task status if we have a task_id
        celery_task_status = None
        if job.task_id:
            try:
                celery_task_status = jobs_client.check_celery_task_status(
                    str(job.task_id)
                )
            except Exception as e:
                logger.warning(
                    f"Failed to get Celery task status for {job.task_id}: {e}"
                )

        if job.task_id and job.status not in (JobStatus.COMPLETED, JobStatus.FAILED):
            celery_status = jobs_client.check_celery_task_status(str(job.task_id))

            # If job has been "processing" for longer than the max runtime,
            # and Celery has no record of it, assume it's lost
            job_age = datetime.now(timezone.utc) - job.created_at

            if (
                job_age > MAX_DATA_TABLES_JOB_RUNTIME
                and celery_status.get("status", "") == JobStatus.PENDING
            ):
                # Task is too old to still be pending - it's lost
                data_table_job_crud.update_status(
                    db=db, job_id=uuid.UUID(str(job.id)), status=JobStatus.FAILED
                )

        # Build response with both job status and task status
        response_content = {
            "job_id": str(job.id),
            "status": job.status,
            "columns": job.columns,
            "task_id": job.task_id,
            "created_at": job.created_at.isoformat() if job.created_at else None,
            "completed_at": job.completed_at.isoformat() if job.completed_at else None,
            "error_message": job.error_message,
        }

        # Add Celery task information if available
        if celery_task_status:
            response_content.update(
                {
                    "celery_status": celery_task_status.get("status"),
                    "celery_progress_message": celery_task_status.get(
                        "progress_message"
                    ),
                    "celery_error": celery_task_status.get("error"),
                }
            )

        return JSONResponse(status_code=200, content=response_content)
    except Exception as e:
        logger.error(f"Error fetching data table job status: {e}")
        return JSONResponse(
            status_code=400,
            content={"message": f"Failed to fetch data table job status: {str(e)}"},
        )


@projects_data_table_router.get("/results/{result_id}")
async def get_data_table_job_results(
    result_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
) -> JSONResponse:
    """
    Get the results of a completed data table extraction job.
    """
    try:
        result = data_table_result_crud.get(
            db=db,
            id=uuid.UUID(result_id),
            user=current_user,
        )

        if not result:
            return JSONResponse(
                status_code=404,
                content={"message": "Data table results not found"},
            )

        data = data_table_result_crud.result_to_dict(result)

        return JSONResponse(
            status_code=200,
            content={"data": data},
        )
    except Exception as e:
        logger.error(f"Error fetching data table job results: {e}")
        return JSONResponse(
            status_code=400,
            content={"message": f"Failed to fetch data table job results: {str(e)}"},
        )
