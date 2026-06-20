"""
Webhook handlers for PDF processing service integration.
"""

import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Optional

import stripe
from app.database.crud.conversation_crud import ConversationCreate, conversation_crud
from app.database.crud.message_crud import MessageCreate, message_crud
from app.database.crud.paper_crud import PaperUpdate, paper_crud
from app.database.crud.paper_tag_crud import paper_tag_crud
from app.database.crud.paper_upload_crud import paper_upload_job_crud
from app.database.crud.projects.project_data_table_crud import (
    DataTableResultCreate,
    DataTableRowCreate,
    data_table_job_crud,
    data_table_result_crud,
    data_table_row_crud,
)
from app.database.crud.projects.project_paper_crud import project_paper_crud
from app.database.crud.referral_crud import referral_crud
from app.database.crud.subscription_crud import subscription_crud
from app.database.crud.user_crud import user as user_crud
from app.database.crud.zotero_import_crud import zotero_import_crud
from app.database.database import SessionLocal, engine, get_db
from app.database.models import (
    ConversableType,
    Conversation,
    JobStatus,
    ReferralStatus,
    ZoteroImportStatus,
)
from app.database.telemetry import track_event
from app.helpers.advisory_locks import AdvisoryLock, AdvisoryLockNamespace
from app.helpers.email import (
    send_data_table_complete_email,
    send_referral_credit_available_email,
)
from app.helpers.metadata_hydration import hydrate_paper_metadata
from app.helpers.s3 import s3_service
from app.helpers.subscription_limits import can_user_auto_sync_zotero
from app.llm.citation_handler import CitationHandler
from app.llm.operations import operations
from app.schemas.responses import DataTableResult, PaperMetadataExtraction
from app.schemas.user import CurrentUser
from app.services.zotero_import import (
    apply_zotero_annotations,
    auto_import_new_papers,
    sync_batch,
)
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

webhook_router = APIRouter()


def _finalize_zotero_import(
    db: Session,
    job_id: str,
    job_user: CurrentUser,
    result: "PDFProcessingResult",
    error_message: Optional[str] = None,
) -> Optional[str]:
    """
    Finalize a Zotero-imported paper from a jobs-worker result.

    The Zotero import path submits the PDF to the worker with LLM metadata
    extraction skipped, and applies Zotero's authoritative metadata
    (title/authors/abstract/DOI/publish_date) up front via
    _apply_metadata_from_zotero. So here we only fill in the deterministic worker
    outputs (preview, PDF text, page offsets, file size) and apply the Zotero
    annotations — we never require or overwrite the Zotero metadata.

    Used on the normal completion path (error_message=None) and as a best-effort
    salvage when the worker reports failure (error_message set) but still produced
    partial deterministic outputs (e.g. preview/text). Returns the paper id, or
    None when there is no Zotero metadata to keep (cannot finalize).
    """
    existing_paper = paper_crud.get_by_upload_job_id(
        db=db, upload_job_id=job_id, user=job_user
    )
    if not existing_paper or not getattr(existing_paper, "title", None):
        # No Zotero metadata was applied; cannot finalize.
        return None

    size_in_kb = (
        s3_service.get_file_size_in_kb(result.s3_object_key)
        if result.s3_object_key
        else None
    )

    update_payload: dict = {"upload_job_id": job_id}
    if result.preview_url:
        update_payload["preview_url"] = result.preview_url
    if result.raw_content:
        update_payload["raw_content"] = result.raw_content
    if result.page_offset_map:
        update_payload["page_offset_map"] = result.page_offset_map
    if size_in_kb is not None:
        update_payload["size_in_kb"] = size_in_kb

    paper = paper_crud.update(
        db=db,
        obj_in=PaperUpdate(**update_payload),
        db_obj=existing_paper,
        user=job_user,
    )

    paper_upload_job_crud.mark_as_completed(db=db, job_id=job_id, user=job_user)

    if not paper:
        return None

    # When salvaging a partial result, record the worker error on the import row.
    # apply_zotero_annotations (below) flips the row to COMPLETED but preserves
    # this note (it only sets error_message when given one).
    if error_message:
        zotero_import = zotero_import_crud.get_by_upload_job_id(
            db, upload_job_id=uuid.UUID(job_id)
        )
        if zotero_import:
            zotero_import_crud.update_status(
                db,
                item=zotero_import,
                status=ZoteroImportStatus.PROCESSING,
                error_message=f"Imported without full processing: {error_message}",
                paper_id=uuid.UUID(str(paper.id)),
            )

    try:
        apply_zotero_annotations(
            db=db,
            upload_job_id=job_id,
            paper_id=str(paper.id),
            user=job_user,
        )
    except Exception as e:
        logger.error(
            f"Error applying Zotero annotations for job {job_id}: {e}",
            exc_info=True,
        )

    logger.info(
        f"Finalized Zotero import for job {job_id} with paper {paper.id}"
        + (f" (worker error: {error_message})" if error_message else "")
    )
    return str(paper.id)


