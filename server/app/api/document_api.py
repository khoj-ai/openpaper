import os
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, Request, Depends
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy.orm import Session

from app.database.models import Document
from app.database.database import get_db
from app.llm.operations import Operations
from app.database.crud.document_crud import DocumentCreate, document_crud

from dotenv import load_dotenv

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
    
    return StreamingResponse(
        content_generator(),
        media_type="text/event-stream"
    )

@document_router.get("/all")
async def get_paper_ids(db: Session = Depends(get_db)):
    """
    Get all paper IDs
    """
    papers = document_crud.get_multi(db)
    if not papers:
        return JSONResponse(
            status_code=404,
            content={"message": "No papers found"}
        )
    return JSONResponse(
        status_code=200,
        content={"papers": [{"id": str(paper.id), "filename": paper.filename} for paper in papers]}
    )

@document_router.get("")
async def get_pdf(request: Request, id: str, db: Session = Depends(get_db)):
    """
    Get a document by ID
    """
    # Fetch the document from the database
    document = document_crud.get(db, id=id)
    
    if not document:
        return JSONResponse(
            status_code=404,
            content={"message": "Document not found"}
        )
    
    # Return the file URL
    return JSONResponse(
        status_code=200,
        content={
            "filename": document.filename,
            "url": document.file_url
        }
    )

@document_router.post("/upload")
async def upload_pdf(request: Request, file: UploadFile = File(...), db: Session = Depends(get_db)):
    """
    Upload a PDF file
    """
    if not file.filename or not file.filename.lower().endswith('.pdf'):
        return JSONResponse(
            status_code=400,
            content={"message": "File must be a PDF"}
        )
        
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
        document = DocumentCreate(
            filename=safe_filename,
            file_url=file_upload_url
        )
        created_doc: Document = document_crud.create(db, obj_in=document)
        
        return JSONResponse(
            status_code=200,
            content={
                "message": "File uploaded successfully",
                "filename": safe_filename,
                "url": file_upload_url,
                "document_id": str(created_doc.id)
            }
        )
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={
                "message": f"Error creating document record: {str(e)}",
                "filename": safe_filename
            }
        )
    