import difflib
import logging
import os
import sys
import tempfile
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Tuple, Union

import fitz  # PyMuPDF
from app.auth.dependencies import get_required_user
from app.database.crud.paper_crud import PaperCreate, PaperUpdate, paper_crud
from app.database.crud.paper_upload_crud import (
    PaperUploadJobCreate,
    paper_upload_job_crud,
)
from app.database.database import get_db
from app.database.models import Paper, PaperUploadJob
from app.database.telemetry import track_event
from app.helpers.s3 import s3_service
from app.llm.operations import operations
from app.llm.schemas import PaperMetadataExtraction
from app.schemas.user import CurrentUser
from dotenv import load_dotenv
from fastapi import APIRouter, BackgroundTasks, Depends, File, Request, UploadFile
from fastapi.responses import JSONResponse
from PIL import Image
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
    Get the status of a paper upload job.
    """
    paper_upload_job = paper_upload_job_crud.get(db=db, id=job_id, user=current_user)

    if not paper_upload_job:
        return JSONResponse(status_code=404, content={"message": "Job not found"})

    paper = None

    if paper_upload_job.status == "completed":
        # Retrieve the associated paper
        paper = paper_crud.get_by_upload_job_id(
            db=db, upload_job_id=str(paper_upload_job.id), user=current_user
        )
        if not paper:
            return JSONResponse(status_code=404, content={"message": "Paper not found"})

    return JSONResponse(
        status_code=200,
        content={
            "job_id": str(paper_upload_job.id),
            "status": paper_upload_job.status,
            "started_at": paper_upload_job.started_at.isoformat(),
            "completed_at": (
                paper_upload_job.completed_at.isoformat()
                if paper_upload_job.completed_at
                else None
            ),
            "paper_id": str(paper.id) if paper else None,
        },
    )


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
        upload_file_from_url,
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
        upload_raw_file,
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


async def upload_file_from_url(
    url: HttpUrl,
    paper_upload_job: PaperUploadJob,
    current_user: CurrentUser,
    db: Session,
) -> None:
    """
    Helper function to upload a file from a URL.
    """

    paper_upload_job_crud.mark_as_running(
        db=db,
        job_id=str(paper_upload_job.id),
        user=current_user,
    )

    # Create a temporary file for processing
    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as temp_file:
        temp_file_path = temp_file.name

        try:
            # Upload the file to S3
            object_key, file_url = await s3_service.read_and_upload_file_from_url(
                str(url), temp_file_path
            )
        except Exception as e:
            logger.error(f"Error uploading file from URL: {str(e)}", exc_info=True)
            # Clean up temporary file in case of error
            try:
                os.unlink(temp_file_path)
            except Exception:
                pass
            paper_upload_job_crud.mark_as_failed(
                db=db,
                job_id=str(paper_upload_job.id),
                user=current_user,
            )
            return  # Add missing return

        # Ensure we have a valid filename for the record
        safe_filename = Path(str(url.path)).name.replace(" ", "_")

        create_and_upload_pdf(
            paper_upload_job=paper_upload_job,
            safe_filename=safe_filename,
            temp_file_path=temp_file_path,
            object_key=object_key,
            file_url=file_url,
            current_user=current_user,
            db=db,
        )


async def upload_raw_file(
    file_contents: bytes,
    filename: str,
    paper_upload_job: PaperUploadJob,
    current_user: CurrentUser,
    db: Session,
) -> None:
    """
    Helper function to upload a raw file.
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

    temp_file_path = None  # Initialize to track cleanup

    try:
        # Create a temporary file for processing
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as temp_file:
            temp_file.write(file_contents)
            temp_file_path = temp_file.name

        file_like = BytesIO(file_contents)
        file_like.name = filename  # Set the filename attribute for S3 service

        # Ensure we have a valid filename for the record
        safe_filename = filename.replace(" ", "_")

        start_time = datetime.now(timezone.utc)

        # Upload to S3
        object_key, file_url = await s3_service.upload_file(file_like, safe_filename)

        end_time = datetime.now(timezone.utc)

        # Track paper upload event
        track_event(
            "paper_upload_to_s3",
            properties={
                "filename": safe_filename,
                "has_metadata": True,  # Assuming metadata extraction will be done later
                "duration": (end_time - start_time).total_seconds(),
            },
            user_id=str(current_user.id),
        )

        create_and_upload_pdf(
            paper_upload_job=paper_upload_job,
            safe_filename=safe_filename,
            temp_file_path=temp_file_path,
            object_key=object_key,
            file_url=file_url,
            current_user=current_user,
            db=db,
        )

    except Exception as e:
        logger.error(f"Error uploading file: {str(e)}", exc_info=True)
        paper_upload_job_crud.mark_as_failed(
            db=db,
            job_id=str(paper_upload_job.id),
            user=current_user,
        )
    finally:
        # Clean up temporary file
        if temp_file_path and os.path.exists(temp_file_path):
            try:
                os.unlink(temp_file_path)
            except Exception as cleanup_error:
                logger.warning(
                    f"Failed to clean up temporary file: {str(cleanup_error)}"
                )


