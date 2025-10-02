import logging
import uuid
from datetime import datetime, timedelta, timezone

from app.api.paper_audio_api import AudioOverviewCreateRequest
from app.auth.dependencies import get_required_user
from app.database.crud.audio_overview_crud import (
    AudioOverviewJobCreate,
    audio_overview_crud,
    audio_overview_job_crud,
)
from app.database.crud.paper_crud import paper_crud
from app.database.crud.projects.project_crud import project_crud
from app.database.database import get_db
from app.database.models import ConversableType, JobStatus
from app.database.telemetry import track_event
from app.helpers.s3 import s3_service
from app.helpers.subscription_limits import can_user_create_audio_overview
from app.schemas.user import CurrentUser
from app.tasks.audio_overview import generate_audio_overview_async
from dotenv import load_dotenv
from fastapi import APIRouter, BackgroundTasks, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

load_dotenv()

logger = logging.getLogger(__name__)

# Create API router with prefix
project_audio_router = APIRouter()


@project_audio_router.post("/{project_id}")
async def create_project_audio_overview(
    request: Request,
    project_id: str,
    audio_request: AudioOverviewCreateRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """
    Create audio overview for a project by ID
    """
    # Fetch the project from the database
    can_create, reason = can_user_create_audio_overview(db, current_user)

    if not can_create:
        logger.warning(
            f"User {current_user.id} attempted to create an audio overview but was denied: {reason}"
        )
        return JSONResponse(
            status_code=403,
            content={
                "message": "Audio overview creation limit reached. Please upgrade your subscription plan."
            },
        )

    project = project_crud.get(db, id=project_id, user=current_user)

    if not project:
        return JSONResponse(status_code=404, content={"message": "Project not found"})

    project_uuid = uuid.UUID(str(project.id))

    # Create the audio overview job
    audio_overview_job = audio_overview_job_crud.create(
        db,
        obj_in=AudioOverviewJobCreate(
            conversable_id=project_uuid, conversable_type=ConversableType.PROJECT
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
        project_id=project_uuid,
        user=current_user,
        audio_overview_job_id=job_id_as_uuid,
        additional_instructions=audio_request.additional_instructions,
        voice=audio_request.voice or "nova",
        length=audio_request.length,
        db=db,
    )

    track_event(
        "audio_overview_requested",
        properties={
            "voice": audio_request.voice or "nova",
            "job_id": str(job_id_as_uuid),
            "conversable_type": "project",
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


@project_audio_router.get("/{id}")
async def get_project_audio_overviews(
    request: Request,
    id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """
    Get all audio overviews for a specific project by ID
    """
    # Fetch the audio overviews from the database
    audio_overviews = audio_overview_crud.get_by_project_and_user(
        db, project_id=uuid.UUID(id), current_user=current_user
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


@project_audio_router.get("/jobs/{project_id}")
async def get_audio_overview_jobs_by_project_id(
    request: Request,
    project_id: str,
    all: bool = False,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """
    Get all audio overview jobs for a specific project by ID
    """
    # Fetch the audio overview jobs from the database
    audio_overview_jobs = audio_overview_job_crud.get_by_project_and_user(
        db,
        project_id=uuid.UUID(project_id),
        current_user=current_user,
    )

    if not audio_overview_jobs:
        # If no audio overview jobs are found, return an empty list
        return JSONResponse(status_code=200, content=[])

    if not all:
        # Use UTC for comparison
        one_hour_ago = datetime.now(timezone.utc) - timedelta(hours=1)
        audio_overview_jobs = [
            job
            for job in audio_overview_jobs
            if (job.status != JobStatus.COMPLETED and job.started_at >= one_hour_ago)
        ]

    # Convert the audio overview jobs to a list of dictionaries
    audio_overview_job_list = [
        audio_overview_job_crud.job_to_dict(job) for job in audio_overview_jobs
    ]

    return JSONResponse(
        status_code=200,
        content=audio_overview_job_list,
    )


@project_audio_router.get("/file/{project_id}/{audio_overview_id}")
async def get_audio_overview_by_id(
    request: Request,
    project_id: str,
    audio_overview_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """
    Get a specific audio overview by ID
    """
    # Fetch the audio overview from the database
    audio_overview = audio_overview_crud.get_by_id_project_and_user(
        db,
        id=uuid.UUID(audio_overview_id),
        project_id=uuid.UUID(project_id),
        current_user=current_user,
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
