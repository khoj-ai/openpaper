import logging
import uuid
from typing import Any, Optional

from app.auth.dependencies import get_required_user
from app.database.crud.highlight_crud import (
    HighlightCreate,
    HighlightUpdate,
    highlight_crud,
)
from app.database.database import get_db
from app.database.models import RoleType
from app.database.telemetry import track_event
from app.schemas.user import CurrentUser
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# Create API router
highlight_router = APIRouter()


class CreateHighlightRequest(BaseModel):
    paper_id: str
    raw_text: str
    position: Optional[dict[str, Any]] = None  # ScaledPosition JSON
    color: Optional[str] = None  # Highlight color: yellow, green, blue, pink, purple
    # Legacy fields - kept for backwards compatibility
    start_offset: Optional[int] = None
    end_offset: Optional[int] = None
    page_number: Optional[int] = None


class UpdateHighlightRequest(BaseModel):
    raw_text: str
    position: Optional[dict[str, Any]] = None  # ScaledPosition JSON
    color: Optional[str] = None  # Highlight color: yellow, green, blue, pink, purple
    # Legacy fields - kept for backwards compatibility
    start_offset: Optional[int] = None
    end_offset: Optional[int] = None


@highlight_router.post("")
async def create_highlight(
    request: CreateHighlightRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
) -> JSONResponse:
    """Create a new highlight for a document"""
    try:
        highlight = highlight_crud.create(
            db,
            obj_in=HighlightCreate(
                paper_id=uuid.UUID(request.paper_id),
                raw_text=request.raw_text,
                start_offset=request.start_offset,
                end_offset=request.end_offset,
                page_number=request.page_number,
                position=request.position,
                role=RoleType.USER,
                color=request.color,
            ),
            user=current_user,
        )

        if not highlight:
            raise ValueError("Failed to create highlight, please check the input data.")

        track_event("highlight_created", user_id=str(current_user.id))

        return JSONResponse(
            status_code=201,
            content=highlight.to_dict(),
        )
    except Exception as e:
        logger.error(f"Error creating highlight: {e}")
        return JSONResponse(
            status_code=400,
            content={"message": f"Failed to create highlight: {str(e)}"},
        )


@highlight_router.get("/{paper_id}")
async def get_document_highlights(
    paper_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
) -> JSONResponse:
    """Get all highlights for a specific document"""
    try:
        highlights = highlight_crud.get_highlights_by_paper_id(
            db, paper_id=paper_id, user=current_user
        )
        return JSONResponse(
            status_code=200,
            content=[highlight.to_dict() for highlight in highlights],
        )
    except Exception as e:
        logger.error(f"Error fetching highlights: {e}")
        return JSONResponse(
            status_code=400,
            content={"message": f"Failed to fetch highlights: {str(e)}"},
        )


@highlight_router.delete("/{highlight_id}")
async def delete_highlight(
    highlight_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
) -> JSONResponse:
    """Delete a specific highlight"""
    try:
        # First verify the highlight exists and belongs to the user
        existing_highlight = highlight_crud.get(db, id=highlight_id, user=current_user)
        if not existing_highlight:
            return JSONResponse(
                status_code=404,
                content={"message": f"Highlight with ID {highlight_id} not found."},
            )

        if existing_highlight.role == RoleType.ASSISTANT:
            return JSONResponse(
                status_code=403,
                content={"message": "Cannot delete assistant highlights."},
            )

        highlight_crud.remove(db, id=highlight_id)
        return JSONResponse(
            status_code=200,
            content={"message": "Highlight deleted successfully"},
        )
    except Exception as e:
        logger.error(f"Error deleting highlight: {e}")
        return JSONResponse(
            status_code=404,
            content={
                "message": f"Highlight not found or couldn't be deleted: {str(e)}"
            },
        )


@highlight_router.patch("/{highlight_id}")
async def update_highlight(
    highlight_id: str,
    request: UpdateHighlightRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
) -> JSONResponse:
    """Update an existing highlight"""
    try:
        existing_highlight = highlight_crud.get(db, id=highlight_id, user=current_user)
        if not existing_highlight:
            raise ValueError(f"Highlight with ID {highlight_id} not found.")

        if existing_highlight.role == RoleType.ASSISTANT:
            return JSONResponse(
                status_code=403,
                content={"message": "Cannot update assistant highlights."},
            )

        highlight = highlight_crud.update(
            db,
            db_obj=existing_highlight,
            obj_in=HighlightUpdate(
                paper_id=existing_highlight.paper_id.uuid,
                raw_text=request.raw_text,
                start_offset=request.start_offset,
                end_offset=request.end_offset,
                position=request.position,
                color=request.color,
            ),
        )

        if not highlight:
            raise ValueError("Failed to update highlight, please check the input data.")

        track_event("highlight_updated", user_id=str(current_user.id))

        return JSONResponse(status_code=200, content=highlight.to_dict())
    except ValueError as e:

        logger.error(f"Highlight not found or invalid data: {e}")
        return JSONResponse(status_code=404, content={"message": str(e)})
    except Exception as e:
        logger.error(f"Error updating highlight: {e}")
        return JSONResponse(
            status_code=400,
            content={"message": f"Failed to update highlight: {str(e)}"},
        )
