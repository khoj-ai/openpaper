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
from app.llm.tools.file_tools import (
    read_abstract,
    read_abstract_function,
    search_all_files,
    search_all_files_function,
    search_file,
    search_file_function,
    view_file,
    view_file_function,
)
from app.schemas.responses import ToolCallResult
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
        description="'primitive' if the value is a single value stated in papers and extracted verbatim; 'list' if it is a collection of stated values (one entry per instance in the paper, e.g. one score per evaluated model); 'derived' if it must be computed from other columns"
    )
    expression: str = Field(
        description="For derived columns: arithmetic expression over the input aliases, e.g. 'cohens_d(mean_t, sd_t, n_t, mean_c, sd_c, n_c)' or '(a - b) / b * 100'. Empty string for primitive columns."
    )
    inputs: list[ProposedColumnInput] = Field(
        description="For derived columns: the aliases used in the expression, each mapped to a primitive column label. Empty list for primitive columns."
    )
    evidence: str = Field(
        description="Where the papers ground this column: which papers/tables/sections report it and roughly how widely. Empty string for derived columns (their grounding is their inputs)."
    )


class DataTableSchemaProposal(BaseModel):
    model_config = ConfigDict(extra="forbid")

    columns: list[ProposedColumn] = Field(
        description="Proposed columns for the data table"
    )


