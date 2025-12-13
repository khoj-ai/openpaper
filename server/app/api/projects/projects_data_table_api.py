import logging
import uuid
from typing import List

from app.auth.dependencies import get_required_user
from app.database.crud.projects.project_data_table_crud import (
    DataTableJobCreate,
    data_table_job_crud,
    data_table_result_crud,
)
from app.database.crud.projects.project_paper_crud import project_paper_crud
from app.database.database import get_db
from app.helpers.pdf_jobs import jobs_client
from app.schemas.responses import DataTableSchema, DocumentMapping
from app.schemas.user import CurrentUser
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

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

        # Build response with both job status and task status
        response_content = {
            "job_id": str(job.id),
            "status": job.status,
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


@projects_data_table_router.get("/results/{job_id}")
async def get_data_table_job_results(
    job_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
) -> JSONResponse:
    """
    Get the results of a completed data table extraction job.
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

        if job.status != "completed":
            return JSONResponse(
                status_code=400,
                content={"message": "Data table job is not yet completed"},
            )

        result = data_table_result_crud.get_by_job_id(
            db=db,
            job_id=uuid.UUID(job_id),
        )

        if not result:
            return JSONResponse(
                status_code=404,
                content={"message": "Data table job results not found"},
            )

        return JSONResponse(
            status_code=200,
            content={
                "success": result.success,
                "columns": result.columns,
                "rows": result.rows,
                "created_at": (
                    result.created_at.isoformat() if result.created_at else None
                ),
            },
        )
    except Exception as e:
        logger.error(f"Error fetching data table job results: {e}")
        return JSONResponse(
            status_code=400,
            content={"message": f"Failed to fetch data table job results: {str(e)}"},
        )
