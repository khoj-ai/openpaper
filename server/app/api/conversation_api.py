import logging
import uuid
from pathlib import Path
from typing import Optional

from app.auth.dependencies import get_current_user, get_required_user
from app.database.crud.coversation_crud import (
    ConversationCreate,
    ConversationUpdate,
    conversation_crud,
)
from app.database.crud.message_crud import message_crud
from app.database.database import get_db
from app.database.models import Conversation
from app.llm.operations import operations
from app.schemas.user import CurrentUser
from dotenv import load_dotenv
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

load_dotenv()

logger = logging.getLogger(__name__)

# Create API router with prefix
conversation_router = APIRouter()


@conversation_router.get("/{conversation_id}")
async def get_conversation(
    conversation_id: str,
    page: int = 1,
    page_size: int = 10,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
) -> JSONResponse:
    """Get a specific conversation by ID"""
    try:
        conversation: Conversation | None = conversation_crud.get(
            db, conversation_id, user=current_user
        )
        if not conversation:
            raise ValueError(f"Conversation with ID {conversation_id} not found.")

        # Fetch messages for the conversation
        casted_conversation_id = uuid.UUID(conversation_id)

        messages = message_crud.get_conversation_messages(
            db,
            conversation_id=casted_conversation_id,
            current_user=current_user,
            page=page,
            page_size=page_size,
        )
        formatted_messages = message_crud.messages_to_dict(messages)

        return JSONResponse(
            status_code=200,
            content={
                "id": str(conversation.id),
                "title": conversation.title,
                "messages": formatted_messages,
            },
        )
    except ValueError as e:
        return JSONResponse(status_code=404, content={"message": str(e)})
    except Exception as e:
        logger.error(f"Error fetching conversation: {e}")
        return JSONResponse(
            status_code=400,
            content={"message": f"Failed to fetch conversation: {str(e)}"},
        )


@conversation_router.post("/{paper_id}")
async def create_conversation(
    paper_id: str,
    title: str | None = None,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
) -> JSONResponse:
    """Create a new conversation for a document"""
    try:
        # Create a conversation with the user ID
        conversation_data = ConversationCreate(
            paper_id=uuid.UUID(paper_id), title=title
        )

        conversation: Conversation | None = conversation_crud.create(
            db, obj_in=conversation_data, user=current_user
        )
        if not conversation:
            raise ValueError("Failed to create conversation.")
        return JSONResponse(
            status_code=201,
            content={
                "id": str(conversation.id),
                "title": conversation.title,
                "messages": [],
            },
        )
    except Exception as e:
        logger.error(f"Error creating conversation: {e}")
        return JSONResponse(
            status_code=400,
            content={"message": f"Failed to create conversation: {str(e)}"},
        )


@conversation_router.patch("/{conversation_id}")
async def update_conversation(
    conversation_id: str,
    title: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
) -> JSONResponse:
    """Update conversation title"""
    try:
        existing_conversation = conversation_crud.get(
            db, conversation_id, user=current_user
        )
        if not existing_conversation:
            raise ValueError(f"Conversation with ID {conversation_id} not found.")
        conversation = conversation_crud.update(
            db,
            db_obj=existing_conversation,
            obj_in=ConversationUpdate(title=title),
            user=current_user,
        )

        if not conversation:
            raise ValueError("Failed to update conversation.")

        return JSONResponse(
            status_code=200,
            content={"id": str(conversation.id), "title": conversation.title},
        )
    except ValueError as e:
        return JSONResponse(status_code=404, content={"message": str(e)})
    except Exception as e:
        logger.error(f"Error updating conversation: {e}")
        return JSONResponse(
            status_code=400,
            content={"message": f"Failed to update conversation: {str(e)}"},
        )


@conversation_router.delete("/{conversation_id}")
async def delete_conversation(
    conversation_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
) -> JSONResponse:
    """Delete an existing conversation"""
    try:
        # First verify the conversation exists and belongs to the user
        existing_conversation = conversation_crud.get(
            db, conversation_id, user=current_user
        )
        if not existing_conversation:
            return JSONResponse(
                status_code=404,
                content={
                    "message": f"Conversation with ID {conversation_id} not found."
                },
            )

        conversation_crud.remove(db, id=conversation_id, user=current_user)
        return JSONResponse(
            status_code=200, content={"message": "Conversation deleted successfully"}
        )
    except Exception as e:
        logger.error(f"Error deleting conversation: {e}")
        return JSONResponse(
            status_code=404,
            content={
                "message": f"Conversation not found or couldn't be deleted: {str(e)}"
            },
        )
