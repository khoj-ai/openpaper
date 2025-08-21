import logging
import uuid

from app.auth.dependencies import get_required_user
from app.database.crud.projects.project_conversation_crud import (
    ProjectConversationCreate,
    project_conversation_crud,
)
from app.database.database import get_db
from app.database.models import Conversation
from app.database.telemetry import track_event
from app.schemas.user import CurrentUser
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# Create API router
project_conversations_router = APIRouter()


class CreateProjectConversationRequest(BaseModel):
    title: str | None = None


@project_conversations_router.post("/{project_id}/conversations")
async def create_project_conversation(
    project_id: str,
    request: CreateProjectConversationRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
) -> JSONResponse:
    """Create a new conversation for a project"""
    try:
        conversation = project_conversation_crud.create(
            db,
            obj_in=ProjectConversationCreate(title=request.title),
            user=current_user,
            project_id=uuid.UUID(project_id),
        )

        if not conversation:
            raise HTTPException(
                status_code=400,
                detail="Failed to create conversation. Check permissions.",
            )

        track_event("project_conversation_created", user_id=str(current_user.id))

        return JSONResponse(
            status_code=201,
            content=conversation.to_dict(),
        )
    except Exception as e:
        logger.error(f"Error creating project conversation: {e}")
        return JSONResponse(
            status_code=400,
            content={"message": f"Failed to create project conversation: {str(e)}"},
        )


@project_conversations_router.get("/{project_id}/conversations")
async def get_project_conversations(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
) -> JSONResponse:
    """Get all conversations for a specific project"""
    try:
        conversations = project_conversation_crud.get_by_project_id(
            db, project_id=uuid.UUID(project_id), user=current_user
        )

        return JSONResponse(
            status_code=200,
            content=[conv.to_dict() for conv in conversations],
        )
    except Exception as e:
        logger.error(f"Error fetching project conversations: {e}")
        return JSONResponse(
            status_code=400,
            content={"message": f"Failed to fetch project conversations: {str(e)}"},
        )
