import logging
import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

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
from app.database.models import Conversation, Document
from app.llm.operations import Operations
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

load_dotenv()

logger = logging.getLogger(__name__)

# Create uploads directory if it doesn't exist
UPLOAD_DIR = Path("uploads")

# Create API router with prefix
document_router = APIRouter()

llm_operations = Operations()


class CreatePaperNoteSchema(BaseModel):
    content: Optional[str]


class UpdatePaperNoteSchema(BaseModel):
    content: str


@document_router.get("/explain")
async def explain_text(query: str):
    """
    Stream explanation of the provided text using the LLM
    """

    async def content_generator():
        async for chunk in llm_operations.explain_text(contents=query):
            yield chunk

    return StreamingResponse(content_generator(), media_type="text/event-stream")


@document_router.get("/all")
async def get_paper_ids(db: Session = Depends(get_db)):
    """
    Get all paper IDs
    """
    papers = document_crud.get_multi(db)
    if not papers:
        return JSONResponse(status_code=404, content={"message": "No papers found"})
    return JSONResponse(
        status_code=200,
        content={
            "papers": [
                {"id": str(paper.id), "filename": paper.filename, "title": paper.title}
                for paper in papers
            ]
        },
    )


@document_router.get("/note")
async def get_paper_note(document_id: str, db: Session = Depends(get_db)):
    """
    Get the paper note associated with this document.
    """
    target_paper = document_crud.get(db, id=document_id)

    if not target_paper:
        raise HTTPException(
            status_code=404, detail=f"No document with id {document_id}"
        )

    paper_note = paper_note_crud.get_paper_note_by_document_id(
        db, document_id=document_id
    )

    if paper_note:
        return JSONResponse(content=paper_note.to_dict(), status_code=200)

    raise HTTPException(
        status_code=404, detail=f"Paper Note does not exist for document {document_id}"
    )


@document_router.post("/note")
async def create_paper_note(
    document_id: str, request: CreatePaperNoteSchema, db: Session = Depends(get_db)
):
    """
    Create the paper note associated with this document
    """
    content = request.content
    target_paper = document_crud.get(db, id=document_id)

    if not target_paper:
        raise HTTPException(
            status_code=404, detail=f"No document with id {document_id}"
        )

    paper_note_to_create = PaperNoteCreate(
        document_id=uuid.UUID(document_id), content=content
    )

    paper_note = paper_note_crud.create(db, obj_in=paper_note_to_create)

    return JSONResponse(content=paper_note.to_dict(), status_code=200)


@document_router.put("/note")
async def update_paper_note(
    document_id: str, request: UpdatePaperNoteSchema, db: Session = Depends(get_db)
):
    """
    Update the paper note associated with this document
    """
    content = request.content
    target_paper = document_crud.get(db, id=document_id)

    if not target_paper:
        raise HTTPException(
            status_code=404, detail=f"No document with id {document_id}"
        )

    paper_note = paper_note_crud.get_paper_note_by_document_id(
        db, document_id=document_id
    )

    if not paper_note:
        raise HTTPException(
            status_code=404,
            detail=f"No paper note associated with document ID {document_id}",
        )

    paper_note_to_update = PaperNoteUpdate(content=content)

    updated_paper_note = paper_note_crud.update(
        db=db, db_obj=paper_note, obj_in=paper_note_to_update
    )

    return JSONResponse(content=updated_paper_note.to_dict(), status_code=200)


@document_router.get("/conversation")
async def get_mru_paper_conversation(document_id: str, db: Session = Depends(get_db)):
    """
    Get latest conversation associated with specific document
    """
    casted_document_id = uuid.UUID(document_id)

    # Fetch the document from the database
    document = document_crud.get(db, id=document_id)

    if not document:
        return JSONResponse(status_code=404, content={"message": "Document not found"})

    # Fetch the latest conversation associated with the document
    conversations = conversation_crud.get_document_conversations(
        db, document_id=casted_document_id
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
async def get_pdf(request: Request, id: str, db: Session = Depends(get_db)):
    """
    Get a document by ID
    """
    # Fetch the document from the database
    document = document_crud.get(db, id=id)

    if not document:
        return JSONResponse(status_code=404, content={"message": "Document not found"})

    paper_data = document.to_dict()

    # Return the file URL
    return JSONResponse(status_code=200, content=paper_data)


@document_router.post("/upload")
async def upload_pdf(
    request: Request, file: UploadFile = File(...), db: Session = Depends(get_db)
):
    """
    Upload a PDF file
    """
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        return JSONResponse(status_code=400, content={"message": "File must be a PDF"})

    # Ensure we have a valid filename
    safe_filename = file.filename.replace(" ", "_")
    file_path = UPLOAD_DIR / safe_filename

    with open(file_path, "wb") as buffer:
        contents = await file.read()
        buffer.write(contents)

    host_url = str(request.base_url)
    file_upload_url = f"{host_url}uploads/{safe_filename}"

    # Create a new document record in the database
    try:
        document = DocumentCreate(filename=safe_filename, file_url=file_upload_url)
        created_doc: Document = document_crud.create(db, obj_in=document)

        # TODO this can be improved by using a background task
        extract_metadata = llm_operations.extract_paper_metadata(
            paper_id=str(created_doc.id), file_path=str(file_path), db=db
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

        updated_doc: Document = document_crud.update(
            db=db, db_obj=created_doc, obj_in=update_doc
        )

        return JSONResponse(
            status_code=200,
            content={
                "message": "File uploaded successfully",
                "filename": safe_filename,
                "url": file_upload_url,
                "document_id": str(updated_doc.id),
            },
        )
    except Exception as e:
        logger.error(
            f"Error creating document record: {str(e)}",
            exc_info=True,
        )
        return JSONResponse(
            status_code=500,
            content={
                "message": f"Error creating document record: {str(e)}",
                "filename": safe_filename,
            },
        )
