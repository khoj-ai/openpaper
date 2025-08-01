import json
import logging
import re
import uuid
from typing import AsyncGenerator, Dict, List, Optional, Sequence, Union

from app.database.crud.paper_crud import paper_crud
from app.llm.base import BaseLLMClient, ModelType
from app.llm.citation_handler import CitationHandler
from app.llm.json_parser import JSONParser
from app.llm.prompts import (
    ANSWER_EVIDENCE_BASED_QUESTION_MESSAGE,
    ANSWER_EVIDENCE_BASED_QUESTION_SYSTEM_PROMPT,
    EVIDENCE_CLEANING_PROMPT,
    EVIDENCE_GATHERING_MESSAGE,
    EVIDENCE_GATHERING_SYSTEM_PROMPT,
    PREVIOUS_TOOL_CALLS_MESSAGE,
)
from app.llm.provider import LLMProvider, TextContent
from app.llm.tools.file_tools import (
    read_abstract,
    read_abstract_function,
    read_file,
    read_file_function,
    search_all_files,
    search_all_files_function,
    search_file,
    search_file_function,
    view_file,
    view_file_function,
)
from app.llm.tools.meta_tools import stop_function
from app.schemas.message import EvidenceCleaningResponse, EvidenceCollection
from app.schemas.user import CurrentUser
from fastapi import Depends
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

from app.database.crud.message_crud import message_crud
from app.database.database import get_db


