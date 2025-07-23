import logging
import re
from datetime import datetime, timezone
from typing import Literal, Optional
from uuid import UUID

from app.database.crud.audio_overview_crud import (
    AudioOverviewCreate,
    audio_overview_crud,
    audio_overview_job_crud,
)
from app.database.crud.paper_crud import paper_crud
from app.database.database import get_db
from app.database.models import JobStatus
from app.database.telemetry import track_event
from app.llm.operations import operations
from app.llm.speech import speaker
from app.schemas.responses import AudioOverviewForLLM
from app.schemas.user import CurrentUser
from fastapi import Depends
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


def generate_audio_overview(
    paper_id: UUID,
    user: CurrentUser,
    audio_overview_job_id: UUID,
    additional_instructions: Optional[str] = None,
    voice: Literal[
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
    ] = "nova",
    db: Session = Depends(get_db),
) -> None:
    """
    Generate an audio overview for a paper by creating a narrative summary
    and converting it to speech.

    Args:
        paper_id: UUID of the paper to process
        user: Current user requesting the overview
        audio_overview_job_id: UUID of the job tracking this operation
        additional_instructions: Optional instructions for the narrative summary
        voice: Voice to use for speech synthesis
        db: Database session
    """

    try:
        start_time = datetime.now(timezone.utc)

        # Update job status to running
        audio_overview_job_crud.update_status(
            db,
            job_id=audio_overview_job_id,
            status=JobStatus.RUNNING,
            current_user=user,
        )

        logger.info(f"Starting audio overview generation for paper {paper_id}")

        # Get paper details for title
        paper = paper_crud.get(db, id=str(paper_id), user=user)
        if not paper:
            raise ValueError(f"Paper with ID {paper_id} not found")

        paper_title = str(paper.title) or "Untitled Paper"

        # Step 1: Generate narrative summary
        logger.info(f"Generating narrative summary for paper {paper_id}")
        narrative_summary: AudioOverviewForLLM = operations.create_narrative_summary(
            paper_id=str(paper_id),
            user=user,
            additional_instructions=additional_instructions,
            db=db,
        )

        if not narrative_summary or not narrative_summary.summary:
            raise ValueError("Failed to generate narrative summary")

        logger.info(
            f"Generated narrative summary ({len(narrative_summary.summary)} characters)"
        )

        # Track event creation of narrative summary
        track_event(
            "narrative_summary_generated",
            properties={
                "paper_id": paper_id,
                "summary_length": len(narrative_summary.summary),
                "job_id": str(audio_overview_job_id),
                "num_citations": len(narrative_summary.citations),
            },
            user_id=str(user.id),
        )

        # Strip any citation syntax from the summary before passing it to the TTS using a regex
        cleaned_narration = re.sub(
            r"\s*\[\^[\d]+(?:,\s*\^[\d]+)*\]", "", narrative_summary.summary
        ).strip()

        # Step 2: Convert summary to speech
        logger.info(f"Converting summary to speech with voice: {voice}")
        object_key, file_url = speaker.generate_speech_from_text(
            title=paper_title,
            text=cleaned_narration,
            voice=voice,
        )

        if not object_key:
            raise ValueError("Failed to generate speech audio")

        logger.info(f"Generated speech audio: {object_key}")

        # Step 3: Create AudioOverview record
        audio_overview_data = AudioOverviewCreate(
            paper_id=paper_id,
            s3_object_key=object_key,
            transcript=narrative_summary.summary,
            citations=narrative_summary.citations,
            title=narrative_summary.title or paper_title,
        )

        audio_overview = audio_overview_crud.create(
            db,
            obj_in=audio_overview_data,
            current_user=user,
        )

        logger.info(f"Created AudioOverview record: {audio_overview.id}")

        # Step 4: Update job status to completed
        audio_overview_job_crud.update_status(
            db,
            job_id=audio_overview_job_id,
            status=JobStatus.COMPLETED,
            current_user=user,
        )

        logger.info(
            f"Successfully completed audio overview generation for paper {paper_id}"
        )

        track_event(
            "audio_overview_completed",
            properties={
                "success": True,
                "job_id": str(audio_overview_job_id),
                "time_taken": (datetime.now(timezone.utc) - start_time).total_seconds(),
            },
            user_id=str(user.id),
        )

    except Exception as e:
        logger.error(
            f"Error generating audio overview for paper {paper_id}: {str(e)}",
            exc_info=True,
        )

        # Update job status to failed
        try:
            audio_overview_job_crud.update_status(
                db,
                job_id=audio_overview_job_id,
                status=JobStatus.FAILED,
                current_user=user,
            )
            track_event(
                "audio_overview_failed",
                properties={
                    "success": False,
                    "job_id": str(audio_overview_job_id),
                    "time_taken": (
                        datetime.now(timezone.utc) - start_time
                    ).total_seconds(),
                },
                user_id=str(user.id),
            )

        except Exception as update_error:
            logger.error(f"Failed to update job status to failed: {str(update_error)}")

        # Re-raise the original exception
        raise e


async def generate_audio_overview_async(
    paper_id: UUID,
    user: CurrentUser,
    audio_overview_job_id: UUID,
    additional_instructions: Optional[str] = None,
    voice: Literal[
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
    ] = "nova",
    db: Session = Depends(get_db),
) -> None:
    """
    Async wrapper for generate_audio_overview function.
    Useful for background task processing.
    """
    return generate_audio_overview(
        paper_id=paper_id,
        user=user,
        audio_overview_job_id=audio_overview_job_id,
        additional_instructions=additional_instructions,
        voice=voice,
        db=db,
    )
