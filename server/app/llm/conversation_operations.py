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
    PROPOSE_DATA_TABLE_SCHEMA_SYSTEM_PROMPT,
    PROPOSE_DATA_TABLE_SCHEMA_USER_MESSAGE,
    RENAME_CONVERSATION_SYSTEM_PROMPT,
    RENAME_CONVERSATION_USER_MESSAGE,
)
from app.llm.provider import LLMProvider, TextContent
from app.schemas.user import CurrentUser
from fastapi import Depends
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


class ProposedColumnInput(BaseModel):
    # Strict structured output (OpenAI/Cerebras) requires additionalProperties=false
    # and all fields required — hence pair-list instead of dict, and no defaults.
    model_config = ConfigDict(extra="forbid")

    alias: str = Field(
        description="Short snake_case identifier used in the expression, e.g. 'mean_t'"
    )
    column: str = Field(
        description="Exact label of the primitive column this alias refers to"
    )


class ProposedColumn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: str = Field(description="Column label")
    kind: str = Field(
        description="'primitive' if the value is stated in papers and extracted verbatim; 'derived' if it must be computed from other columns"
    )
    expression: str = Field(
        description="For derived columns: arithmetic expression over the input aliases, e.g. 'cohens_d(mean_t, sd_t, n_t, mean_c, sd_c, n_c)' or '(a - b) / b * 100'. Empty string for primitive columns."
    )
    inputs: list[ProposedColumnInput] = Field(
        description="For derived columns: the aliases used in the expression, each mapped to a primitive column label. Empty list for primitive columns."
    )


class DataTableSchemaProposal(BaseModel):
    model_config = ConfigDict(extra="forbid")

    columns: list[ProposedColumn] = Field(
        description="Proposed columns for the data table"
    )


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

    def propose_data_table_schema(
        self,
        prompt: str,
        paper_titles: list[str],
    ) -> list[ProposedColumn] | None:
        """
        Propose data table columns from a natural language description,
        classifying each as primitive (extracted verbatim) or derived
        (computed by the calculator from primitive columns).

        Args:
            prompt: The user's description of what they want to extract or compare
            paper_titles: List of paper titles in the project, used as context

        Returns:
            A list of proposed columns, or None if generation fails
        """
        formatted_papers = "\n".join([f"- {title}" for title in paper_titles])

        formatted_prompt = PROPOSE_DATA_TABLE_SCHEMA_USER_MESSAGE.format(
            paper_titles=formatted_papers,
            prompt=prompt,
        )

        message_content = [
            TextContent(text=formatted_prompt),
        ]

        response = self.generate_content(
            contents=message_content,
            system_prompt=PROPOSE_DATA_TABLE_SCHEMA_SYSTEM_PROMPT,
            model_type=ModelType.FAST,
            schema=DataTableSchemaProposal.model_json_schema(),
            provider=LLMProvider.CEREBRAS,
        )

        if response and response.text:
            try:
                proposal = DataTableSchemaProposal.model_validate_json(response.text)
                columns = self._sanitize_proposal(proposal.columns)
                if columns:
                    return columns
            except ValidationError:
                logger.warning(
                    f"Failed to parse data table schema proposal: {response.text}"
                )

        logger.error("Failed to propose a schema for the data table.")
        return None

    @staticmethod
    def _sanitize_proposal(columns: list[ProposedColumn]) -> list[ProposedColumn]:
        """Drop empty labels and demote malformed derived columns.

        A derived column is only usable if it has an expression and EVERY
        input alias resolves to a proposed PRIMITIVE column (the create API
        rejects derived-on-derived, so the same rule applies here); anything
        else is demoted to primitive so the table still works.
        """
        primitive_labels = {
            c.label.strip() for c in columns if c.label.strip() and c.kind != "derived"
        }
        sanitized: list[ProposedColumn] = []

        for col in columns:
            label = col.label.strip()
            if not label:
                continue

            kind = col.kind if col.kind in ("primitive", "derived") else "primitive"
            expression = col.expression.strip()
            inputs = [
                ProposedColumnInput(alias=i.alias.strip(), column=i.column.strip())
                for i in col.inputs
            ]

            if kind == "derived" and (
                not expression
                or not inputs
                # Any unresolvable input makes the whole expression
                # uncomputable — demote rather than ship a dead column.
                or any(not i.alias or i.column not in primitive_labels for i in inputs)
            ):
                logger.warning(
                    f"Demoting malformed derived column proposal to primitive: {label}"
                )
                kind = "primitive"

            if kind == "primitive":
                expression = ""
                inputs = []

            sanitized.append(
                ProposedColumn(
                    label=label, kind=kind, expression=expression, inputs=inputs
                )
            )

        return sanitized
