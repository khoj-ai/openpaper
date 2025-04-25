import logging
import uuid

from app.auth.dependencies import get_required_user
from app.database.crud.annotation_crud import (
    AnnotationCreate,
    AnnotationUpdate,
    annotation_crud,
)
from app.database.database import get_db
from app.database.models import Annotation
from app.schemas.user import CurrentUser
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# Create API router
annotation_router = APIRouter()


class CreateAnnotationRequest(BaseModel):
    paper_id: str
    highlight_id: str
    content: str


class UpdateAnnotationRequest(BaseModel):
    content: str


@annotation_router.post("")
async def create_annotation(
    request: CreateAnnotationRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
) -> JSONResponse:
    """Create a new annotation for a highlight"""
    try:
        annotation = annotation_crud.create(
            db,
            obj_in=AnnotationCreate(
                paper_id=uuid.UUID(request.paper_id),
                highlight_id=uuid.UUID(request.highlight_id),
                content=request.content,
            ),
            user=current_user,
        )
        return JSONResponse(
            status_code=201,
            content=annotation.to_dict(),
        )
    except Exception as e:
        logger.error(f"Error creating annotation: {e}")
        return JSONResponse(
            status_code=400,
            content={"message": f"Failed to create annotation: {str(e)}"},
        )


@annotation_router.get("/{paper_id}")
async def get_document_annotations(
    paper_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
) -> JSONResponse:
    """Get all annotations for a specific document"""
    try:
        annotations = annotation_crud.get_annotations_by_paper_id(
            db, paper_id=uuid.UUID(paper_id), user=current_user
        )
        return JSONResponse(
            status_code=200,
            content=[annotation.to_dict() for annotation in annotations],
        )
    except Exception as e:
        logger.error(f"Error fetching annotations: {e}")
        return JSONResponse(
            status_code=400,
            content={"message": f"Failed to fetch annotations: {str(e)}"},
        )


@annotation_router.delete("/{annotation_id}")
async def delete_annotation(
    annotation_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
) -> JSONResponse:
    """Delete a specific annotation"""
    try:
        # First verify the annotation exists and belongs to the user
        existing_annotation = annotation_crud.get(
            db, id=annotation_id, user=current_user
        )
        if not existing_annotation:
            return JSONResponse(
                status_code=404,
                content={"message": f"Annotation with ID {annotation_id} not found."},
            )

        annotation_crud.remove(db, id=annotation_id, user=current_user)
        return JSONResponse(
            status_code=200,
            content={"message": "Annotation deleted successfully"},
        )
    except Exception as e:
        logger.error(f"Error deleting annotation: {e}")
        return JSONResponse(
            status_code=404,
            content={
                "message": f"Annotation not found or couldn't be deleted: {str(e)}"
            },
        )


@annotation_router.patch("/{annotation_id}")
async def update_annotation(
    annotation_id: str,
    request: UpdateAnnotationRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
) -> JSONResponse:
    """Update an existing annotation"""
    try:
        existing_annotation = annotation_crud.get(
            db, id=annotation_id, user=current_user
        )
        if not existing_annotation:
            raise ValueError(f"Annotation with ID {annotation_id} not found.")

        annotation = annotation_crud.update(
            db,
            db_obj=existing_annotation,
            obj_in=AnnotationUpdate(
                paper_id=uuid.UUID(str(existing_annotation.paper_id)),
                highlight_id=uuid.UUID(str(existing_annotation.highlight_id)),
                content=request.content,
            ),
            user=current_user,
        )
        return JSONResponse(status_code=200, content=annotation.to_dict())
    except ValueError as e:
        return JSONResponse(status_code=404, content={"message": str(e)})
    except Exception as e:
        logger.error(f"Error updating annotation: {e}")
        return JSONResponse(
            status_code=400,
            content={"message": f"Failed to update annotation: {str(e)}"},
        )