# Terminal tool for the propose agent: calling it IS submitting the proposal.
# Hand-written JSON schema (not model_json_schema) because the Gemini function
# converter rejects the strict additionalProperties pydantic emits.
propose_columns_function = {
    "name": "propose_columns",
    "description": "Submit the final proposed columns for the data table. Call this exactly once, after investigating the papers enough to ground every column in what they actually report.",
    "parameters": {
        "type": "object",
        "properties": {
            "columns": {
                "type": "array",
                "description": "The proposed columns, in display order",
                "items": {
                    "type": "object",
                    "properties": {
                        "label": {
                            "type": "string",
                            "description": "Column label, concise and specific; include units in parentheses where appropriate; suffix list columns with '(list)'",
                        },
                        "kind": {
                            "type": "string",
                            "enum": ["primitive", "list", "derived"],
                            "description": "primitive = single stated value extracted verbatim; list = one cited entry per instance in the paper; derived = computed from other columns by the calculator",
                        },
                        "expression": {
                            "type": "string",
                            "description": "Derived columns only: arithmetic expression over input aliases (whitelisted functions and + - * / ** operators). Empty string otherwise.",
                        },
                        "inputs": {
                            "type": "array",
                            "description": "Derived columns only: each alias used in the expression, mapped to a primitive or list column label. Empty otherwise.",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "alias": {"type": "string"},
                                    "column": {"type": "string"},
                                },
                                "required": ["alias", "column"],
                            },
                        },
                        "evidence": {
                            "type": "string",
                            "description": "Where the papers ground this column (papers/tables/sections that report it, and roughly how widely). 1-2 sentences. Refer to papers by their title, NEVER by their ID. Empty string for derived columns.",
                        },
                    },
                    "required": ["label", "kind", "expression", "inputs", "evidence"],
                },
            }
        },
        "required": ["columns"],
    },
}


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

    # Bounds for the propose agent: total LLM turns, and per-/total tool-result
    # character budgets so a broad search over a large corpus can't blow the
    # context.
    PROPOSE_MAX_TURNS = 6
    PROPOSE_TOOL_RESULT_CHARS = 8_000
    PROPOSE_TOOL_BUDGET_CHARS = 60_000

    def propose_data_table_schema(
        self,
        prompt: str,
        papers: list[tuple[str, str]],
        current_user: CurrentUser,
        db: Session,
        project_id: str,
    ) -> list[ProposedColumn] | None:
        """
        Propose data table columns from a natural language description, by
        letting an agent investigate the project's papers (search/read tools)
        and then submit a grounded proposal via the propose_columns tool.

        The agent explores freely but the deliverable is fixed: the same
        structured ProposedColumn contract, now with per-column evidence. It
        proposes columns only — values always come from the extraction pass.

        Args:
            prompt: The user's description of what they want to extract or compare
            papers: (paper_id, title) pairs for the project's papers
            current_user: Owner of the papers, for tool access checks
            db: Database session for the tools
            project_id: Project scope for the tools

        Returns:
            A list of proposed columns, or None if generation fails
        """
        paper_ids = [pid for pid, _ in papers]
        paper_roster = "\n".join(f"- [{pid}] {title}" for pid, title in papers)

        function_declarations = [
            read_abstract_function,
            search_all_files_function,
            search_file_function,
            view_file_function,
            propose_columns_function,
        ]
        function_maps = {
            "read_abstract": read_abstract,
            "search_all_files": search_all_files,
            "search_file": search_file,
            "view_file": view_file,
        }

        message_content = [
            TextContent(
                text=PROPOSE_DATA_TABLE_SCHEMA_USER_MESSAGE.format(
                    paper_roster=paper_roster,
                    prompt=prompt,
                )
            )
        ]

        tool_call_results: list[ToolCallResult] = []
        total_result_chars = 0
        seen_calls: set[str] = set()

        for turn in range(self.PROPOSE_MAX_TURNS):
            response = self.generate_content(
                contents=message_content,
                system_prompt=PROPOSE_DATA_TABLE_SCHEMA_SYSTEM_PROMPT,
                model_type=ModelType.FAST,
                function_declarations=function_declarations,
                tool_call_results=tool_call_results or None,
                provider=LLMProvider.GEMINI,
            )

            if not response or not response.tool_calls:
                # The agent answered in prose (or not at all) — force a
                # structured proposal from what it has gathered so far.
                logger.warning(
                    "Propose agent returned no tool call; forcing final proposal."
                )
                break

            proposal_call = next(
                (c for c in response.tool_calls if c.name == "propose_columns"),
                None,
            )
            if proposal_call:
                try:
                    proposal = DataTableSchemaProposal.model_validate(
                        proposal_call.args
                    )
                    columns = self._sanitize_proposal(proposal.columns)
                    if columns:
                        return columns
                except ValidationError:
                    logger.warning(
                        f"Invalid propose_columns args: {proposal_call.args}"
                    )
                break

            for call in response.tool_calls:
                if call.name not in function_maps:
                    tool_call_results.append(
                        ToolCallResult(
                            id=call.id,
                            name=call.name,
                            args=call.args,
                            thought_signature=call.thought_signature,
                            result=f"Error: unknown tool {call.name}",
                        )
                    )
                    continue

                call_key = f"{call.name}:{call.args}"
                if call_key in seen_calls:
                    tool_call_results.append(
                        ToolCallResult(
                            id=call.id,
                            name=call.name,
                            args=call.args,
                            thought_signature=call.thought_signature,
                            result="Error: this exact call was already made — use its earlier result",
                        )
                    )
                    continue
                seen_calls.add(call_key)

                if total_result_chars >= self.PROPOSE_TOOL_BUDGET_CHARS:
                    tool_call_results.append(
                        ToolCallResult(
                            id=call.id,
                            name=call.name,
                            args=call.args,
                            thought_signature=call.thought_signature,
                            result="Error: investigation budget exhausted — call propose_columns now with what you have",
                        )
                    )
                    continue

                try:
                    raw = function_maps[call.name](
                        **call.args,
                        current_user=current_user,
                        db=db,
                        project_id=project_id,
                        restrict_to_paper_ids=paper_ids,
                    )
                    result = str(raw)[: self.PROPOSE_TOOL_RESULT_CHARS]
                    total_result_chars += len(result)
                except Exception as e:
                    result = f"Error: {e}"

                tool_call_results.append(
                    ToolCallResult(
                        id=call.id,
                        name=call.name,
                        args=call.args,
                        result=result,
                        thought_signature=call.thought_signature,
                    )
                )

        # Turn budget exhausted or prose answer: one final structured call,
        # grounded in whatever the investigation produced. Strict schema output;
        # the gathered tool results ride along as context.
        gathered = "\n\n".join(
            f"[{r.name}({r.args})]\n{r.result}" for r in tool_call_results
        )
        final_prompt = (
            message_content[0].text
            + "\n\nFindings from your investigation of the papers:\n\n"
            + (gathered or "(no investigation results)")
            + "\n\nRespond only with the JSON proposal."
        )
        response = self.generate_content(
            contents=[TextContent(text=final_prompt)],
            system_prompt=PROPOSE_DATA_TABLE_SCHEMA_SYSTEM_PROMPT,
            model_type=ModelType.FAST,
            schema=DataTableSchemaProposal.model_json_schema(),
            provider=LLMProvider.GEMINI,
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

            kind = (
                col.kind
                if col.kind in ("primitive", "list", "derived")
                else "primitive"
            )
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

            if kind != "derived":
                expression = ""
                inputs = []

            sanitized.append(
                ProposedColumn(
                    label=label,
                    kind=kind,
                    expression=expression,
                    inputs=inputs,
                    evidence=col.evidence.strip(),
                )
            )

        return sanitized
