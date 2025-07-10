"""
Webhook handlers for PDF processing service integration.
"""

import logging
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from app.database.crud.paper_crud import PaperCreate, paper_crud
from app.database.crud.paper_image_crud import PaperImageCreate, paper_image_crud
from app.database.crud.paper_upload_crud import paper_upload_job_crud
from app.database.database import get_db
from app.database.models import JobStatus
from app.database.telemetry import track_event
from app.helpers.s3 import s3_service
from app.llm.schemas import PaperMetadataExtraction
from app.schemas.user import CurrentUser
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

webhook_router = APIRouter()


class PDFImage(BaseModel):
    """
    Schema for an image extracted from a PDF.
    """

    page_number: int
    image_index: int
    s3_object_key: str
    image_url: str
    width: int
    height: int
    format: str
    size_bytes: int
    caption: Optional[str] = None


class PDFProcessingResult(BaseModel):
    """Result of PDF processing"""

    success: bool
    job_id: str
    raw_content: Optional[str] = None
    page_offset_map: Optional[dict[int, list[int]]] = None
    metadata: Optional[PaperMetadataExtraction] = None
    s3_object_key: Optional[str] = None
    file_url: Optional[str] = None
    preview_url: Optional[str] = None
    preview_object_key: Optional[str] = None
    error: Optional[str] = None
    duration: Optional[float] = None
    extracted_images: Optional[List[PDFImage]] = None


class WebhookData(BaseModel):
    task_id: str
    status: str
    result: PDFProcessingResult


@webhook_router.post("/paper-processing/{job_id}")
async def handle_paper_processing_webhook(
    job_id: str, webhook_data: WebhookData, db: Session = Depends(get_db)
):
    """Handle webhook from paper processing jobs service."""

    # Get the job from your database (without user filtering since this is a webhook)
    job = paper_upload_job_crud.get_by(db=db, task_id=webhook_data.task_id, id=job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    job_id = str(job.id)

    if job.status == JobStatus.COMPLETED:
        logger.warning(f"Received webhook for already completed job {job_id}, ignoring")
        return {"status": "webhook ignored - job already completed"}

    # Get the user object from the relationship
    user = job.user
    if not user:
        logger.error(f"No user found for job {job_id}")
        raise HTTPException(status_code=500, detail="User not found for job")

    job_user: CurrentUser = CurrentUser(
        id=user.id,
        email=user.email,
        name=user.name,
        is_admin=user.is_admin,
    )
    status = webhook_data.status
    result = webhook_data.result

    try:
        if status == "completed" and result.success:
            # Processing was successful
            metadata = result.metadata
            file_url = result.file_url
            preview_url = result.preview_url

            if not file_url:
                logger.error(f"No file_url in webhook result for job {job_id}")
                paper_upload_job_crud.mark_as_failed(
                    db=db, job_id=job_id, user=job_user
                )
                return {"status": "webhook processed - failed due to missing file_url"}

            if not metadata:
                logger.error(f"No metadata in webhook result for job {job_id}")
                paper_upload_job_crud.mark_as_failed(
                    db=db, job_id=job_id, user=job_user
                )
                return {"status": "webhook processed - failed due to missing metadata"}

            if not result.raw_content:
                logger.error(f"No raw_content in webhook result for job {job_id}")
                paper_upload_job_crud.mark_as_failed(
                    db=db, job_id=job_id, user=job_user
                )
                return {
                    "status": "webhook processed - failed due to missing raw_content"
                }

            size_in_kb = (
                s3_service.get_file_size_in_kb(result.s3_object_key)
                if result.s3_object_key
                else None
            )

            publish_date = metadata.publish_date if metadata.publish_date else None

            # Create paper record
            paper = paper_crud.create(
                db=db,
                obj_in=PaperCreate(
                    file_url=file_url,
                    s3_object_key=result.s3_object_key,
                    upload_job_id=job_id,
                    preview_url=preview_url,
                    title=metadata.title,
                    authors=metadata.authors,
                    abstract=metadata.abstract,
                    summary=metadata.summary,
                    summary_citations=metadata.summary_citations,
                    keywords=metadata.keywords,
                    institutions=metadata.institutions,
                    publish_date=publish_date,
                    starter_questions=metadata.starter_questions,
                    raw_content=result.raw_content,
                    page_offset_map=result.page_offset_map,
                    size_in_kb=size_in_kb,
                ),
                user=job_user,
            )

            # Create highlights/annotations if any
            if metadata.highlights and paper:
                try:
                    paper_crud.create_ai_annotations(
                        db=db,
                        paper_id=str(paper.id),
                        extract_metadata=metadata,
                        current_user=job_user,
                    )
                except Exception as e:
                    logger.error(
                        f"Error creating annotations for job {job_id}: {str(e)}",
                        exc_info=True,
                    )
                    # Don't fail the whole process for annotation errors

            # Create images if any
            if result.extracted_images and paper:
                try:
                    # Create all PaperImageCreate objects in memory first
                    paper_image_creates = []
                    for image in result.extracted_images:
                        paper_image_creates.append(
                            PaperImageCreate(
                                paper_id=uuid.UUID(str(paper.id)),
                                s3_object_key=image.s3_object_key,
                                image_url=image.image_url,
                                format=image.format,
                                size_bytes=image.size_bytes,
                                width=image.width,
                                height=image.height,
                                page_number=image.page_number,
                                image_index=image.image_index,
                                caption=image.caption,
                            )
                        )

                    # Create all images in a single batch operation
                    paper_image_crud.create_multiple_with_paper_validation(
                        db=db,
                        images=paper_image_creates,
                        user=job_user,
                    )
                except Exception as e:
                    logger.error(
                        f"Error creating images for job {job_id}: {str(e)}",
                        exc_info=True,
                    )
                    # Don't fail the whole process for image errors

            # Track metadata extraction event
            track_event(
                "extracted_metadata",
                properties={
                    "has_title": bool(metadata.title),
                    "has_authors": bool(metadata.authors),
                    "has_abstract": bool(metadata.abstract),
                    "has_summary": bool(metadata.summary),
                    "has_ai_highlights": bool(metadata.highlights),
                    "num_starter_questions": (
                        len(metadata.starter_questions)
                        if metadata.starter_questions
                        else 0
                    ),
                },
                user_id=str(user.id),
            )

            start_time = job.created_at
            end_time = datetime.now(timezone.utc)

            track_event(
                "paper_upload",
                properties={
                    "has_metadata": bool(metadata),
                    "duration": (end_time - start_time).total_seconds(),
                    "worker_duration": result.duration,
                },
                user_id=str(user.id),
            )

            # Mark job as completed
            paper_upload_job_crud.mark_as_completed(db=db, job_id=job_id, user=job_user)

        else:
            # Processing failed
            error_message = result.error if result.error else "Unknown error"
            logger.error(f"PDF processing failed for job {job_id}: {error_message}")
            paper_upload_job_crud.mark_as_failed(db=db, job_id=job_id, user=job_user)

    except Exception as e:
        logger.error(
            f"Error processing webhook for job {job_id}: {str(e)}", exc_info=True
        )
        paper_upload_job_crud.mark_as_failed(db=db, job_id=job_id, user=job_user)
        raise HTTPException(status_code=500, detail="Error processing webhook")

    return {"status": "webhook processed"}
