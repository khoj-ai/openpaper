import logging
import os
import tempfile
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from app.auth.dependencies import get_required_user
from app.database.crud.coversation_crud import conversation_crud
from app.database.crud.document_crud import (
    DocumentCreate,
    DocumentUpdate,
    document_crud,
)
from app.database.crud.paper_note_crud import (
    PaperNoteCreate,
    PaperNoteUpdate,
    paper_note_crud,
)
from app.database.database import get_db
from app.database.models import Document
from app.helpers.s3 import s3_service
from app.llm.operations import Operations
from app.schemas.user import CurrentUser
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, HttpUrl
from sqlalchemy.orm import Session

load_dotenv()

logger = logging.getLogger(__name__)

# Create API router with prefix
document_router = APIRouter()

llm_operations = Operations()


class CreatePaperNoteSchema(BaseModel):
    content: Optional[str]


class UpdatePaperNoteSchema(BaseModel):
    content: str


@document_router.get("/all")
async def get_paper_ids(
    db: Session = Depends(get_db),
    current_user: Optional[CurrentUser] = Depends(get_required_user),
):
    """
    Get all paper IDs
    """
    papers = document_crud.get_multi(db, user=current_user)
    if not papers:
        return JSONResponse(status_code=404, content={"message": "No papers found"})
    return JSONResponse(
        status_code=200,
        content={
            "papers": [
                {
                    "id": str(paper.id),
                    "filename": paper.filename,
                    "title": paper.title,
                    "created_at": str(paper.created_at),
                    "abstract": paper.abstract,
                    "authors": paper.authors,
                    "institutions": paper.institutions,
                    "keywords": paper.keywords,
                    "summary": paper.summary,
                }
                for paper in papers
            ]
        },
    )


@document_router.get("/note")
async def get_paper_note(
    document_id: str,
    db: Session = Depends(get_db),
    current_user: Optional[CurrentUser] = Depends(get_required_user),
):
    """
    Get the paper note associated with this document.
    """
    target_paper = document_crud.get(db, id=document_id, user=current_user)

    if not target_paper:
        raise HTTPException(
            status_code=404, detail=f"No document with id {document_id}"
        )

    paper_note = paper_note_crud.get_paper_note_by_document_id(
        db, document_id=document_id, user=current_user
    )

    if paper_note:
        return JSONResponse(content=paper_note.to_dict(), status_code=200)

    raise HTTPException(
        status_code=404, detail=f"Paper Note does not exist for document {document_id}"
    )


@document_router.post("/note")
async def create_paper_note(
    document_id: str,
    request: CreatePaperNoteSchema,
    db: Session = Depends(get_db),
    current_user: Optional[CurrentUser] = Depends(get_required_user),
):
    """
    Create the paper note associated with this document
    """
    content = request.content
    target_paper = document_crud.get(db, id=document_id, user=current_user)

    if not target_paper:
        raise HTTPException(
            status_code=404, detail=f"No document with id {document_id}"
        )

    paper_note_to_create = PaperNoteCreate(
        document_id=uuid.UUID(document_id), content=content
    )

    paper_note = paper_note_crud.create(
        db, obj_in=paper_note_to_create, user=current_user
    )

    return JSONResponse(content=paper_note.to_dict(), status_code=201)


@document_router.put("/note")
async def update_paper_note(
    document_id: str,
    request: UpdatePaperNoteSchema,
    db: Session = Depends(get_db),
    current_user: Optional[CurrentUser] = Depends(get_required_user),
):
    """
    Update the paper note associated with this document
    """
    content = request.content
    target_paper = document_crud.get(db, id=document_id, user=current_user)

    if not target_paper:
        raise HTTPException(
            status_code=404, detail=f"No document with id {document_id}"
        )

    paper_note = paper_note_crud.get_paper_note_by_document_id(
        db, document_id=document_id, user=current_user
    )

    if not paper_note:
        raise HTTPException(
            status_code=404,
            detail=f"No paper note associated with document ID {document_id}",
        )

    paper_note_to_update = PaperNoteUpdate(content=content)

    updated_paper_note = paper_note_crud.update(
        db=db, db_obj=paper_note, obj_in=paper_note_to_update, user=current_user
    )

    return JSONResponse(content=updated_paper_note.to_dict(), status_code=200)


