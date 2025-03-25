from datetime import datetime
from typing import Any, Dict, Optional
from uuid import UUID

from app.database.crud.base_crud import CRUDBase
from app.database.models import Message
from pydantic import BaseModel
from sqlalchemy import desc, func
from sqlalchemy.orm import Session


class MessageBase(BaseModel):
    conversation_id: UUID
    role: str
    content: str
    references: Optional[Dict[str, Any]] = None
    bucket: Optional[Dict[str, Any]] = None


class MessageCreate(MessageBase):
    pass


class MessageUpdate(BaseModel):
    role: Optional[str] = None
    content: Optional[str] = None
    references: Optional[Dict[str, Any]] = None
    bucket: Optional[Dict[str, Any]] = None


class MessageCRUD(CRUDBase[Message, MessageCreate, MessageUpdate]):
    """CRUD operations specifically for Message model"""

    def create(self, db: Session, *, obj_in: MessageCreate) -> Message:
        """Create a new message with auto-incrementing sequence number"""
        # Get the next sequence number for this conversation
        max_sequence = (
            db.query(func.max(Message.sequence))
            .filter(Message.conversation_id == obj_in.conversation_id)
            .scalar()
        )
        next_sequence = (max_sequence or 0) + 1

        # Convert Pydantic model to dict and add sequence
        obj_in_data = obj_in.model_dump(exclude_unset=True)
        db_obj = Message(**obj_in_data, sequence=next_sequence)

        db.add(db_obj)
        db.commit()
        db.refresh(db_obj)
        return db_obj

    def get_conversation_messages(
        self, db: Session, *, conversation_id: UUID, page: int = 1, page_size: int = 10
    ) -> list[Message]:
        """
        Get messages for a conversation:
        1. Order by sequence DESC for correct pagination (most recent first)
        2. Apply offset and limit
        3. Reverse final results for chronological display
        """
        messages = (
            db.query(Message)
            .filter(Message.conversation_id == conversation_id)
            .order_by(desc(Message.sequence))  # newest first for pagination
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )

        # Reverse the results to get chronological order
        return list(reversed(messages))

    def resequence_messages(
        self, db: Session, *, conversation_id: UUID, gap: int = 10
    ) -> None:
        """
        Resequence all messages in a conversation with specified gaps
        Useful when needing to insert messages between existing ones
        """
        messages = self.get_conversation_messages(db, conversation_id=conversation_id)
        for i, message in enumerate(messages):
            message.sequence = (i + 1) * gap  # type: ignore
        db.commit()


# Create a single instance to use throughout the application
message_crud = MessageCRUD(Message)
