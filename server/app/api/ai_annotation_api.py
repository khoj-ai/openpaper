import logging
import uuid

from app.auth.dependencies import get_required_user
from app.database.crud.ai_annotation_crud import ai_annotation_crud
from app.database.database import get_db
from app.schemas.user import CurrentUser
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# Create API router
ai_annotation_router = APIRouter()


@ai_annotation_router.get("/{paper_id}")
async def get_ai_annotations(
    paper_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
) -> JSONResponse:
    """Get all AI-generated annotations for a specific document"""
    try:
        annotations = ai_annotation_crud.get_ai_annotations_by_paper_id(
            db, paper_id=uuid.UUID(paper_id), user=current_user
        )
        return JSONResponse(
            status_code=200,
            content=[annotation.to_dict() for annotation in annotations],
        )
    except Exception as e:
        logger.error(f"Error fetching AI annotations: {e}")
        return JSONResponse(
            status_code=400,
            content={"message": f"Failed to fetch AI annotations: {str(e)}"},
        )