@document_router.get("/conversation")
async def get_mru_paper_conversation(
    document_id: str,
    db: Session = Depends(get_db),
    current_user: Optional[CurrentUser] = Depends(get_required_user),
):
    """
    Get latest conversation associated with specific document
    """
    casted_document_id = uuid.UUID(document_id)

    # Fetch the document from the database
    document = document_crud.get(db, id=document_id, user=current_user)

    if not document:
        return JSONResponse(status_code=404, content={"message": "Document not found"})

    # Fetch the latest conversation associated with the document
    conversations = conversation_crud.get_document_conversations(
        db, document_id=casted_document_id, current_user=current_user
    )

    if not conversations or len(conversations) == 0:
        # No conversations found for the document
        logger.info(f"No conversations found for document ID {document_id}")
        return JSONResponse(
            status_code=404, content={"message": "No conversations found"}
        )

    latest_conversation = conversations[-1]

    # Prepare the response data
    conversation_data = (
        latest_conversation.to_dict()
    )  # Assuming to_dict() method exists

    # Return the conversation data
    return JSONResponse(status_code=200, content=conversation_data)


@document_router.get("")
async def get_pdf(
    request: Request,
    id: str,
    db: Session = Depends(get_db),
    current_user: Optional[CurrentUser] = Depends(get_required_user),
):
    """
    Get a document by ID
    """
    # Fetch the document from the database
    document = document_crud.get(db, id=id, user=current_user)

    if not document:
        return JSONResponse(status_code=404, content={"message": "Document not found"})

    paper_data = document.to_dict()

    signed_url = s3_service.generate_presigned_url(object_key=document.s3_object_key)
    if not signed_url:
        return JSONResponse(status_code=404, content={"message": "File not found"})

    paper_data["file_url"] = signed_url

    # Return the file URL
    return JSONResponse(status_code=200, content=paper_data)


