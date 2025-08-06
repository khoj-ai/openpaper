from typing import Optional
from uuid import UUID

from app.database.crud.base_crud import CRUDBase
from app.database.models import ConversableType, Conversation, Message, Paper
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

    def get_conversation_by_id(
        self, db: Session, *, conversation_id: UUID, user_id: UUID
    ) -> Optional[Conversation]:
        """Get a conversation by its ID"""
        return (
            db.query(Conversation)
            .filter(Conversation.id == conversation_id, Conversation.user_id == user_id)
            .first()
        )

    def get_by_share_paper_id(
        self, db: Session, *, share_paper_id: str
    ) -> Optional[Conversation]:
        """Get a conversation by share paper ID"""
        paper = (
            db.query(Paper)
            .filter(
                Paper.share_id == share_paper_id,
                Paper.is_public == True,
            )
            .first()
        )

        if not paper:
            return None

        # Get the first conversation for that shared paper that has any associated `Message` objects
        return (
            db.query(Conversation)
            .join(Message)
            .filter(
                Conversation.conversable_id == paper.id,
                Conversation.conversable_type == ConversableType.PAPER,
            )
            .order_by(Conversation.created_at.desc())
            .first()
        )


# Create a single instance to use throughout the application
conversation_crud = ConversationCRUD(Conversation)
