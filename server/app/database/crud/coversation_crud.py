from typing import Optional
from uuid import UUID

from app.database.crud.base_crud import CRUDBase
from app.database.models import Conversation
from pydantic import BaseModel
from sqlalchemy.orm import Session


class ConversationBase(BaseModel):
    document_id: UUID
    title: Optional[str] = None


class ConversationCreate(ConversationBase):
    pass


class ConversationUpdate(BaseModel):
    title: Optional[str] = None


class ConversationCRUD(CRUDBase[Conversation, ConversationCreate, ConversationUpdate]):
    """CRUD operations specifically for Conversation model"""

    def get_document_conversations(
        self, db: Session, *, document_id: UUID
    ) -> list[Conversation]:
        """Get all conversations for a document"""
        return (
            db.query(Conversation)
            .filter(Conversation.document_id == document_id)
            .order_by(Conversation.created_at)
            .all()
        )


# Create a single instance to use throughout the application
conversation_crud = ConversationCRUD(Conversation)
