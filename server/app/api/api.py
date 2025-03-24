from pathlib import Path
from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.llm.operations import Operations

from dotenv import load_dotenv

load_dotenv()

# Create API router with prefix
router = APIRouter()

llm_operations = Operations()

@router.get("/health")
async def health_check():
    """
    Health check endpoint to verify the API is running
    """
    return JSONResponse(
        status_code=200,
        content={"status": "healthy", "message": "Service is running"}
    )
