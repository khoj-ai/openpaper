import logging
import uuid
from typing import Any, Optional, Union

from app.database.crud.conversation_crud import ConversationUpdate, conversation_crud
from app.database.crud.message_crud import message_crud
from app.database.database import get_db
from app.database.models import Conversation
from app.llm.base import BaseLLMClient, ModelType
from app.llm.prompts import (
    NAME_DATA_TABLE_SYSTEM_PROMPT,
    NAME_DATA_TABLE_USER_MESSAGE,
    PROPOSE_DATA_TABLE_INVESTIGATION_SYSTEM_PROMPT,
    PROPOSE_DATA_TABLE_INVESTIGATION_USER_MESSAGE,
    PROPOSE_DATA_TABLE_SCHEMA_FINAL_SYSTEM_PROMPT,
    PROPOSE_DATA_TABLE_SCHEMA_FINAL_USER_MESSAGE,
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


class ProposedColumn(BaseModel):
    # Strict structured output (OpenAI) requires additionalProperties=false
    # and all fields required — hence no defaults.
    model_config = ConfigDict(extra="forbid")

    label: str = Field(description="Column label")
    kind: str = Field(
        description="'primitive' if the value is a single value stated in papers and extracted verbatim; 'list' if it is a collection of stated values (one entry per instance in the paper, e.g. one score per evaluated model); 'computed' if it must be computed from other columns"
    )
    spec: str = Field(
        description="For computed columns: a precise natural-language description of the computation over the input columns, e.g. 'Cohen's d between the treatment and control arms using their means, SDs, and sample sizes'. Empty string for other columns."
    )
    inputs: list[str] = Field(
        description="For computed columns: the exact labels of the proposed columns the computation reads. Empty list for other columns."
    )
    evidence: str = Field(
        description="Where the papers ground this column: which papers/tables/sections report it and roughly how widely. Empty string for computed columns (their grounding is their inputs)."
    )


class DataTableSchemaProposal(BaseModel):
    model_config = ConfigDict(extra="forbid")

    columns: list[ProposedColumn] = Field(
        description="Proposed columns for the data table"
    )


class FieldInvestigation(BaseModel):
    """The reusable, evidence-preserving output of a field investigation."""

    findings: str
    evidence: dict[str, list[str]] = Field(default_factory=dict)
    trace: dict[str, Any] = Field(default_factory=dict)


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

    def investigate_fields(
        self,
        *,
        prompt: str,
        papers: list[tuple[str, str]],
        current_user: CurrentUser,
        db: Session,
        project_id: str,
        system_prompt: str,
        user_message: str,
    ) -> FieldInvestigation:
        """Run the Data Table's bounded, tool-using shape-finding harness.

        Besides the investigator report, retain the source passages by paper so
        downstream artifact builders can validate exact quotes instead of
        receiving only a prose hand-off.
        """
        paper_ids = [paper_id for paper_id, _ in papers]
        function_declarations = [
            read_abstract_function,
            search_all_files_function,
            search_file_function,
            view_file_function,
        ]
        function_maps = {
            "read_abstract": read_abstract,
            "search_all_files": search_all_files,
            "search_file": search_file,
            "view_file": view_file,
        }
        paper_titles = dict(papers)
        tool_call_results: list[ToolCallResult] = []
        evidence: dict[str, list[str]] = {}
        total_result_chars = 0
        seen_calls: set[str] = set()
        investigation_report = ""
        # What the agent actually did, in order. Generic phase labels ("Collected
        # source passages") tell a reader nothing about why a paper is missing;
        # the search terms and hit counts do.
        steps: list[str] = []

        def title_of(paper_id: str) -> str:
            return paper_titles.get(str(paper_id), str(paper_id))

        for turn in range(self.PROPOSE_MAX_TURNS):
            response = self.generate_content(
                contents=[TextContent(text=user_message)],
                system_prompt=system_prompt.format(
                    n_round=turn + 1,
                    max_rounds=self.PROPOSE_MAX_TURNS,
                ),
                model_type=ModelType.FAST,
                function_declarations=function_declarations,
                tool_call_results=tool_call_results or None,
                provider=LLMProvider.GEMINI,
            )
            if not response or not response.tool_calls:
                investigation_report = (response.text or "").strip() if response else ""
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
                            result="Error: investigation budget exhausted — stop calling tools and reply with your findings report",
                        )
                    )
                    continue

                try:
                    raw: Any = function_maps[call.name](
                        **call.args,
                        current_user=current_user,
                        db=db,
                        project_id=project_id,
                        restrict_to_paper_ids=paper_ids,
                    )
                    result = str(raw)[: self.PROPOSE_TOOL_RESULT_CHARS]
                    total_result_chars += len(result)
                    if call.name == "search_all_files" and isinstance(raw, dict):
                        hits = 0
                        for paper_id, lines in raw.items():
                            evidence.setdefault(str(paper_id), []).extend(
                                map(str, lines)
                            )
                            hits += len(lines)
                        steps.append(
                            f'Searched every paper for "{call.args.get("query", "")}" — '
                            f"{hits} matching line{'s' if hits != 1 else ''} in {len(raw)} paper{'s' if len(raw) != 1 else ''}"
                        )
                    elif call.args.get("paper_id") and isinstance(raw, (str, list)):
                        lines = [raw] if isinstance(raw, str) else [str(x) for x in raw]
                        evidence.setdefault(str(call.args["paper_id"]), []).extend(
                            lines
                        )
                        target = title_of(call.args["paper_id"])
                        if call.name == "search_file":
                            steps.append(
                                f'Searched "{target}" for "{call.args.get("query", "")}" — '
                                f"{len(lines)} matching line{'s' if len(lines) != 1 else ''}"
                            )
                        elif call.name == "view_file":
                            steps.append(
                                f'Read "{target}" lines {call.args.get("range_start")}–{call.args.get("range_end")}'
                            )
                        else:
                            steps.append(f'Read the abstract of "{target}"')
                except Exception as exc:
                    result = f"Error: {exc}"
                    steps.append(f"{call.name} failed: {exc}")

                tool_call_results.append(
                    ToolCallResult(
                        id=call.id,
                        name=call.name,
                        args=call.args,
                        result=result,
                        thought_signature=call.thought_signature,
                    )
                )

        gathered = "\n\n".join(
            f"[{result.name}({result.args})]\n{result.result}"
            for result in tool_call_results
        )
        findings = "\n\n".join(
            part
            for part in (
                (
                    f"Investigator's report:\n{investigation_report}"
                    if investigation_report
                    else ""
                ),
                f"Raw tool results:\n\n{gathered}" if gathered else "",
            )
            if part
        )
        covered = sum(1 for lines in evidence.values() if lines)
        status_messages = [
            f"Searching {len(papers)} selected paper{'s' if len(papers) != 1 else ''}",
            *steps,
            f"Gathered passages from {covered} of {len(papers)} paper{'s' if len(papers) != 1 else ''}",
        ]
        if investigation_report:
            summary = " ".join(investigation_report.split())
            status_messages.append(
                f"Investigator's read: {summary[:400]}{'…' if len(summary) > 400 else ''}"
            )
        return FieldInvestigation(
            findings=findings,
            evidence=evidence,
            trace={
                "status_messages": status_messages,
                "tool_calls": [
                    {"name": result.name, "args": result.args}
                    for result in tool_call_results
                ],
            },
        )

    def propose_data_table_schema(
        self,
        prompt: str,
        papers: list[tuple[str, str]],
        current_user: CurrentUser,
        db: Session,
        project_id: str,
    ) -> list[ProposedColumn] | None:
        """
        Propose data table columns from a natural language description, in two
        phases with distinct responsibilities: an investigator agent gathers
        grounding from the project's papers (search/read tools, closing with a
        findings report), then a separate schema-constrained synthesis call —
        the only place columns are authored — turns those findings into the
        proposal.

        The deliverable is fixed either way: the structured ProposedColumn
        contract with per-column evidence. This flow proposes columns only —
        values always come from the extraction pass.

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
        ]
        function_maps = {
            "read_abstract": read_abstract,
            "search_all_files": search_all_files,
            "search_file": search_file,
            "view_file": view_file,
        }

        message_content = [
            TextContent(
                text=PROPOSE_DATA_TABLE_INVESTIGATION_USER_MESSAGE.format(
                    paper_roster=paper_roster,
                    prompt=prompt,
                )
            )
        ]

        tool_call_results: list[ToolCallResult] = []
        total_result_chars = 0
        seen_calls: set[str] = set()
        # The investigator's closing prose report — its hand-off to the
        # synthesis call, alongside the raw tool results.
        investigation_report = ""

        for turn in range(self.PROPOSE_MAX_TURNS):
            response = self.generate_content(
                contents=message_content,
                system_prompt=PROPOSE_DATA_TABLE_INVESTIGATION_SYSTEM_PROMPT.format(
                    n_round=turn + 1,
                    max_rounds=self.PROPOSE_MAX_TURNS,
                ),
                model_type=ModelType.FAST,
                function_declarations=function_declarations,
                tool_call_results=tool_call_results or None,
                provider=LLMProvider.GEMINI,
            )

            if not response or not response.tool_calls:
                # No more tool calls: the investigation is over, and any prose
                # is the investigator's findings report.
                investigation_report = (response.text or "").strip() if response else ""
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
                            result="Error: investigation budget exhausted — stop calling tools and reply with your findings report",
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

        # Synthesis: the only place columns are authored. Strict schema output,
        # grounded in the investigator's report plus the raw tool results.
        gathered = "\n\n".join(
            f"[{r.name}({r.args})]\n{r.result}" for r in tool_call_results
        )
        findings = "\n\n".join(
            part
            for part in (
                (
                    f"Investigator's report:\n{investigation_report}"
                    if investigation_report
                    else ""
                ),
                f"Raw tool results:\n\n{gathered}" if gathered else "",
            )
            if part
        )
        final_prompt = PROPOSE_DATA_TABLE_SCHEMA_FINAL_USER_MESSAGE.format(
            paper_roster=paper_roster,
            prompt=prompt,
            findings=findings or "(no investigation results)",
        )
        response = self.generate_content(
            contents=[TextContent(text=final_prompt)],
            system_prompt=PROPOSE_DATA_TABLE_SCHEMA_FINAL_SYSTEM_PROMPT,
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
        """Drop empty labels and demote malformed computed columns.

        A computed column is only usable if it has a spec and EVERY input
        resolves to a proposed EXTRACTED column (the create API rejects
        computed-on-computed, so the same rule applies here); anything else
        is demoted to primitive so the table still works.
        """
        extracted_labels = {
            c.label.strip() for c in columns if c.label.strip() and c.kind != "computed"
        }
        sanitized: list[ProposedColumn] = []

        for col in columns:
            label = col.label.strip()
            if not label:
                continue

            kind = (
                col.kind
                if col.kind in ("primitive", "list", "computed")
                else "primitive"
            )
            spec = col.spec.strip()
            inputs = [i.strip() for i in col.inputs if i.strip()]

            if kind == "computed" and (
                not spec
                or not inputs
                # Any unresolvable input makes the computation ungrounded —
                # demote rather than ship a dead column.
                or any(i not in extracted_labels for i in inputs)
            ):
                logger.warning(
                    f"Demoting malformed computed column proposal to primitive: {label}"
                )
                kind = "primitive"

            if kind != "computed":
                spec = ""
                inputs = []

            sanitized.append(
                ProposedColumn(
                    label=label,
                    kind=kind,
                    spec=spec,
                    inputs=inputs,
                    evidence=col.evidence.strip(),
                )
            )

        return sanitized