class PaperUploadError(Exception):
    """Custom exception for paper upload errors with context"""

    def __init__(
        self,
        message: str,
    ):
        self.message = message
        super().__init__(self.message)


def create_and_upload_pdf(
    paper_upload_job: PaperUploadJob,
    safe_filename: str,
    temp_file_path: str,
    object_key: str,
    file_url: str,
    current_user: CurrentUser,
    db: Session,
) -> None:
    """
    Create a new document record in the database and upload the PDF to S3.
    """
    created_doc: Union[Paper, None] = None
    job_already_marked_failed = False
    start_time = datetime.now(timezone.utc)

    try:
        # Generate preview image from first page
        preview_url = None
        try:
            preview_object_key, preview_url = generate_pdf_preview(
                temp_file_path, safe_filename
            )
            logger.info(f"Generated preview for {safe_filename}: {preview_url}")
        except Exception as e:
            logger.warning(f"Failed to generate preview for {safe_filename}: {str(e)}")
            # Continue without preview - this is not a critical failure

        # Create a new document record in the database with S3 details
        document = PaperCreate(
            filename=safe_filename,
            file_url=file_url,
            s3_object_key=object_key,
            upload_job_id=str(paper_upload_job.id),
            preview_url=preview_url,
        )

        created_doc = paper_crud.create(db, obj_in=document, user=current_user)
        if not created_doc:
            logger.error(
                f"Failed to create document record for {safe_filename}", exc_info=True
            )
            raise PaperUploadError(
                f"Failed to create document record for {safe_filename}"
            )

        # Extract metadata from the temporary file
        try:
            extract_metadata: PaperMetadataExtraction = (
                operations.extract_paper_metadata(
                    paper_id=str(created_doc.id),
                    user=current_user,
                    file_path=temp_file_path,
                    db=db,
                )
            )
        except Exception as e:
            logger.error(
                f"Error extracting metadata: {str(e)}",
                exc_info=True,
            )
            raise PaperUploadError(f"Error extracting metadata: {str(e)}")

        # Process the publication date
        if extract_metadata.publish_date:
            parsed_date = None
            # Try different date formats
            for date_format in [
                ("%Y-%m-%d", lambda x: x),  # Full date
                (
                    "%Y",
                    lambda x: f"{x}-01-01" if x.isdigit() and len(x) == 4 else None,
                ),  # Year only
                ("%Y-%m", lambda x: x),  # Year and month
            ]:
                format_str, transformer = date_format
                try:
                    date_str = transformer(extract_metadata.publish_date)
                    if date_str:
                        parsed_date = datetime.strptime(date_str, format_str)
                        break
                except ValueError:
                    continue

            # Set the parsed date or None if parsing failed
            if parsed_date:
                extract_metadata.publish_date = parsed_date.strftime("%Y-%m-%d")
            else:
                logger.warning(f"Could not parse date: {extract_metadata.publish_date}")
                extract_metadata.publish_date = None

        # Update the document with extracted metadata
        update_doc = PaperUpdate(
            authors=extract_metadata.authors,
            title=extract_metadata.title,
            abstract=extract_metadata.abstract,
            institutions=extract_metadata.institutions,
            keywords=extract_metadata.keywords,
            summary=extract_metadata.summary,
            summary_citations=extract_metadata.summary_citations,
            publish_date=extract_metadata.publish_date,
            starter_questions=extract_metadata.starter_questions,
        )

        updated_doc = paper_crud.update(
            db, db_obj=created_doc, obj_in=update_doc, user=current_user
        )

        if not updated_doc:
            logger.error(
                f"Failed to update document with metadata for {safe_filename}",
                exc_info=True,
            )
            raise PaperUploadError(
                f"Failed to update document with metadata for {safe_filename}"
            )

        if extract_metadata.highlights:
            paper_crud.create_ai_annotations(
                db=db,
                paper_id=str(created_doc.id),
                extract_metadata=extract_metadata,
                current_user=current_user,
            )

        end_time = datetime.now(timezone.utc)

        # Track paper upload event
        track_event(
            "paper_upload",
            properties={
                "filename": safe_filename,
                "has_metadata": bool(extract_metadata),
                "duration": (end_time - start_time).total_seconds(),
            },
            user_id=str(current_user.id),
        )

        # Success case
        paper_upload_job_crud.mark_as_completed(
            db=db,
            job_id=str(paper_upload_job.id),
            user=current_user,
        )

    except PaperUploadError as upload_error:
        # Handle our custom exception with context
        logger.error(f"Paper upload error: {upload_error.message}")
        paper_upload_job_crud.mark_as_failed(
            db=db,
            job_id=str(paper_upload_job.id),
            user=current_user,
        )
        job_already_marked_failed = True

    except Exception as e:
        # Handle unexpected exceptions
        logger.error(f"Unexpected error processing PDF upload: {str(e)}", exc_info=True)
        paper_upload_job_crud.mark_as_failed(
            db=db,
            job_id=str(paper_upload_job.id),
            user=current_user,
        )
        job_already_marked_failed = True

    finally:
        # Always clean up the temporary file
        try:
            if os.path.exists(temp_file_path):
                os.unlink(temp_file_path)
        except Exception as cleanup_error:
            logger.warning(f"Failed to clean up temporary file: {str(cleanup_error)}")

        # If we have an error and created a document, clean up database and S3
        if sys.exc_info()[0] is not None and created_doc:
            # An exception occurred - clean up any resources
            try:
                # Only mark as failed if not already done
                if not job_already_marked_failed:
                    paper_upload_job_crud.mark_as_failed(
                        db=db,
                        job_id=str(paper_upload_job.id),
                        user=current_user,
                    )
                paper_crud.remove(db, id=str(created_doc.id), user=current_user)

            except Exception as db_error:
                logger.error(
                    f"Failed to delete document record: {str(db_error)}", exc_info=True
                )

            try:
                # Delete the file from S3
                s3_service.delete_file(object_key)
                # Also delete preview if it was created
                if preview_object_key:
                    s3_service.delete_file(preview_object_key)
            except Exception as s3_error:
                logger.error(
                    f"Failed to delete S3 object: {str(s3_error)}", exc_info=True
                )