class MultiPaperOperations(BaseLLMClient):
    """Operations related to multi-paper analysis and chat functionality"""

    async def gather_evidence(
        self,
        conversation_id: str,
        question: str,
        current_user: CurrentUser,
        llm_provider: Optional[LLMProvider] = None,
        user_references: Optional[Sequence[str]] = None,
        db: Session = Depends(get_db),
    ) -> AsyncGenerator[Dict[str, Union[str, Dict[str, List[str]]]], None]:
        """
        Gather evidence from multiple papers based on the user's question
        This function will interact with the LLM to gather relevant information
        and citations from the user's knowledge base.
        """

        user_citations = (
            CitationHandler.convert_references_to_citations(user_references)
            if user_references
            else None
        )

        casted_conversation_id = uuid.UUID(conversation_id)

        conversation_history = message_crud.get_conversation_messages(
            db, conversation_id=casted_conversation_id, current_user=current_user
        )

        # Initialize evidence collection
        evidence_collection = EvidenceCollection()

        # We need to start off here with evidence gathering in order to answer this query that traverses the entire knowledge base arbitrarily. In order to do that, we need to setup an agent loop that will continue to gather evidence until we have enough to answer the question. Let it max out at 5 iterations before we force it to cancel, if it hasn't already provided a STOP signal.

        n_iterations = 0
        max_iterations = 4

        all_papers = paper_crud.get_all_available_papers(
            db,
            user=current_user,
        )

        formatted_paper_options = {str(paper.id): paper.title for paper in all_papers}

        function_declarations = [
            read_file_function,
            search_file_function,
            view_file_function,
            read_abstract_function,
            search_all_files_function,
            stop_function,
        ]

        function_maps = {
            "read_file": read_file,
            "search_file": search_file,
            "view_file": view_file,
            "read_abstract": read_abstract,
            "search_all_files": search_all_files,
            "stop": lambda: None,
        }

        while n_iterations < max_iterations:
            n_iterations += 1

            prev_tool_calls_message = (
                PREVIOUS_TOOL_CALLS_MESSAGE.format(
                    previous_tool_calls=json.dumps(
                        evidence_collection.get_previous_tool_calls_dict()
                    ),
                    iteration=n_iterations,
                    total_iterations=max_iterations,
                )
                if evidence_collection.has_previous_tool_calls()
                else ""
            )

            evidence_gathering_prompt = EVIDENCE_GATHERING_SYSTEM_PROMPT.format(
                available_papers=formatted_paper_options,
                previous_tool_calls=prev_tool_calls_message,
                gathered_evidence=json.dumps(
                    evidence_collection.get_evidence_dict_with_metadata()
                ),
            )

            formatted_prompt = EVIDENCE_GATHERING_MESSAGE.format(
                question=question,
            )

            message_content = [
                TextContent(text=formatted_prompt),
            ]

            llm_response = self.generate_content(
                system_prompt=evidence_gathering_prompt,
                history=conversation_history,
                contents=message_content,
                model_type=ModelType.DEFAULT,
                function_declarations=function_declarations,
                provider=llm_provider,
                enable_thinking=True,
            )

            for fn_selected in llm_response.tool_calls:
                fn_name = fn_selected.name
                fn_args = fn_selected.args

                evidence_collection.add_tool_call(fn_selected)

                if fn_name == "stop":
                    logger.info("Received STOP signal from LLM.")
                    yield {"type": "stop", "content": "STOP signal received."}
                    break

                if fn_name in function_maps:
                    try:
                        paper_id_arg = fn_args.get("paper_id")
                        query_arg = fn_args.get("query")
                        paper_name = (
                            formatted_paper_options.get(
                                str(paper_id_arg), "knowledge base"
                            )
                            if paper_id_arg
                            else "knowledge base"
                        )

                        if paper_id_arg and paper_id_arg not in formatted_paper_options:
                            logger.warning(
                                f"Paper ID {paper_id_arg} not found in available papers."
                            )
                            continue

                        display_query = f" '{query_arg}'" if query_arg else ""

                        pretty_fn_name = fn_name.replace("_", " ").title()

                        yield {
                            "type": "status",
                            "content": f"{pretty_fn_name} - {paper_name}{display_query}",
                        }

                        logger.debug(f"Thinking process - {llm_response.thinking}")

                        result = function_maps[fn_name](
                            **fn_args,
                            current_user=current_user,
                            db=db,
                        )

                        # Determine if we should preserve line numbers based on function type
                        preserve_line_numbers = fn_name in [
                            "search_file",
                            "search_all_files",
                        ]

                        if fn_name == "search_all_files" and isinstance(result, dict):
                            # If the function is search_all_files, we expect a dictionary of results
                            for paper_id, lines in result.items():
                                evidence_collection.add_evidence(
                                    paper_id, lines, preserve_line_numbers=True
                                )

                        # Update the evidence_collection based on the result of the function call
                        paper_id = fn_args.get("paper_id")
                        if paper_id and (
                            isinstance(result, str) or isinstance(result, list)
                        ):
                            evidence_collection.add_evidence(
                                paper_id,
                                result,
                                preserve_line_numbers=preserve_line_numbers,
                            )

                    except Exception as e:
                        logger.error(f"Error executing function {fn_name}: {e}")
                        yield {"type": "error", "content": str(e)}
                else:
                    logger.warning(f"Unknown function called: {fn_name}")
                    yield {"type": "error", "content": f"Unknown function: {fn_name}"}

        yield {
            "type": "evidence_gathered",
            "content": evidence_collection.get_evidence_dict(),
        }

    async def clean_evidence(
        self,
        evidence_collection: EvidenceCollection,
        original_question: str,
        llm_provider: Optional[LLMProvider] = None,
    ) -> EvidenceCollection:
        """
        Clean and filter evidence to remove irrelevant snippets before final answer generation
        """
        evidence_dict = evidence_collection.get_evidence_dict()

        formatted_prompt = EVIDENCE_CLEANING_PROMPT.format(
            question=original_question,
            evidence=json.dumps(evidence_dict, indent=2),
            schema=EvidenceCleaningResponse.model_json_schema(),
        )

        message_content = [TextContent(text=formatted_prompt)]

        # Get LLM assessment of evidence relevance
        llm_response = self.generate_content(
            system_prompt="You are a research assistant that filters evidence for relevance.",
            contents=message_content,
            model_type=ModelType.FAST,
            provider=llm_provider,
        )

        try:
            if llm_response and llm_response.text:
                filtering_instructions = JSONParser.validate_and_extract_json(
                    llm_response.text
                )
                filtering_instructions = EvidenceCleaningResponse.model_validate(
                    filtering_instructions
                )
                cleaned_collection = EvidenceCollection()

                # Apply filtering instructions
                for paper_id, instructions in filtering_instructions.papers.items():
                    if paper_id in evidence_dict:
                        original_snippets = evidence_dict[paper_id]

                        # Keep specified snippets
                        for idx in instructions.keep:
                            if 0 <= idx < len(original_snippets):
                                cleaned_collection.add_evidence(
                                    paper_id, [original_snippets[idx]]
                                )

                        # Add summary for snippets to be summarized
                        if instructions.summarize and instructions.summary:
                            cleaned_collection.add_evidence(
                                paper_id, [instructions.summary]
                            )

                logger.info(
                    f"Evidence cleaning complete. Original: {len(evidence_dict)} papers, "
                    f"Cleaned: {len(cleaned_collection.get_evidence_dict())} papers"
                )

                return cleaned_collection
            else:
                logger.warning("Empty response from LLM during evidence cleaning.")
                return evidence_collection

        except Exception as e:
            logger.warning(
                f"Evidence cleaning failed: {e}. Returning original evidence."
            )
            return evidence_collection

    async def chat_with_everything(
        self,
        conversation_id: str,
        question: str,
        current_user: CurrentUser,
        evidence_gathered: EvidenceCollection,
        llm_provider: Optional[LLMProvider] = None,
        user_references: Optional[Sequence[str]] = None,
        db: Session = Depends(get_db),
    ) -> AsyncGenerator[Union[str, dict], None]:
        """
        Chat with everything in the user's knowledge base using the specified model
        """
        user_citations = (
            CitationHandler.convert_references_to_citations(user_references)
            if user_references
            else None
        )

        casted_conversation_id = uuid.UUID(conversation_id)

        conversation_history = message_crud.get_conversation_messages(
            db, conversation_id=casted_conversation_id, current_user=current_user
        )

        all_papers = paper_crud.get_all_available_papers(
            db,
            user=current_user,
        )

        formatted_paper_options = {
            str(paper.id): str(paper.title) for paper in all_papers
        }

        logger.debug(f"Evidence gathered: {evidence_gathered.get_evidence_dict()}")

        formatted_system_prompt = ANSWER_EVIDENCE_BASED_QUESTION_SYSTEM_PROMPT.format(
            evidence_gathered=evidence_gathered.get_evidence_dict(),
            available_papers=formatted_paper_options,
        )

        formatted_prompt = ANSWER_EVIDENCE_BASED_QUESTION_MESSAGE.format(
            question=f"{question}\n\n{user_citations}" if user_citations else question,
        )

        evidence_buffer: list[str] = []
        text_buffer: str = ""
        in_evidence_section = False

        START_DELIMITER = "---EVIDENCE---"
        END_DELIMITER = "---END-EVIDENCE---"

        message_content = [
            TextContent(text=formatted_prompt),
        ]
        # Chat with the paper using the LLM
        for chunk in self.send_message_stream(
            message=message_content,
            system_prompt=formatted_system_prompt,
            history=conversation_history,
            provider=llm_provider,
        ):
            text = chunk.text

            logger.debug(f"Received chunk: {text}")

            if not text:
                continue

            text_buffer += text

            # Check for start delimiter
            if not in_evidence_section and START_DELIMITER in text_buffer:
                in_evidence_section = True
                # Split at delimiter and yield any content that came before
                pre_evidence = text_buffer.split(START_DELIMITER)[0]
                if pre_evidence:
                    yield {"type": "content", "content": pre_evidence}
                # Start the evidence buffer
                evidence_buffer = [text_buffer.split(START_DELIMITER)[1]]
                # Clear the text buffer
                text_buffer = ""
                continue

            reconstructed_buffer = "".join(evidence_buffer + [text_buffer]).strip()

            if in_evidence_section and END_DELIMITER in reconstructed_buffer:
                # Find the position of the delimiter in the reconstructed buffer
                delimiter_pos = reconstructed_buffer.find(END_DELIMITER)
                evidence_part = reconstructed_buffer[:delimiter_pos]
                remaining = reconstructed_buffer[delimiter_pos + len(END_DELIMITER) :]

                # Parse the complete evidence block
                structured_evidence = CitationHandler.parse_multi_paper_evidence_block(
                    evidence_part
                )

                # Yield both raw and structured evidence
                yield {
                    "type": "references",
                    "content": {
                        "citations": structured_evidence,
                    },
                }

                # Reset buffers and state
                in_evidence_section = False
                evidence_buffer = []
                text_buffer = remaining

                # Yield any remaining content after evidence section
                if remaining:
                    yield {"type": "content", "content": remaining}
                continue

            # Handle normal streaming
            if in_evidence_section:
                evidence_buffer.append(text)
                text_buffer = ""
            else:
                # Keep a reasonable buffer size for detecting delimiters
                if len(text_buffer) > len(START_DELIMITER) * 2:
                    to_yield = text_buffer[: -len(START_DELIMITER)]
                    yield {"type": "content", "content": to_yield}
                    text_buffer = text_buffer[-len(START_DELIMITER) :]

        # Handle case where stream ended while still in evidence section
        if in_evidence_section and evidence_buffer:
            # Process any remaining evidence even without END_DELIMITER
            reconstructed_buffer = "".join(evidence_buffer + [text_buffer]).strip()
            logger.warning(
                "Stream ended while in evidence section without END_DELIMITER"
            )

            if reconstructed_buffer:
                try:
                    structured_evidence = (
                        CitationHandler.parse_multi_paper_evidence_block(
                            reconstructed_buffer
                        )
                    )

                    yield {
                        "type": "references",
                        "content": {
                            "citations": structured_evidence,
                        },
                    }
                except Exception as e:
                    logger.error(f"Failed to parse incomplete evidence block: {e}")
                    # Fall back to yielding as regular content
                    yield {"type": "content", "content": reconstructed_buffer}

            # Clear the text buffer since we processed everything
            text_buffer = ""

        # Yield any remaining text buffer content
        if text_buffer:
            yield {"type": "content", "content": text_buffer}
