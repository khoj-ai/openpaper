from typing import Optional
from uuid import UUID

from app.database.crud.base_crud import CRUDBase
from app.database.models import ConversableType, Conversation
from app.schemas.user import CurrentUser
from pydantic import BaseModel
from sqlalchemy.orm import Session


class ConversationBase(BaseModel):
    conversable_type: ConversableType = ConversableType.PAPER
    conversable_id: Optional[UUID] = None
    title: Optional[str] = None


class ConversationCreate(ConversationBase):
    pass


class ConversationUpdate(BaseModel):
    title: Optional[str] = None


class ConversationCRUD(CRUDBase[Conversation, ConversationCreate, ConversationUpdate]):
    """CRUD operations specifically for Conversation model"""

    def get_document_conversations(
        self, db: Session, *, paper_id: UUID, current_user: CurrentUser
    ) -> list[Conversation]:
        """Get all conversations for a document"""
        return (
            db.query(Conversation)
            .filter(
                Conversation.conversable_id == paper_id,
                Conversation.conversable_type == ConversableType.PAPER,
                Conversation.user_id == current_user.id,
            )
            .order_by(Conversation.created_at)
            .all()
        )


# Create a single instance to use throughout the application
conversation_crud = ConversationCRUD(Conversation)
