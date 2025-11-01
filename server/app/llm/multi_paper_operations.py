import asyncio
import json
import logging
import re
import time
import uuid
from contextlib import suppress
from typing import AsyncGenerator, Dict, List, Literal, Optional, Sequence, Union

from app.database.crud.paper_crud import paper_crud
from app.database.crud.projects.project_crud import project_crud
from app.database.crud.projects.project_paper_crud import project_paper_crud
from app.database.models import Paper
from app.llm.base import BaseLLMClient, ModelType
from app.llm.citation_handler import CitationHandler
from app.llm.json_parser import JSONParser
from app.llm.prompts import (
    ANSWER_EVIDENCE_BASED_QUESTION_MESSAGE,
    ANSWER_EVIDENCE_BASED_QUESTION_SYSTEM_PROMPT,
    EVIDENCE_CLEANING_PROMPT,
    EVIDENCE_GATHERING_MESSAGE,
    EVIDENCE_GATHERING_SYSTEM_PROMPT,
    EVIDENCE_SUMMARIZATION_PROMPT,
    GENERATE_MULTI_PAPER_NARRATIVE_SUMMARY,
    PREVIOUS_TOOL_CALLS_MESSAGE,
)
from app.llm.provider import LLMProvider, StreamChunk, TextContent
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
from app.llm.utils import retry_llm_operation
from app.schemas.message import (
    EvidenceCleaningResponse,
    EvidenceCollection,
    EvidenceSummaryResponse,
)
from app.schemas.responses import AudioOverviewForLLM
from app.schemas.user import CurrentUser
from fastapi import Depends
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

from app.database.crud.message_crud import message_crud
from app.database.database import get_db
from app.database.telemetry import track_event

CONTENT_LIMIT_EVIDENCE_GATHERING = 200000  # Character limit for evidence gathering