def handle_failed_upload(
    db: Session, job_id: str, job_user: CurrentUser, reason: str = "Unknown error"
) -> None:
    """
    Handle cleanup for a failed paper upload job.

    Removes the paper record and any associated ProjectPaper relationships
    that were created during the upload process.

    Args:
        db: Database session
        job_id: The upload job ID
        job_user: The user who owns the job
        reason: Description of why the upload failed
    """
    # Refuse to tear down a job that already succeeded. A redelivered Celery
    # task (acks_late) can post a late "failed" webhook after another delivery
    # already built and committed the paper; deleting it here is what caused
    # the highlights_paper_id_fkey violations (highlight inserts racing a paper
    # delete). A completed job means the paper is good — leave it alone.
    job = paper_upload_job_crud.get(db=db, id=job_id, user=job_user)
    if job and job.status == JobStatus.COMPLETED:
        logger.warning(
            f"Ignoring failed-upload cleanup for already-completed job {job_id} "
            f"(reason: {reason}); refusing to delete a populated paper"
        )
        return

    logger.error(f"PDF processing failed for job {job_id}: {reason}")

    # Clean up the paper record that was created during upload
    existing_paper = paper_crud.get_by_upload_job_id(
        db=db, upload_job_id=job_id, user=job_user
    )
    if existing_paper:
        # First remove any ProjectPaper associations (RESTRICT constraint)
        projects = project_paper_crud.get_projects_by_paper_id(
            db=db, paper_id=uuid.UUID(str(existing_paper.id)), user=job_user
        )
        for project in projects:
            project_paper_crud.remove_by_paper_and_project(
                db=db,
                paper_id=uuid.UUID(str(existing_paper.id)),
                project_id=uuid.UUID(str(project.id)),
                user=job_user,
            )
            logger.info(
                f"Removed ProjectPaper association for paper {existing_paper.id} and project {project.id}"
            )

        logger.info(f"Removing failed paper {existing_paper.id} for job {job_id}")
        paper_crud.remove(db=db, id=str(existing_paper.id), user=job_user)

    paper_upload_job_crud.mark_as_failed(db=db, job_id=job_id, user=job_user)

    zotero_import = zotero_import_crud.get_by_upload_job_id(
        db, upload_job_id=uuid.UUID(job_id)
    )
    if zotero_import:
        zotero_import_crud.update_status(
            db,
            item=zotero_import,
            status=ZoteroImportStatus.FAILED,
            error_message=reason,
            paper_id=None,
        )


