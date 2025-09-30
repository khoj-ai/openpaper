import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

from app.auth.dependencies import get_required_user
from app.database.crud.audio_overview_crud import (
    AudioOverviewJobCreate,
    audio_overview_crud,
    audio_overview_job_crud,
)
from app.database.crud.paper_crud import paper_crud
from app.database.database import get_db
from app.database.models import ConversableType, JobStatus, Paper
from app.database.telemetry import track_event
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
    length: Optional[Literal["short", "medium", "long"]] = "medium"
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
    paper: Paper | None = paper_crud.get(
        db, id=id, user=current_user, update_last_accessed=True
    )

    if not paper:
        return JSONResponse(status_code=404, content={"message": "Document not found"})

    paper_uuid = uuid.UUID(str(paper.id))

    # Create the audio overview job
    audio_overview_job = audio_overview_job_crud.create(
        db,
        obj_in=AudioOverviewJobCreate(
            conversable_id=paper_uuid, conversable_type=ConversableType.PAPER
        ),
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

    track_event(
        "audio_overview_requested",
        properties={
            "voice": audio_request.voice or "nova",
            "job_id": str(job_id_as_uuid),
        },
        user_id=str(current_user.id),
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

    # If the audio overview has been running for more than 10 minutes, mark it as failed
    if audio_overview_job.status == JobStatus.RUNNING and audio_overview_job.created_at:
        if (datetime.now(timezone.utc) - audio_overview_job.created_at) > timedelta(
            minutes=10
        ):
            audio_overview_job_crud.update_status(
                db,
                job_id=uuid.UUID(str(audio_overview_job.id)),
                status=JobStatus.FAILED,
                current_user=current_user,
            )
            logger.warning(
                f"Audio overview job {audio_overview_job.id} marked as failed due to timeout."
            )

    # Return the job status
    return JSONResponse(
        status_code=200,
        content={
            "job_id": str(audio_overview_job.id),
            "status": audio_overview_job.status,
            "conversable_id": str(audio_overview_job.conversable_id),
            "conversable_type": audio_overview_job.conversable_type,
        },
    )


@paper_audio_router.get("/all/{id}")
async def get_audio_overviews_by_paper_id(
    request: Request,
    id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """
    Get all audio overviews for a specific paper by ID
    """
    # Fetch the audio overviews from the database
    audio_overviews = audio_overview_crud.get_by_paper_and_user(
        db, paper_id=uuid.UUID(id), current_user=current_user
    )

    if not audio_overviews:
        # If no audio overviews are found, return an empty list
        return JSONResponse(status_code=200, content=[])

    # Convert the audio overviews to a list of dictionaries
    audio_overview_list = [
        audio_overview_crud.overview_to_dict(overview) for overview in audio_overviews
    ]

    return JSONResponse(
        status_code=200,
        content=audio_overview_list,
    )


@paper_audio_router.get("/file/{audio_overview_id}")
async def get_audio_overview_by_id(
    request: Request,
    audio_overview_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """
    Get a specific audio overview by ID
    """
    # Fetch the audio overview from the database
    audio_overview = audio_overview_crud.get(
        db, id=audio_overview_id, user=current_user
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

    # Convert the audio overview to a dictionary
    audio_overview_dict = audio_overview_crud.overview_to_dict(audio_overview)

    audio_overview_dict["audio_url"] = signed_url

    return JSONResponse(
        status_code=200,
        content=audio_overview_dict,
    )


@paper_audio_router.get("/{id}/file")
async def get_mrc_audio_overview_file(
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
    audio_overview = audio_overview_crud.get_mrc_by_paper_and_user(
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
