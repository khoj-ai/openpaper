import os
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, Request, Depends
from fastapi.responses import JSONResponse
from google import genai # type: ignore
from sqlalchemy.orm import Session

from app.database.models import Document
from app.database.database import get_db

from dotenv import load_dotenv

load_dotenv()

# Create uploads directory if it doesn't exist
UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

gemini_client = genai.Client(api_key=GEMINI_API_KEY)

# Create API router with prefix
router = APIRouter(prefix="/api")

@router.get("/health")
async def health_check():
    """
    Health check endpoint to verify the API is running
    """
    return JSONResponse(
        status_code=200,
        content={"status": "healthy", "message": "Service is running"}
    )

@router.get("/explain")
async def explain_text(query: str):
    response = gemini_client.models.generate_content(
        model="gemini-2.0-flash", contents=query
    )
    
    return response.text

@router.get("/papers")
async def get_paper_ids(db: Session = Depends(get_db)):
    """
    Get all paper IDs
    """
    papers = db.query(Document.id).all()
    return JSONResponse(
        status_code=200,
        content={"papers": [{"id": paper.id, "filename": paper.filename} for paper in papers]}
    )

@router.get("/paper")
async def get_pdf(request: Request, id: str, db: Session = Depends(get_db)):
    """
    Get a PDF file by ID
    """
    # Fetch the document from the database
    document = db.query(Document).filter(Document.id == id).first()
    
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

@router.post("/upload-pdf")
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
        document = Document(
            filename=safe_filename,
            file_url=str(file_upload_url),
        )
        db.add(document)
        db.commit()
        db.refresh(document)
        
        return JSONResponse(
            status_code=200,
            content={
                "message": "File uploaded successfully",
                "filename": safe_filename,
                "url": file_upload_url,
                "document_id": str(document.id)
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
    