def post_process_paper(
    *,
    paper_id: uuid.UUID,
    raw_content: str,
    title: str,
    authors: list[str],
    job_user: CurrentUser,
) -> None:
    """Run paper post-processing (passage FTS indexing, DOI lookup) off the webhook hot path."""
    db = SessionLocal()
    try:
        # Stamp attempted_metadata_at up front so a concurrent GET /paper
        # short-circuits its own synchronous DOI lookup while we work.
        try:
            paper = paper_crud.get(db=db, id=paper_id, user=job_user)
            if paper:
                paper_crud.update(
                    db=db,
                    obj_in=PaperUpdate(
                        attempted_metadata_at=datetime.now(timezone.utc)
                    ),
                    db_obj=paper,
                    user=job_user,
                )
        except Exception as e:
            db.rollback()
            logger.error(
                f"Error stamping attempted_metadata_at for paper {paper_id}: {str(e)}",
                exc_info=True,
            )

        try:
            paper_crud.index_paper_passages(
                db,
                paper_id=paper_id,
                raw_content=raw_content,
            )
            db.commit()
        except Exception as e:
            db.rollback()
            logger.error(
                f"Error indexing passages for paper {paper_id}: {str(e)}",
                exc_info=True,
            )

        doi: Optional[str] = None
        try:
            paper = paper_crud.get(db=db, id=paper_id, user=job_user)
            if paper:
                paper = hydrate_paper_metadata(
                    db=db, paper=paper, user=job_user, force=True, agentic=True
                )
                doi = str(paper.doi) if paper.doi else None
        except Exception as e:
            db.rollback()
            logger.error(
                f"Error hydrating metadata for paper {paper_id}: {str(e)}",
                exc_info=True,
            )

        track_event(
            "doi_resolved",
            properties={"has_doi": bool(doi)},
            user_id=str(job_user.id),
            db=db,
        )
    finally:
        db.close()


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
    placeholder_id: str
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


class PdfProcessingWebhookData(BaseModel):
    """Schema for webhook data from PDF processing service"""

    task_id: str
    status: str
    result: PDFProcessingResult