class MultiPaperOperations(BaseLLMClient):
    """Operations related to multi-paper analysis and chat functionality"""

    @retry_llm_operation(max_retries=3, delay=1.0)
    async def gather_evidence(
        self,
        question: str,
        current_user: CurrentUser,
        conversation_id: Optional[str] = None,
        llm_provider: Optional[LLMProvider] = None,
        user_references: Optional[Sequence[str]] = None,
        project_id: Optional[str] = None,
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

        conversation_history = (
            message_crud.get_conversation_messages(
                db,
                conversation_id=uuid.UUID(conversation_id),
                current_user=current_user,
            )
            if conversation_id
            else []
        )

        # Initialize evidence collection
        evidence_collection = EvidenceCollection()

        # We need to start off here with evidence gathering in order to answer this query that traverses the entire knowledge base arbitrarily. In order to do that, we need to setup an agent loop that will continue to gather evidence until we have enough to answer the question. Let it max out at 5 iterations before we force it to cancel, if it hasn't already provided a STOP signal.

        n_iterations = 0
        max_iterations = 4

        if project_id:
            project = project_crud.get(db, id=project_id, user=current_user)
            if not project:
                raise ValueError("Project not found.")
            all_papers = project_paper_crud.get_all_papers_by_project_id(
                db, project_id=uuid.UUID(project_id), user=current_user
            )
        else:
            all_papers = paper_crud.get_all_available_papers(
                db,
                user=current_user,
            )

        formatted_paper_options = {
            str(paper.id): {
                "title": paper.title,
                "length": len(str(paper.raw_content)),
                "keywords": paper.keywords,
                "authors": paper.authors,
                "published": paper.publish_date,
            }
            for paper in all_papers
        }

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

            # If the collected evidence is very large (over 100,000 characters), we may want to stop gathering more evidence
            total_evidence_length = sum(
                sum(len(ev) for ev in ec.content)
                for ec in evidence_collection.evidence.values()
            )

            if total_evidence_length > CONTENT_LIMIT_EVIDENCE_GATHERING:
                yield {
                    "type": "status",
                    "content": "Gathered a lot of data. Compacting evidence...",
                }
                logger.info(
                    "Total evidence length exceeded 200,000 characters, compacting evidence."
                )
                evidence_collection = await self.compact_evidence_collection(
                    evidence_collection, question, current_user, llm_provider
                )

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
                model_type=ModelType.FAST,
                function_declarations=function_declarations,
                provider=llm_provider,
                enable_thinking=True,
            )

            for fn_selected in llm_response.tool_calls:
                start_time = time.time()
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
                            formatted_paper_options.get(str(paper_id_arg), {}).get(
                                "title", "knowledge base"
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
                            project_id=project_id,
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
                end_time = time.time()
                track_event(
                    "function_call",
                    {
                        "function_name": fn_name,
                        "duration_ms": (end_time - start_time) * 1000,
                    },
                    user_id=str(current_user.id),
                )

        yield {
            "type": "evidence_gathered",
            "content": evidence_collection.get_evidence_dict(),
        }

    async def compact_evidence_collection(
        self,
        evidence_collection: EvidenceCollection,
        original_question: str,
        current_user: CurrentUser,
        llm_provider: Optional[LLMProvider] = None,
    ) -> EvidenceCollection:
        """
        Compact the evidence collection by summarizing evidence for each paper.
        """

        # TODO what should we do if the evidence being passed in is already too big for inference? break up into chunks?

        start_time = time.time()
        evidence_dict = evidence_collection.get_evidence_dict()

        formatted_prompt = EVIDENCE_SUMMARIZATION_PROMPT.format(
            question=original_question,
            evidence=json.dumps(evidence_dict, indent=2),
            schema=EvidenceSummaryResponse.model_json_schema(),
        )

        message_content = [TextContent(text=formatted_prompt)]

        # Get LLM assessment of evidence relevance
        llm_response = self.generate_content(
            system_prompt="You are a research assistant that summarizes evidence.",
            contents=message_content,
            model_type=ModelType.DEFAULT,
            provider=llm_provider,
        )

        try:
            if llm_response and llm_response.text:
                summarization_instructions = JSONParser.validate_and_extract_json(
                    llm_response.text
                )
                summarization_instructions = EvidenceSummaryResponse.model_validate(
                    summarization_instructions
                )
                compacted_collection = EvidenceCollection()

                # Apply summarization
                for (
                    paper_id,
                    summary_data,
                ) in summarization_instructions.summaries.items():
                    if paper_id in evidence_dict:
                        # The new "evidence" is the summary.
                        compacted_collection.add_evidence(
                            paper_id, [summary_data], preserve_line_numbers=False
                        )

                logger.info(
                    f"Evidence compaction complete. Original: {len(evidence_dict)} papers, "
                    f"Compacted: {len(compacted_collection.get_evidence_dict())} papers"
                )

                track_event(
                    "evidence_compacted",
                    {
                        "duration_ms": (time.time() - start_time) * 1000,
                        "original_papers": len(evidence_dict),
                        "compacted_papers": len(
                            compacted_collection.get_evidence_dict()
                        ),
                    },
                    user_id=str(current_user.id),
                )

                return compacted_collection
            else:
                logger.warning("Empty response from LLM during evidence compaction.")
                return evidence_collection

        except Exception as e:
            logger.warning(
                f"Evidence compaction failed: {e}. Returning original evidence."
            )
            return evidence_collection

    async def clean_evidence(
        self,
        evidence_collection: EvidenceCollection,
        original_question: str,
        current_user: CurrentUser,
        llm_provider: Optional[LLMProvider] = None,
    ) -> EvidenceCollection:
        """
        Clean and filter evidence to remove irrelevant snippets before final answer generation
        """
        start_time = time.time()
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
            model_type=ModelType.DEFAULT,
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

                logger.info(
                    f"Evidence cleaning complete. Original: {len(evidence_dict)} papers, "
                    f"Cleaned: {len(cleaned_collection.get_evidence_dict())} papers"
                )

                track_event(
                    "evidence_cleaned",
                    {
                        "duration_ms": (time.time() - start_time) * 1000,
                        "original_papers": len(evidence_dict),
                        "cleaned_papers": len(cleaned_collection.get_evidence_dict()),
                    },
                    user_id=str(current_user.id),
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

    async def chat_with_papers(
        self,
        conversation_id: str,
        question: str,
        current_user: CurrentUser,
        all_papers: List[Paper],
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

        queue = asyncio.Queue()

        async def pinger():
            """Yields a status message every 5 seconds to keep the connection alive."""
            with suppress(asyncio.CancelledError):
                while True:
                    await queue.put({"type": "status", "content": "Thinking..."})
                    await asyncio.sleep(5)

        async def stream_reader():
            """Reads from the LLM stream and puts chunks into the queue."""
            _sentinel = object()

            def get_next_chunk(iterator):
                try:
                    return next(iterator)
                except StopIteration:
                    return _sentinel

            try:
                blocking_iterator = self.send_message_stream(
                    message=message_content,
                    system_prompt=formatted_system_prompt,
                    history=conversation_history,
                    provider=llm_provider,
                )
                while True:
                    chunk = await asyncio.to_thread(get_next_chunk, blocking_iterator)
                    if chunk is _sentinel:
                        break
                    await queue.put(chunk)
            finally:
                await queue.put(None)

        pinger_task = asyncio.create_task(pinger())
        stream_reader_task = asyncio.create_task(stream_reader())

        first_chunk_received = False

        try:
            while True:
                item = await queue.get()
                if item is None:  # Stream is done
                    break

                if isinstance(item, dict) and item.get("type") == "status":
                    yield item
                    continue

                if not first_chunk_received:
                    pinger_task.cancel()
                    first_chunk_received = True

                chunk: StreamChunk = item  # type: ignore
                text = chunk.text

                logger.debug(f"Received chunk: {text}")

                if not text:
                    continue

                text_buffer += text

                if not in_evidence_section and START_DELIMITER in text_buffer:
                    in_evidence_section = True
                    pre_evidence = text_buffer.split(START_DELIMITER)[0]
                    if pre_evidence:
                        yield {"type": "content", "content": pre_evidence}
                    evidence_buffer = [text_buffer.split(START_DELIMITER)[1]]
                    text_buffer = ""
                    continue

                reconstructed_buffer = "".join(evidence_buffer + [text_buffer]).strip()

                if in_evidence_section and END_DELIMITER in reconstructed_buffer:
                    delimiter_pos = reconstructed_buffer.find(END_DELIMITER)
                    evidence_part = reconstructed_buffer[:delimiter_pos]
                    remaining = reconstructed_buffer[
                        delimiter_pos + len(END_DELIMITER) :
                    ]

                    structured_evidence = (
                        CitationHandler.parse_multi_paper_evidence_block(evidence_part)
                    )

                    yield {
                        "type": "references",
                        "content": {
                            "citations": structured_evidence,
                        },
                    }

                    in_evidence_section = False
                    evidence_buffer = []
                    text_buffer = remaining

                    if remaining:
                        yield {"type": "content", "content": remaining}
                    continue

                if in_evidence_section:
                    evidence_buffer.append(text)
                    text_buffer = ""
                else:
                    if len(text_buffer) > len(START_DELIMITER) * 2:
                        to_yield = text_buffer[: -len(START_DELIMITER)]
                        yield {"type": "content", "content": to_yield}
                        text_buffer = text_buffer[-len(START_DELIMITER) :]
        finally:
            if not pinger_task.done():
                pinger_task.cancel()
            if not stream_reader_task.done():
                stream_reader_task.cancel()

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

    @retry_llm_operation(max_retries=3, delay=1.0)
    async def create_multi_paper_narrative_summary(
        self,
        current_user: CurrentUser,
        additional_instructions: Optional[str] = None,
        length: Optional[Literal["short", "medium", "long"]] = "medium",
        project_id: Optional[str] = None,
        llm_provider: Optional[LLMProvider] = None,
        db: Session = Depends(get_db),
    ) -> AudioOverviewForLLM:
        """
        Create a narrative summary across multiple papers using evidence gathering
        """
        # First, gather evidence based on the summary request
        evidence_collection = EvidenceCollection()

        summary_request = f"Provide a comprehensive narrative summary of the key findings, contributions, and insights from the papers in this collection. Synthesize the information to highlight overarching themes and significant advancements."

        if additional_instructions:
            summary_request += f" Additionally, {additional_instructions}"

        word_count_map = {
            "short": 5000,
            "medium": 40000,
            "long": 100000,
        }

        # Use the existing evidence gathering system
        async for result in self.gather_evidence(
            question=f"{summary_request}",
            current_user=current_user,
            llm_provider=llm_provider,
            project_id=project_id,
            db=db,
        ):
            if result.get("type") == "evidence_gathered":
                evidence_dict = result.get("content", {})
                for paper_id, snippets in evidence_dict.items():
                    evidence_collection.add_evidence(paper_id, snippets)
                break

        # Clean the evidence to focus on summary-relevant content
        cleaned_evidence = await self.clean_evidence(
            evidence_collection=evidence_collection,
            original_question=summary_request,
            current_user=current_user,
            llm_provider=llm_provider,
        )

        # Get paper metadata for context
        if project_id:
            project = project_crud.get(db, id=project_id, user=current_user)
            if not project:
                raise ValueError("Project not found.")
            all_papers = project_paper_crud.get_all_papers_by_project_id(
                db, project_id=uuid.UUID(project_id), user=current_user
            )
        else:
            all_papers = paper_crud.get_all_available_papers(db, user=current_user)

        paper_metadata = {
            str(paper.id): {
                "title": paper.title,
                "authors": paper.authors,
                "published": paper.publish_date,
            }
            for paper in all_papers
        }

        # Generate the narrative summary
        audio_overview_schema = AudioOverviewForLLM.model_json_schema()

        formatted_prompt = GENERATE_MULTI_PAPER_NARRATIVE_SUMMARY.format(
            summary_request=summary_request,
            evidence_gathered=cleaned_evidence.get_evidence_dict(),
            length=word_count_map.get(str(length), word_count_map["short"]),
            paper_metadata=paper_metadata,
            additional_instructions=additional_instructions or "",
            schema=audio_overview_schema,
        )

        message_content = [TextContent(text=formatted_prompt)]

        # Generate narrative summary using the LLM
        response = self.generate_content(
            contents=message_content,
            model_type=ModelType.DEFAULT,
            provider=llm_provider,
        )

        try:
            if response and response.text:
                # Parse the response text as JSON
                response_json = JSONParser.validate_and_extract_json(response.text)
                # Validate against the AudioOverview schema
                audio_overview = AudioOverviewForLLM.model_validate(response_json)
                return audio_overview
            else:
                raise ValueError("Empty response from LLM.")
        except ValueError as e:
            logger.error(f"Error parsing LLM response: {e}", exc_info=True)
            raise ValueError(f"Invalid response from LLM: {str(e)}")
