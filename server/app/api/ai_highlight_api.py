import logging

from app.auth.dependencies import get_required_user
from app.database.crud.ai_highlight_crud import ai_highlight_crud
from app.database.database import get_db
from app.schemas.user import CurrentUser
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

ai_highlight_router = APIRouter()


@ai_highlight_router.get("/{paper_id}")
async def get_ai_highlights(
    paper_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
) -> JSONResponse:
    """Get all AI-generated highlights for a specific document"""
    try:
        highlights = ai_highlight_crud.get_ai_highlights_by_paper_id(
            db, paper_id=paper_id, user=current_user
        )
        return JSONResponse(
            status_code=200,
            content=[highlight.to_dict() for highlight in highlights],
        )
    except Exception as e:
        logger.error(f"Error fetching AI highlights: {e}")
        return JSONResponse(
            status_code=400,
            content={"message": f"Failed to fetch AI highlights: {str(e)}"},
        )