@webhook_router.post("/paper-processing/{job_id}")
async def handle_paper_processing_webhook(
    job_id: str,
    webhook_data: PdfProcessingWebhookData,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
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

    # Serialize concurrent/duplicate deliveries for the same job. Celery retries
    # with acks_late, so a redelivered task can fire a second webhook while the
    # first is still processing. Without this, the two handlers race and one can
    # delete the paper out from under the other (FK violations on highlight
    # insert). Non-blocking: a loser bails immediately. The lock rides its own
    # connection so it survives this handler's many intermediate commits.
    job_lock = AdvisoryLock(
        engine, namespace=AdvisoryLockNamespace.PAPER_PROCESSING_WEBHOOK, key=job_id
    )
    if not job_lock.acquire():
        logger.warning(
            f"Webhook for job {job_id} is already being processed by another "
            f"delivery, ignoring duplicate"
        )
        return {"status": "webhook ignored - already being processed"}

    status = webhook_data.status
    result = webhook_data.result

    zotero_import = zotero_import_crud.get_by_upload_job_id(
        db, upload_job_id=uuid.UUID(job_id)
    )

    try:
        # Re-check completion under the lock: another delivery may have finished
        # between our initial read and acquiring the lock.
        db.refresh(job)
        if job.status == JobStatus.COMPLETED:
            logger.warning(
                f"Job {job_id} completed by a concurrent delivery, ignoring "
                f"duplicate webhook"
            )
            return {"status": "webhook ignored - job already completed"}

        if status == "completed" and result.success:
            # Zotero imports run the worker with LLM metadata extraction skipped,
            # so they have no `metadata` to apply. Zotero's authoritative metadata
            # was already set at submit time; here we only fill the deterministic
            # worker outputs and apply Zotero annotations.
            if zotero_import:
                finalized = _finalize_zotero_import(
                    db=db, job_id=job_id, job_user=job_user, result=result
                )
                if finalized:
                    track_event(
                        "zotero_paper_processed",
                        properties={"worker_duration": result.duration},
                        user_id=str(user.id),
                        db=db,
                    )
                    return {
                        "status": "webhook processed - zotero import",
                        "paper_id": finalized,
                    }
                handle_failed_upload(
                    db=db,
                    job_id=job_id,
                    job_user=job_user,
                    reason="Zotero import missing metadata",
                )
                return {"status": "webhook processed - zotero import failed"}

            # Processing was successful
            metadata = result.metadata
            file_url = result.file_url
            preview_url = result.preview_url

            if not file_url:
                logger.error(f"No file_url in webhook result for job {job_id}")
                handle_failed_upload(
                    db=db, job_id=job_id, job_user=job_user, reason="Missing file_url"
                )
                return {"status": "webhook processed - failed due to missing file_url"}

            if not metadata:
                logger.error(f"No metadata in webhook result for job {job_id}")
                handle_failed_upload(
                    db=db, job_id=job_id, job_user=job_user, reason="Missing metadata"
                )
                return {"status": "webhook processed - failed due to missing metadata"}

            if not result.raw_content:
                logger.error(f"No raw_content in webhook result for job {job_id}")
                handle_failed_upload(
                    db=db,
                    job_id=job_id,
                    job_user=job_user,
                    reason="Missing raw_content",
                )
                return {
                    "status": "webhook processed - failed due to missing raw_content"
                }

            if not metadata or not metadata.title:
                logger.error(f"No metadata in webhook result for job {job_id}")
                handle_failed_upload(
                    db=db, job_id=job_id, job_user=job_user, reason="Missing metadata"
                )
                return {"status": "webhook processed - failed due to missing metadata"}

            if not result.raw_content:
                logger.error(f"No raw_content in webhook result for job {job_id}")
                handle_failed_upload(
                    db=db,
                    job_id=job_id,
                    job_user=job_user,
                    reason="Missing raw_content",
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

            existing_paper = paper_crud.get_by_upload_job_id(
                db=db, upload_job_id=job_id, user=job_user
            )

            # Create paper record
            paper = paper_crud.update(
                db=db,
                obj_in=PaperUpdate(
                    upload_job_id=job_id,
                    preview_url=preview_url,
                    title=metadata.title,
                    authors=metadata.authors,
                    abstract=metadata.abstract,
                    summary="",
                    summary_citations=[],
                    institutions=metadata.institutions,
                    publish_date=publish_date,
                    raw_content=result.raw_content,
                    page_offset_map=result.page_offset_map,
                    size_in_kb=size_in_kb,
                ),
                db_obj=existing_paper,
                user=job_user,
            )

            # Extracted keywords are stored as reusable user tags rather than a
            # flat keywords list, reusing any existing tag that matches
            # case-insensitively. Best-effort: tagging must not fail ingestion.
            if paper and metadata.keywords:
                try:
                    paper_tag_crud.apply_keyword_tags(
                        db=db,
                        paper_id=uuid.UUID(str(paper.id)),
                        keywords=metadata.keywords,
                        user_id=job_user.id,
                    )
                except Exception as e:
                    logger.error(
                        "Failed to apply keyword tags for paper %s: %s",
                        paper.id,
                        e,
                        exc_info=True,
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

            if metadata.summary and paper:
                try:
                    conversation_data = ConversationCreate(
                        conversable_type=ConversableType.PAPER,
                        conversable_id=uuid.UUID(str(paper.id)),
                    )

                    conversation: Conversation | None = conversation_crud.create(
                        db, obj_in=conversation_data, user=job_user
                    )

                    if conversation:
                        # Add the summary as the first message in the conversation, from the AI

                        citations_dict = (
                            CitationHandler.convert_response_citation_to_paper_citation(
                                metadata.summary_citations
                            )
                        )

                        message_crud.create(
                            db,
                            obj_in=MessageCreate(
                                conversation_id=uuid.UUID(str(conversation.id)),
                                role="assistant",
                                content=metadata.summary,
                                references=citations_dict,
                            ),
                            user=job_user,
                        )
                except Exception as e:
                    logger.error(
                        f"Error creating conversation/message for job {job_id}: {str(e)}",
                        exc_info=True,
                    )
                    # Don't fail the whole process for conversation/message errors

            # Track metadata extraction event
            track_event(
                "extracted_metadata",
                properties={
                    "has_title": bool(metadata.title),
                    "has_authors": bool(metadata.authors),
                    "has_abstract": bool(metadata.abstract),
                    "has_summary": bool(metadata.summary),
                    "has_ai_highlights": bool(metadata.highlights),
                },
                user_id=str(user.id),
                db=db,
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
                db=db,
            )

            # Mark job as completed
            paper_upload_job_crud.mark_as_completed(db=db, job_id=job_id, user=job_user)

            if paper:
                background_tasks.add_task(
                    post_process_paper,
                    paper_id=uuid.UUID(str(paper.id)),
                    raw_content=result.raw_content,
                    title=metadata.title,
                    authors=metadata.authors,
                    job_user=job_user,
                )

        else:
            # Processing failed.
            error_message = result.error if result.error else "Unknown error"

            # Best-effort salvage for Zotero imports: Zotero already supplied the
            # metadata, so keep the paper with whatever deterministic outputs the
            # worker did produce instead of discarding it.
            if zotero_import:
                salvaged = _finalize_zotero_import(
                    db=db,
                    job_id=job_id,
                    job_user=job_user,
                    result=result,
                    error_message=error_message,
                )
                if salvaged:
                    return {
                        "status": "webhook processed - zotero salvage",
                        "paper_id": salvaged,
                    }

            handle_failed_upload(
                db=db, job_id=job_id, job_user=job_user, reason=error_message
            )

    except Exception as e:
        logger.error(
            f"Error processing webhook for job {job_id}: {str(e)}", exc_info=True
        )

        # Roll back before cleanup: the failure above may have left the session
        # in a PendingRollbackError state, which would otherwise make every
        # cleanup query (and mark_as_failed) fail too.
        db.rollback()

        # Clean up the paper record on exception as well
        try:
            handle_failed_upload(db=db, job_id=job_id, job_user=job_user, reason=str(e))
        except Exception as cleanup_error:
            logger.error(
                f"Failed to cleanup paper for job {job_id}: {str(cleanup_error)}"
            )
            # Still mark job as failed even if cleanup fails
            paper_upload_job_crud.mark_as_failed(db=db, job_id=job_id, user=job_user)

        raise HTTPException(status_code=500, detail="Error processing webhook")
    finally:
        # Always release the advisory lock (and return its connection to the pool).
        job_lock.release()

    return {"status": "webhook processed"}


class DataTableProcessingResultWebhookData(BaseModel):
    """Schema for webhook data from data table processing service."""

    task_id: str
    status: str
    result: DataTableResult
    error: Optional[str] = None


@webhook_router.post("/data-table-processing/{job_id}")
async def handle_data_table_processing_webhook(
    job_id: str,
    webhook_data: DataTableProcessingResultWebhookData,
    db: Session = Depends(get_db),
):
    """Handle webhook from data table processing jobs service."""

    logger.info(
        f"Received data table processing webhook for job {job_id} with status {webhook_data.status}"
    )

    result = webhook_data.result
    task_id = webhook_data.task_id
    status = webhook_data.status
    error = webhook_data.error

    try:
        if status == "completed" and result.success:
            # Processing was successful
            logger.info(
                f"Data table processing completed for job {job_id}, "
                f"extracted {len(result.rows)} rows with columns: {result.columns}"
            )

            # Update job status to completed
            data_table_job_crud.update_status(
                db=db,
                job_id=uuid.UUID(job_id),
                status=JobStatus.COMPLETED,
            )

            # Post-Processing
            # Augment the DataCellValue citations with the paper_id
            # The job only returns citation info without paper_id, but we can fill it in here
            for col in result.columns:
                for row in result.rows:
                    cell_value = row.values.get(col)
                    if cell_value:
                        for citation in cell_value.citations:
                            citation.paper_id = row.paper_id

            paper_titles = []
            for row in result.rows:
                paper = paper_crud.get(db=db, id=uuid.UUID(row.paper_id))
                if paper and paper.title:
                    paper_titles.append(paper.title)
                else:
                    paper_titles.append("")

            title = (
                operations.name_data_table(
                    paper_titles=paper_titles,
                    column_labels=result.columns,
                )
                or f'Data Table ({", ".join(result.columns)})'
            )

            # Create the data table result
            table_result = data_table_result_crud.create(
                db=db,
                obj_in=DataTableResultCreate(
                    job_id=uuid.UUID(job_id),
                    title=title,
                    success=result.success,
                    columns=result.columns,
                    row_failures=[uuid.UUID(pid) for pid in result.row_failures],
                ),
            )

            if table_result:
                # Create all rows using create_many
                # Convert DataTableCellValue objects to dicts for JSON serialization
                row_creates = [
                    DataTableRowCreate(
                        data_table_id=uuid.UUID(str(table_result.id)),
                        paper_id=uuid.UUID(row.paper_id),
                        values={
                            col: cell.model_dump() for col, cell in row.values.items()
                        },
                    )
                    for row in result.rows
                ]
                if row_creates:
                    data_table_row_crud.create_many(db=db, rows=row_creates)
                    logger.info(
                        f"Created {len(row_creates)} rows for data table result {table_result.id}"
                    )

                # Send email notification to user
                job = data_table_job_crud.get_by_task_id(db=db, task_id=task_id)
                if job and job.user and job.project:
                    try:
                        send_data_table_complete_email(
                            to_email=job.user.email,
                            table_title=title,
                            columns=result.columns,
                            row_count=len(result.rows),
                            project_name=job.project.title,
                            project_id=str(job.project.id),
                            result_id=str(table_result.id),
                        )
                    except Exception as email_error:
                        logger.error(
                            f"Failed to send data table complete email for job {job_id}: {email_error}",
                            exc_info=True,
                        )
            else:
                logger.error(f"Failed to create data table result for job {job_id}")

        else:
            # Processing failed
            error_message = error if error else "Unknown error"
            logger.error(
                f"Data table processing failed for job {job_id}: {error_message}"
            )

            # Update job status to failed
            data_table_job_crud.update_status(
                db=db,
                job_id=uuid.UUID(job_id),
                status=JobStatus.FAILED,
                error_message=error_message,
            )

    except Exception as e:
        logger.error(
            f"Error processing data table webhook for job {job_id}: {str(e)}",
            exc_info=True,
        )
        raise HTTPException(status_code=500, detail="Error processing webhook")

    return {
        "status": "data table webhook processed",
        "job_id": job_id,
        "task_id": task_id,
        "success": result.success,
        "rows_count": len(result.rows),
    }


@webhook_router.post("/internal/referral-settle/{referral_id}")
async def settle_referral(referral_id: str, db: Session = Depends(get_db)):
    """
    Internal callback fired by the jobs service when a referral credit hold
    has elapsed. Idempotent — re-runs on the same referral are no-ops.

    Auth: the referral_id is an unguessable UUID. This matches the pattern of
    /api/webhooks/paper-processing/{job_id}.
    """
    try:
        referral_uuid = uuid.UUID(referral_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid referral id")

    referral = referral_crud.get_by_id(db, referral_uuid)
    if referral is None:
        raise HTTPException(status_code=404, detail="Referral not found")

    if str(referral.status) != ReferralStatus.CREDIT_PENDING.value:
        # Already settled, refunded inside the hold window, or fraud-rejected.
        return {"success": True, "status": str(referral.status), "no_op": True}

    referrer = user_crud.get(db, id=referral.referrer_user_id)
    if referrer is None:
        logger.error(f"Referrer {referral.referrer_user_id} missing during settlement")
        raise HTTPException(status_code=500, detail="Referrer not found")

    sub = subscription_crud.get_by_user_id(db, uuid.UUID(str(referrer.id)))
    customer_id: Optional[str] = (
        str(sub.stripe_customer_id) if sub and sub.stripe_customer_id else None
    )

    if not customer_id:
        # Referrer is on Basic and has never gone through checkout. Lazily
        # create their Stripe customer so we have a place for the credit.
        try:
            customer = stripe.Customer.create(
                email=str(referrer.email),
                name=str(referrer.name) if referrer.name else str(referrer.email),
                metadata={"user_id": str(referrer.id)},
            )
        except Exception as e:
            logger.error(
                f"Failed to create Stripe customer for referrer {referrer.id}: {e}",
                exc_info=True,
            )
            raise HTTPException(status_code=502, detail="Stripe customer create failed")

        customer_id = customer.id
        subscription_crud.create_or_update(
            db,
            uuid.UUID(str(referrer.id)),
            {"stripe_customer_id": customer_id},
        )

    credit_cents: int = int(referral.referrer_credit_cents)  # type: ignore[arg-type]

    try:
        txn = stripe.Customer.create_balance_transaction(
            customer_id,
            amount=-credit_cents,  # negative = credit
            currency="usd",
            description=f"Referral credit (referral {referral.id})",
            metadata={
                "referral_id": str(referral.id),
                "referrer_user_id": str(referrer.id),
            },
        )
    except Exception as e:
        logger.error(
            f"Failed to push Stripe balance transaction for referral {referral.id}: {e}",
            exc_info=True,
        )
        raise HTTPException(status_code=502, detail="Stripe balance txn failed")

    referral_crud.mark_credit_available(
        db, referral, stripe_balance_transaction_id=str(txn.id)
    )

    try:
        send_referral_credit_available_email(
            to_email=str(referrer.email),
            credit_cents=credit_cents,
        )
    except Exception as e:
        logger.error(
            f"Failed to send credit_available email for referral {referral.id}: {e}",
            exc_info=True,
        )

    track_event(
        "referral_credit_available",
        user_id=str(referrer.id),
        properties={
            "referral_id": str(referral.id),
            "credit_cents": credit_cents,
        },
        db=db,
    )

    return {"success": True, "referral_id": str(referral.id)}


@webhook_router.post("/internal/zotero-sync-all")
async def trigger_zotero_sync_all(request: Request, db: Session = Depends(get_db)):
    """
    Internal endpoint called by the Celery Beat periodic task to sync new Zotero
    annotations for all users whose items haven't been synced in the past 24 hours.
    Auth: shared secret via Authorization header (JOBS_INTERNAL_SECRET env var).
    """
    secret = os.getenv("JOBS_INTERNAL_SECRET", "")
    if secret and request.headers.get("Authorization") != f"Bearer {secret}":
        raise HTTPException(status_code=403, detail="Forbidden")

    threshold_seconds = int(
        request.query_params.get("threshold_seconds", str(24 * 3600))
    )
    threshold_hours = threshold_seconds / 3600
    user_ids = zotero_import_crud.list_user_ids_due_for_sync(
        db, threshold_hours=threshold_hours
    )
    logger.info(
        f"Periodic Zotero sync: found {len(user_ids)} users due for sync (threshold={threshold_hours:.4f}h)"
    )

    results = []
    skipped = []
    for user_id in user_ids:
        user = user_crud.get(db, id=user_id)
        if not user:
            logger.info(f"Skipping Zotero auto-sync for {user_id}: user not found")
            skipped.append({"user_id": str(user_id), "reason": "user_not_found"})
            continue

        if not can_user_auto_sync_zotero(db, user):
            logger.info(
                f"Skipping Zotero auto-sync for {user_id}: not eligible for auto-sync (basic plan)"
            )
            skipped.append(
                {"user_id": str(user_id), "reason": "auto_sync_not_eligible"}
            )
            continue

        try:
            result = await sync_batch(db, user=user, limit=50)
            results.append({"user_id": str(user_id), **result})
            if result.get("new_annotations_count", 0) > 0:
                track_event(
                    "zotero_auto_sync",
                    user_id=str(user_id),
                    properties={
                        "papers": result.get("synced_papers_count", 0),
                        "annotations": result.get("new_annotations_count", 0),
                    },
                    db=db,
                )

            # Auto-import is a best-effort secondary step. A failure here
            # shouldn't fail the user's sync (which already succeeded above), but
            # we still log it so the error is visible rather than swallowed.
            try:
                import_result = await auto_import_new_papers(db, user=user)
                if import_result.get("auto_imported_count", 0) > 0:
                    track_event(
                        "zotero_auto_import_new_papers",
                        user_id=str(user_id),
                        properties={"count": import_result["auto_imported_count"]},
                        db=db,
                    )
            except Exception as e:
                logger.error(
                    f"Auto-import of new papers failed for user {user_id}: {e}",
                    exc_info=True,
                )
        except Exception as e:
            logger.error(f"Auto-sync failed for user {user_id}: {e}", exc_info=True)
            results.append({"user_id": str(user_id), "error": str(e)})

    synced_users = len([r for r in results if "error" not in r])
    logger.info(
        f"Periodic Zotero sync complete: {synced_users}/{len(user_ids)} users synced "
        f"successfully, {len(skipped)} skipped"
    )
    return {
        "synced_users": synced_users,
        "total_users": len(user_ids),
        "skipped_users": len(skipped),
        "results": results,
        "skipped": skipped,
    }
