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
    EVIDENCE_GATHERING_MESSAGE,
    EVIDENCE_GATHERING_SYSTEM_PROMPT,
    GENERATE_MULTI_PAPER_NARRATIVE_SUMMARY,
    TOOL_RESULT_COMPACTION_PROMPT,
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
from app.schemas.message import EvidenceCollection, ToolResultCompactionResponse
from app.schemas.responses import AudioOverviewForLLM
from app.schemas.user import CurrentUser
from fastapi import Depends
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

from app.database.crud.message_crud import message_crud
from app.database.database import get_db
from app.database.telemetry import track_event

# TODO Really need to find a better, more robust way to implement the truncation logic based on the tokenization window limits. I know current model has a limit of 250k tokens - we should have a more dynamic way to accommodate additional text for prompts, chat history, and of course evidence. We'll have to estimate the token counts based on character counts for now - then we can even add some basic heuristics for pruning down chat history or evidence if we exceed limits.
CONTENT_LIMIT_EVIDENCE_GATHERING = 150000  # Character limit for evidence gathering


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

        prev_queries = set()
        should_stop = False  # Flag to track when STOP is called

        while n_iterations < max_iterations and not should_stop:
            n_iterations += 1

            # If tool call results are very large, compact them to avoid context overflow
            tool_results_size = evidence_collection.get_tool_results_size()

            if tool_results_size > CONTENT_LIMIT_EVIDENCE_GATHERING:
                yield {
                    "type": "status",
                    "content": "Gathered a lot of data. Compacting tool results...",
                }
                logger.info(
                    f"Tool results size exceeded {CONTENT_LIMIT_EVIDENCE_GATHERING} characters ({tool_results_size}), compacting."
                )
                await self.compact_tool_call_results(
                    evidence_collection, question, current_user, llm_provider
                )

            evidence_gathering_prompt = EVIDENCE_GATHERING_SYSTEM_PROMPT.format(
                available_papers=formatted_paper_options,
                n_iteration=n_iterations,
                max_iterations=max_iterations,
            )

            formatted_prompt = EVIDENCE_GATHERING_MESSAGE.format(
                question=question,
            )

            message_content = [
                TextContent(text=formatted_prompt),
            ]

            yield {
                "type": "status",
                "content": f"Reviewing collected evidence (iteration {n_iterations}/{max_iterations})...",
            }

            # Get tool call results from previous iterations for proper multi-turn function calling
            tool_call_results = (
                evidence_collection.get_tool_call_results()
                if evidence_collection.has_previous_tool_calls()
                else None
            )

            llm_response = self.generate_content(
                system_prompt=evidence_gathering_prompt,
                history=conversation_history,
                contents=message_content,
                model_type=ModelType.FAST,
                function_declarations=function_declarations,
                tool_call_results=tool_call_results,
                provider=llm_provider,
                enable_thinking=True,
            )

            if len(llm_response.tool_calls) == 0:
                logger.info(
                    "No tool calls returned from LLM, ending evidence gathering."
                )
                break

            for fn_selected in llm_response.tool_calls:
                start_time = time.time()

                # Normalize function name to handle variants like "STOP" vs "stop"
                fn_name_raw = fn_selected.name
                fn_name = fn_name_raw.lower() if fn_name_raw else fn_name_raw
                fn_args = fn_selected.args

                # Check for STOP signal (case-insensitive) - set flag but continue processing other tool calls
                if fn_name == "stop":
                    logger.info(
                        "Received STOP signal from LLM. Will stop after processing remaining tool calls in this batch."
                    )
                    should_stop = True
                    continue  # Skip to next tool call, don't break immediately

                if f"{fn_name}:{fn_args}" in prev_queries:
                    logger.info(
                        f"Function call {fn_name} with args {fn_args} has already been made, skipping to avoid repetition."
                    )
                    continue

                prev_queries.add(f"{fn_name}:{fn_args}")

                evidence_collection.add_tool_call(fn_selected)

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

                            # Track the error result for proper multi-turn function calling
                            evidence_collection.add_tool_call_result(
                                fn_selected, f"Error: Paper ID {paper_id_arg} not found"
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

                        # Track the tool call result for proper multi-turn function calling
                        evidence_collection.add_tool_call_result(fn_selected, result)

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
                        # Track the error result for proper multi-turn function calling
                        evidence_collection.add_tool_call_result(
                            fn_selected, f"Error: {str(e)}"
                        )
                        yield {"type": "error", "content": str(e)}
                else:
                    # Log original function name for easier debugging when the LLM returns unexpected tool names
                    logger.warning(f"Unknown function called: {fn_name_raw}")
                    yield {
                        "type": "error",
                        "content": f"Unknown function: {fn_name_raw}",
                    }
                end_time = time.time()
                track_event(
                    "function_call",
                    {
                        "function_name": fn_name,
                        "duration_ms": (end_time - start_time) * 1000,
                        "project_type": project_id is not None,
                    },
                    user_id=str(current_user.id),
                )

        yield {
            "type": "evidence_gathered",
            "content": evidence_collection.get_evidence_dict(),
        }

    async def compact_tool_call_results(
        self,
        evidence_collection: EvidenceCollection,
        original_question: str,
        current_user: CurrentUser,
        llm_provider: Optional[LLMProvider] = None,
    ) -> None:
        """
        Compact tool call results by summarizing them to reduce context size.
        Modifies the evidence_collection in place.
        """
        start_time = time.time()
        original_size = evidence_collection.get_tool_results_size()
        original_count = len(evidence_collection.tool_call_results)

        # Get tool results in a format suitable for LLM compaction
        tool_results_for_compaction = (
            evidence_collection.get_tool_results_for_compaction()
        )

        formatted_prompt = TOOL_RESULT_COMPACTION_PROMPT.format(
            question=original_question,
            tool_results=json.dumps(tool_results_for_compaction, indent=2),
            schema=ToolResultCompactionResponse.model_json_schema(),
        )

        message_content = [TextContent(text=formatted_prompt)]

        # Get LLM to compact the tool results
        llm_response = self.generate_content(
            system_prompt="You are a research assistant that summarizes tool call results while preserving key information.",
            contents=message_content,
            model_type=ModelType.DEFAULT,
            provider=llm_provider,
        )

        try:
            if llm_response and llm_response.text:
                compaction_response = JSONParser.validate_and_extract_json(
                    llm_response.text
                )
                compaction_response = ToolResultCompactionResponse.model_validate(
                    compaction_response
                )

                # Apply the compacted results
                evidence_collection.apply_compacted_results(
                    compaction_response.compacted_results
                )

                new_size = evidence_collection.get_tool_results_size()
                logger.info(
                    f"Tool result compaction complete. "
                    f"Original: {original_count} results ({original_size} chars), "
                    f"Compacted: {len(compaction_response.compacted_results)} results ({new_size} chars)"
                )

                track_event(
                    "tool_results_compacted",
                    {
                        "duration_ms": (time.time() - start_time) * 1000,
                        "original_count": original_count,
                        "original_size": original_size,
                        "compacted_count": len(compaction_response.compacted_results),
                        "compacted_size": new_size,
                    },
                    user_id=str(current_user.id),
                )
            else:
                logger.warning("Empty response from LLM during tool result compaction.")

        except Exception as e:
            logger.warning(
                f"Tool result compaction failed: {e}. Keeping original results."
            )

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
                    await queue.put(
                        {"type": "status", "content": "Finalizing thoughts..."}
                    )
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
        db: Session = Depends(get_db),
    ) -> AudioOverviewForLLM:
        """
        Create a narrative summary across multiple papers using evidence gathering
        """
        # First, gather evidence based on the summary request
        evidence_collection = EvidenceCollection()

        summary_request = (
            additional_instructions
            or f"Provide a comprehensive narrative summary of the key findings, contributions, and insights from the papers in this collection. Synthesize the information to highlight overarching themes and significant advancements."
        )

        # Character limits calibrated for target audio durations
        # At ~150 words/min speaking rate, ~6 chars/word
        # Values increased ~50% since LLMs tend to undershoot targets
        # short: ~2-3 min, medium: ~5-7 min, long: ~10-15 min
        character_count_map = {
            "short": 4000,    # ~650 words, ~3 min target
            "medium": 9000,   # ~1500 words, ~7 min target
            "long": 18000,    # ~3000 words, ~14 min target
        }

        # Use the existing evidence gathering system
        async for result in self.gather_evidence(
            question=f"{summary_request}",
            current_user=current_user,
            llm_provider=LLMProvider.GROQ,
            project_id=project_id,
            db=db,
        ):
            if result.get("type") == "evidence_gathered":
                evidence_dict = result.get("content", {})
                for paper_id, snippets in evidence_dict.items():
                    evidence_collection.add_evidence(paper_id, snippets)
                break

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
            evidence_gathered=evidence_collection.get_evidence_dict(),
            length=character_count_map.get(str(length), character_count_map["medium"]),
            paper_metadata=paper_metadata,
            additional_instructions=additional_instructions or "",
            schema=audio_overview_schema,
        )

        message_content = [TextContent(text=formatted_prompt)]

        # Generate narrative summary using the LLM
        response = self.generate_content(
            contents=message_content,
            model_type=ModelType.DEFAULT,
            provider=LLMProvider.GEMINI,
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