@document_router.delete("")
async def delete_pdf(
    request: Request,
    id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """
    Delete a document by ID
    """
    # Fetch the document from the database
    document = document_crud.get(db, id=id, user=current_user)

    if not document:
        return JSONResponse(status_code=404, content={"message": "Document not found"})

    # Delete the document from the database
    try:
        # Delete the file from S3 if s3_object_key exists
        if document.s3_object_key:
            s3_service.delete_file(document.s3_object_key)
            logger.info(f"Deleted S3 object: {document.s3_object_key}")

        document_crud.remove(db, id=id, user=current_user)
        return JSONResponse(status_code=200, content={"message": "Document deleted"})
    except Exception as e:
        logger.error(f"Error deleting document: {str(e)}")
        return JSONResponse(
            status_code=500,
            content={"message": f"Error deleting document: {str(e)}"},
        )


class UploadFromUrlSchema(BaseModel):
    url: HttpUrl


@document_router.post("/upload/from-url/")
async def upload_pdf_from_url(
    request: UploadFromUrlSchema,
    current_user: Optional[CurrentUser] = Depends(get_required_user),
    db: Session = Depends(get_db),
):
    """
    Upload a document from a given URL, rather than the raw file.
    """

    # Validate the URL
    url = request.url
    if not url or not str(url).lower().endswith(".pdf"):
        return JSONResponse(status_code=400, content={"message": "URL must be a PDF"})

    # Create a temporary file for processing
    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as temp_file:
        temp_file_path = temp_file.name

        try:
            # Upload the file to S3
            object_key, file_url = await s3_service.read_and_upload_file_from_url(
                str(url), temp_file_path
            )
        except Exception as e:
            logger.error(
                f"Error uploading file from URL: {str(e)}",
                exc_info=True,
            )
            # Clean up temporary file in case of error
            try:
                os.unlink(temp_file_path)
            except Exception:
                pass
            return JSONResponse(
                status_code=500,
                content={
                    "message": f"Error uploading file from URL: {str(e)}",
                    "filename": url,
                },
            )

        # Ensure we have a valid filename for the record
        safe_filename = Path(url.path).name.replace(" ", "_")

        return create_and_upload_pdf(
            safe_filename=safe_filename,
            temp_file_path=temp_file_path,
            object_key=object_key,
            file_url=file_url,
            current_user=current_user,
            db=db,
        )


@document_router.post("/upload")
async def upload_pdf(
    request: Request,
    file: UploadFile = File(...),
    current_user: Optional[CurrentUser] = Depends(get_required_user),
    db: Session = Depends(get_db),
):
    """
    Upload a PDF file
    """
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        return JSONResponse(status_code=400, content={"message": "File must be a PDF"})

    # Create a temporary file for processing
    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as temp_file:
        contents = await file.read()
        temp_file.write(contents)
        temp_file_path = temp_file.name

    # Reset file pointer for S3 upload
    await file.seek(0)

    # Upload to S3
    try:
        # Upload the file to S3
        object_key, file_url = await s3_service.upload_file(file)

    except Exception as e:
        logger.error(
            f"Error uploading file: {str(e)}",
            exc_info=True,
        )
        # Clean up temporary file in case of error
        try:
            os.unlink(temp_file_path)
        except Exception:
            pass
        return JSONResponse(
            status_code=500,
            content={
                "message": f"Error uploading file: {str(e)}",
                "filename": file.filename if file and file.filename else "unknown",
            },
        )

    # Ensure we have a valid filename for the record
    safe_filename = file.filename.replace(" ", "_")

    return create_and_upload_pdf(
        safe_filename=safe_filename,
        temp_file_path=temp_file_path,
        object_key=object_key,
        file_url=file_url,
        current_user=current_user,
        db=db,
    )


def create_and_upload_pdf(
    safe_filename: str,
    temp_file_path: str,
    object_key: str,
    file_url: str,
    current_user: CurrentUser,
    db: Session,
) -> JSONResponse:
    """
    Create a new document record in the database and upload the PDF to S3.
    """

    try:
        # Create a new document record in the database with S3 details
        document = DocumentCreate(
            filename=safe_filename, file_url=file_url, s3_object_key=object_key
        )

        created_doc: Document = document_crud.create(
            db, obj_in=document, user=current_user
        )

        # Extract metadata from the temporary file
        extract_metadata = llm_operations.extract_paper_metadata(
            paper_id=str(created_doc.id),
            user=current_user,
            file_path=temp_file_path,
            db=db,
        )

        # Try parse date into a valid datetime object. If four digits, then assume year
        if extract_metadata.publish_date:
            # Try full date format first (YYYY-MM-DD)
            try:
                parsed_date = datetime.strptime(
                    extract_metadata.publish_date, "%Y-%m-%d"
                )
            except ValueError:
                # If that fails, try just the year
                if (
                    extract_metadata.publish_date.isdigit()
                    and len(extract_metadata.publish_date) == 4
                ):
                    # Convert year to a full date (assume January 1st)
                    parsed_date = datetime.strptime(
                        f"{extract_metadata.publish_date}-01-01", "%Y-%m-%d"
                    )
                else:
                    # If that fails, assume yyyy-mm
                    try:
                        parsed_date = datetime.strptime(
                            extract_metadata.publish_date, "%Y-%m"
                        )
                    except ValueError:
                        # If that fails, we can't parse the date
                        parsed_date = None
            finally:
                if parsed_date is None:
                    # If we still can't parse, raise an error
                    logger.error(
                        f"Could not parse date: {extract_metadata.publish_date}"
                    )
                    raise ValueError(
                        f"Could not parse date: {extract_metadata.publish_date}"
                    )
            # Format back to string in YYYY-MM-DD format
            extract_metadata.publish_date = parsed_date.strftime("%Y-%m-%d")

        update_doc = DocumentUpdate(
            authors=extract_metadata.authors,
            title=extract_metadata.title,
            abstract=extract_metadata.abstract,
            institutions=extract_metadata.institutions,
            keywords=extract_metadata.keywords,
            summary=extract_metadata.summary,
            publish_date=extract_metadata.publish_date,
            starter_questions=extract_metadata.starter_questions,
        )

        document_crud.update(
            db, db_obj=created_doc, obj_in=update_doc, user=current_user
        )

        try:
            # Clean up the temporary file now that we're done with it
            os.unlink(temp_file_path)
        except Exception as cleanup_error:
            logger.warning(f"Failed to clean up temporary file: {cleanup_error}")
        return JSONResponse(
            status_code=200,
            content={
                "message": "File uploaded successfully",
                "filename": safe_filename,
                "url": file_url,
                "document_id": str(created_doc.id),
            },
        )

    except Exception as e:
        logger.error(
            f"Error creating document record: {str(e)}",
            exc_info=True,
        )

        # Clean up temporary file in case of error
        try:
            os.unlink(temp_file_path)
        except Exception:
            pass

        return JSONResponse(
            status_code=500,
            content={
                "message": f"Error creating document record: {str(e)}",
                "filename": safe_filename,
            },
        )
