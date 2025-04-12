import logging
import uuid
from typing import List, Optional

from app.auth.dependencies import get_required_user
from app.database.crud.highlight_crud import (
    HighlightCreate,
    HighlightUpdate,
    highlight_crud,
)
from app.database.database import get_db
from app.database.models import Highlight
from app.schemas.user import CurrentUser
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# Create API router
highlight_router = APIRouter()


class CreateHighlightRequest(BaseModel):
    document_id: str
    raw_text: str
    start_offset: int
    end_offset: int


class UpdateHighlightRequest(BaseModel):
    raw_text: str
    start_offset: int
    end_offset: int


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
                document_id=uuid.UUID(request.document_id),
                raw_text=request.raw_text,
                start_offset=request.start_offset,
                end_offset=request.end_offset,
            ),
            user=current_user,
        )
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


@highlight_router.get("/{document_id}")
async def get_document_highlights(
    document_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
) -> JSONResponse:
    """Get all highlights for a specific document"""
    try:
        highlights = highlight_crud.get_highlights_by_document_id(
            db, document_id=document_id, user=current_user
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

        highlight = highlight_crud.update(
            db,
            db_obj=existing_highlight,
            obj_in=HighlightUpdate(
                document_id=existing_highlight.document_id.uuid,
                raw_text=request.raw_text,
                start_offset=request.start_offset,
                end_offset=request.end_offset,
            ),
        )
        return JSONResponse(status_code=200, content=highlight.to_dict())
    except ValueError as e:
        return JSONResponse(status_code=404, content={"message": str(e)})
    except Exception as e:
        logger.error(f"Error updating highlight: {e}")
        return JSONResponse(
            status_code=400,
            content={"message": f"Failed to update highlight: {str(e)}"},
        )
