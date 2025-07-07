from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional
from uuid import UUID

from app.database.crud.base_crud import CRUDBase
from app.database.models import Message
from app.schemas.user import CurrentUser
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

    def create(
        self, db: Session, *, obj_in: MessageCreate, current_user: CurrentUser
    ) -> Message:
        """Create a new message with auto-incrementing sequence number"""
        # Get the next sequence number for this conversation
        max_sequence = (
            db.query(func.max(Message.sequence))
            .filter(
                Message.conversation_id == obj_in.conversation_id,
                Message.user_id == current_user.id,
            )
            .scalar()
        )
        next_sequence = (max_sequence or 0) + 1

        # Convert Pydantic model to dict and add sequence
        obj_in_data = obj_in.model_dump(exclude_unset=True)
        db_obj = Message(**obj_in_data, sequence=next_sequence, user_id=current_user.id)

        db.add(db_obj)
        db.commit()
        db.refresh(db_obj)
        return db_obj

    def get_conversation_messages(
        self,
        db: Session,
        *,
        conversation_id: UUID,
        current_user: CurrentUser,
        page: int = 1,
        page_size: int = 10
    ) -> list[Message]:
        """
        Get messages for a conversation:
        1. Order by sequence DESC for correct pagination (most recent first)
        2. Apply offset and limit
        3. Reverse final results for chronological display
        """
        messages = (
            db.query(Message)
            .filter(
                Message.conversation_id == conversation_id,
                Message.user_id == current_user.id,
            )
            .order_by(desc(Message.sequence))  # newest first for pagination
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )

        # Reverse the results to get chronological order
        return list(reversed(messages))

    def messages_to_dict(self, messages: list[Message]) -> list[Dict[str, Any]]:
        """
        Convert a list of Message objects to a list of dictionaries
        """

        formatted_messages = []
        for message in messages:
            message_dict = {
                "id": str(message.id),
                "role": message.role,
                "content": message.content,
                "references": message.references,
                "bucket": message.bucket,
                "sequence": message.sequence,
            }
            formatted_messages.append(message_dict)
        return formatted_messages

    def resequence_messages(
        self,
        db: Session,
        *,
        conversation_id: UUID,
        current_user: CurrentUser,
        gap: int = 10
    ) -> None:
        """
        Resequence all messages in a conversation with specified gaps
        Useful when needing to insert messages between existing ones
        """
        messages = self.get_conversation_messages(
            db, conversation_id=conversation_id, current_user=current_user
        )
        for i, message in enumerate(messages):
            message.sequence = (i + 1) * gap  # type: ignore
        db.commit()

    def get_chat_credits_used_this_week(
        self, db: Session, *, current_user: CurrentUser
    ) -> int:
        """
        Get the number of chat credits used by the user this week.
        """
        # Start from the nearest Monday at 00:00 UTC
        start_of_week = datetime.now(timezone.utc) - timedelta(
            days=datetime.now(timezone.utc).weekday()
        )
        start_of_week = start_of_week.replace(hour=0, minute=0, second=0, microsecond=0)
        end_of_week = start_of_week + timedelta(days=7)
        # We'll define a `chat credit` as being equal to the value of 5 characters processed. To compute, we take the length of the content of each message and divide by 5.
        return (
            db.query(func.sum(func.length(Message.content)) / 5)
            .filter(
                Message.user_id == current_user.id,
                Message.created_at >= start_of_week,
                Message.created_at < end_of_week,
            )
            .scalar()
            or 0
        )


# Create a single instance to use throughout the application
message_crud = MessageCRUD(Message)
