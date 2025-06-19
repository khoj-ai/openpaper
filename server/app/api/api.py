from pathlib import Path

from app.helpers.email import send_onboarding_email
from app.llm.operations import Operations
from dotenv import load_dotenv
from fastapi import APIRouter
from fastapi.responses import JSONResponse

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
        status_code=200, content={"status": "healthy", "message": "Service is running"}
    )