def generate_pdf_preview(pdf_path: str, filename: str) -> tuple[str, str]:
    """
    Generate a preview image from the first page of a PDF.
    Returns tuple of (s3_object_key, preview_url)
    """
    try:
        # Open the PDF
        doc = fitz.open(pdf_path)

        if len(doc) == 0:
            raise Exception("PDF has no pages")

        # Get the first page
        page = doc[0]

        # Render page to a pixmap (image)
        # You can adjust the matrix for different resolution/quality
        mat = fitz.Matrix(2.0, 2.0)  # 2x zoom for better quality
        pix = page.get_pixmap(matrix=mat)  # type: ignore

        # Convert to PIL Image for easier handling
        img_data = pix.tobytes("png")
        img = Image.open(BytesIO(img_data))

        # Optionally resize to a standard preview size
        # This helps keep file sizes reasonable
        max_width = 800
        if img.width > max_width:
            ratio = max_width / img.width
            new_height = int(img.height * ratio)
            img = img.resize((max_width, new_height), Image.Resampling.LANCZOS)

        # Convert back to bytes
        img_buffer = BytesIO()
        img.save(img_buffer, format="PNG", optimize=True)
        img_buffer.seek(0)

        # Create filename for preview
        preview_filename = f"preview_{filename.rsplit('.', 1)[0]}.png"

        # Upload to S3
        preview_object_key, preview_url = s3_service.upload_any_file_from_bytes(
            img_buffer.getvalue(),
            preview_filename,
            content_type="image/png",
        )

        doc.close()
        return preview_object_key, preview_url

    except Exception as e:
        logger.error(f"Error generating PDF preview: {str(e)}", exc_info=True)
        raise
