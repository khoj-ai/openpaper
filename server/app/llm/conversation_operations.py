import logging
import uuid
from typing import Optional, Union

from app.database.crud.conversation_crud import ConversationUpdate, conversation_crud
from app.database.crud.message_crud import message_crud
from app.database.database import get_db
from app.database.models import Conversation
from app.llm.base import BaseLLMClient, ModelType
from app.llm.prompts import (
    NAME_DATA_TABLE_SYSTEM_PROMPT,
    NAME_DATA_TABLE_USER_MESSAGE,
    RENAME_CONVERSATION_SYSTEM_PROMPT,
    RENAME_CONVERSATION_USER_MESSAGE,
)
from app.llm.provider import TextContent
from app.schemas.user import CurrentUser
from fastapi import Depends
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


class ConversationOperations(BaseLLMClient):
    """Operations related to conversations"""

    def rename_conversation(
        self,
        conversation_id: str,
        user: CurrentUser,
        db: Session = Depends(get_db),
    ) -> Union[str, None]:
        """
        Rename a conversation based on its chat history
        """
        casted_uuid = uuid.UUID(conversation_id)
        conversation: Optional[Conversation] = conversation_crud.get_conversation_by_id(
            db, conversation_id=casted_uuid, user_id=user.id
        )

        if not conversation:
            raise ValueError(f"Conversation with ID {conversation_id} not found.")

        chat_history = message_crud.get_conversation_messages(
            db, conversation_id=casted_uuid, current_user=user
        )

        if not chat_history:
            logger.warning(
                f"Conversation with ID {conversation_id} has no messages. Cannot rename."
            )
            return

        # Format the chat history for the LLM, restrict to the last 4 messages
        formatted_chat_history = "\n".join(
            [f"{msg.role}: {msg.content}" for msg in chat_history[-4:]]
        )

        formatted_prompt = RENAME_CONVERSATION_USER_MESSAGE.format(
            chat_history=formatted_chat_history
        )

        message_content = [
            TextContent(text=formatted_prompt),
        ]

        # Generate a new title using the LLM
        response = self.generate_content(
            contents=message_content,
            system_prompt=RENAME_CONVERSATION_SYSTEM_PROMPT,
            model_type=ModelType.FAST,
        )

        if response and response.text:
            new_title = response.text.strip()
            new_conversation = ConversationUpdate(
                title=new_title,
            )
            conversation_crud.update(
                db,
                db_obj=conversation,
                obj_in=new_conversation,
                user=user,
            )
            return response.text.strip()
        else:
            logger.error(
                f"Failed to generate a new title for conversation {conversation_id}."
            )
            return None


class DataTableOperations(BaseLLMClient):
    """Operations related to data tables"""

    def name_data_table(
        self,
        paper_titles: list[str],
        column_labels: list[str],
    ) -> str | None:
        """
        Generate a concise title for a data table based on paper titles and column labels.

        Args:
            paper_titles: List of paper titles included in the data table
            column_labels: List of column labels in the data table

        Returns:
            A title of 10 words or less, or None if generation fails
        """
        formatted_papers = "\n".join([f"- {title}" for title in paper_titles])
        formatted_columns = ", ".join(column_labels)

        formatted_prompt = NAME_DATA_TABLE_USER_MESSAGE.format(
            paper_titles=formatted_papers,
            column_labels=formatted_columns,
        )

        message_content = [
            TextContent(text=formatted_prompt),
        ]

        response = self.generate_content(
            contents=message_content,
            system_prompt=NAME_DATA_TABLE_SYSTEM_PROMPT,
            model_type=ModelType.FAST,
        )

        if response and response.text:
            return response.text.strip()
        else:
            logger.error("Failed to generate a title for the data table.")
            return None
