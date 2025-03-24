import os
from pathlib import Path

from app.database.crud.document_crud import (
    DocumentCreate,
    DocumentUpdate,
    document_crud,
)
from app.database.database import get_db
from app.database.models import Document
from app.llm.operations import Operations
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, File, Request, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy.orm import Session

load_dotenv()

# Create uploads directory if it doesn't exist
UPLOAD_DIR = Path("uploads")

# Create API router with prefix
document_router = APIRouter()

llm_operations = Operations()


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
                {"id": str(paper.id), "filename": paper.filename} for paper in papers
            ]
        },
    )


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
        return JSONResponse(
            status_code=500,
            content={
                "message": f"Error creating document record: {str(e)}",
                "filename": safe_filename,
            },
        )
