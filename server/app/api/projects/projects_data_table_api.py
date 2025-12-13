import logging
import uuid
from typing import List

from app.auth.dependencies import get_required_user
from app.database.crud.projects.project_paper_crud import project_paper_crud
from app.database.database import get_db
from app.helpers.pdf_jobs import pdf_jobs_client
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
        # Generate a random job ID
        job_id = uuid.uuid4().hex

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

        data_table = DataTableSchema(
            columns=request.columns,
            job_id=job_id,
            papers=papers,
        )

        # Submit the data table processing job
        task_id = pdf_jobs_client.submit_data_table_processing_job(
            data_table=data_table,
            job_id=job_id,
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
