import os
from pathlib import Path
from typing import Optional
from fastapi import FastAPI, APIRouter, UploadFile, File, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from google import genai # type: ignore

from dotenv import load_dotenv

load_dotenv()

# Create uploads directory if it doesn't exist
UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

gemini_client = genai.Client(api_key=GEMINI_API_KEY)

app = FastAPI(
    title="FastAPI App",
    description="A FastAPI application with health checkpoint",
    version="1.0.0"
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods
    allow_headers=["*"],  # Allows all headers
)

# Mount the uploads directory
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

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

@router.post("/upload-pdf")
async def upload_pdf(request: Request, file: UploadFile = File(...)):
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
    
    return JSONResponse(
        status_code=200,
        content={
            "message": "File uploaded successfully",
            "filename": safe_filename,
            "url": file_upload_url
        }
    )

# Include the router in the main app
app.include_router(router)

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8001"))
    uvicorn.run("api:app", host="0.0.0.0", port=port, reload=True)
