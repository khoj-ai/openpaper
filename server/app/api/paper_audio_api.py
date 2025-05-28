import logging
import uuid
from typing import Literal, Optional

from app.auth.dependencies import get_required_user
from app.database.crud.audio_overview_crud import (
    AudioOverviewJobCreate,
    audio_overview_crud,
    audio_overview_job_crud,
)
from app.database.crud.paper_crud import paper_crud
from app.database.database import get_db
from app.database.models import Paper
from app.helpers.s3 import s3_service
from app.schemas.user import CurrentUser
from app.tasks.audio_overview import generate_audio_overview_async
from dotenv import load_dotenv
from fastapi import APIRouter, BackgroundTasks, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

load_dotenv()

logger = logging.getLogger(__name__)

# Create API router with prefix
paper_audio_router = APIRouter()


class AudioOverviewCreateRequest(BaseModel):
    additional_instructions: Optional[str] = None
    voice: Optional[
        Literal[
            "alloy",
            "ash",
            "ballad",
            "coral",
            "echo",
            "fable",
            "onyx",
            "nova",
            "sage",
            "shimmer",
            "verse",
        ]
    ] = None


@paper_audio_router.post("/")
async def create_audio_overview(
    request: Request,
    id: str,
    audio_request: AudioOverviewCreateRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """
    Create audio overview by ID
    """
    # Fetch the document from the database
    paper: Paper | None = paper_crud.get(db, id=id, user=current_user)

    if not paper:
        return JSONResponse(status_code=404, content={"message": "Document not found"})

    paper_uuid = uuid.UUID(str(paper.id))

    # Create the audio overview job
    audio_overview_job = audio_overview_job_crud.create(
        db,
        obj_in=AudioOverviewJobCreate(paper_id=paper_uuid),
        current_user=current_user,
    )

    if not audio_overview_job:
        return JSONResponse(
            status_code=500,
            content={"message": "Failed to create audio overview job"},
        )

    job_id_as_uuid = uuid.UUID(str(audio_overview_job.id))
    logger.info(f"Created audio overview job with ID: {job_id_as_uuid}")

    # Add the audio generation task as a background task
    background_tasks.add_task(
        generate_audio_overview_async,
        paper_id=paper_uuid,
        user=current_user,
        audio_overview_job_id=job_id_as_uuid,
        additional_instructions=audio_request.additional_instructions,
        voice=audio_request.voice or "nova",
        db=db,
    )

    # Return the job ID immediately so the client can track progress
    return JSONResponse(
        status_code=202,
        content={
            "message": "Audio overview generation started",
            "job_id": str(job_id_as_uuid),
            "status": audio_overview_job.status,
        },
    )


@paper_audio_router.get("/{id}/status")
async def get_audio_overview_job_status(
    request: Request,
    id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """
    Get the status of the audio overview job by ID
    """
    # Fetch the audio overview job from the database
    audio_overview_job = audio_overview_job_crud.get_by_paper_and_user(
        db, paper_id=uuid.UUID(id), current_user=current_user
    )

    if not audio_overview_job:
        return JSONResponse(status_code=404, content={"message": "Job not found"})

    # Return the job status
    return JSONResponse(
        status_code=200,
        content={
            "job_id": str(audio_overview_job.id),
            "status": audio_overview_job.status,
            "paper_id": str(audio_overview_job.paper_id),
        },
    )


@paper_audio_router.get("/{id}/file")
async def get_audio_overview_file(
    request: Request,
    id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """
    Get the audio overview file by ID
    """
    # Fetch the audio overview job from the database
    audio_overview_job = audio_overview_job_crud.get_by_paper_and_user(
        db, paper_id=uuid.UUID(id), current_user=current_user
    )

    if not audio_overview_job:
        return JSONResponse(status_code=404, content={"message": "Job not found"})

    # Fetch the audio overview from the database
    audio_overview = audio_overview_crud.get_by_paper_and_user(
        db, paper_id=uuid.UUID(id), current_user=current_user
    )

    if not audio_overview:
        return JSONResponse(
            status_code=404, content={"message": "Audio overview not found"}
        )

    # Generate a presigned URL for the audio file
    signed_url = s3_service.generate_presigned_url(
        object_key=str(audio_overview.s3_object_key),
    )

    if not signed_url:
        return JSONResponse(status_code=404, content={"message": "File not found"})

    obj = audio_overview_crud.overview_to_dict(audio_overview)

    obj["audio_url"] = signed_url
    obj["job_id"] = str(audio_overview_job.id)

    return JSONResponse(
        status_code=200,
        content=obj,
    )
