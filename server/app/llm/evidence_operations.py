import json
import logging
import re
import time
import uuid
from typing import AsyncGenerator, Dict, List, Optional, Sequence, Union

from app.database.crud.message_crud import message_crud
from app.database.crud.paper_crud import paper_crud
from app.database.crud.projects.project_crud import project_crud
from app.database.crud.projects.project_paper_crud import project_paper_crud
from app.database.database import get_db
from app.database.telemetry import track_event
from app.llm.base import BaseLLMClient, ModelType
from app.llm.json_parser import JSONParser
from app.llm.prompts import (
    EVIDENCE_GATHERING_MESSAGE,
    EVIDENCE_GATHERING_SYSTEM_PROMPT,
    KEYWORD_EXTRACTION_PROMPT,
    LONG_SNIPPET_COMPACTION_PROMPT,
    SHORT_SNIPPET_COMPACTION_PROMPT,
    TOOL_RESULT_COMPACTION_PROMPT,
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
from app.llm.utils import retry_llm_operation
from app.schemas.message import (
    EvidenceCollection,
    LongSnippetCompactionResponse,
    ShortSnippetCompactionResponse,
    ToolResultCompactionResponse,
)
from app.schemas.user import CurrentUser
from fastapi import Depends
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# Gemini 3 supports 1M token input (~4M chars). We set conservative limits to leave room for
# system prompts, history, and responses while keeping costs/latency reasonable.
# At ~4 chars/token: 150k chars ≈ 37.5k tokens, 400k chars ≈ 100k tokens
CONTENT_LIMIT_EVIDENCE_GATHERING = (
    150000  # Character limit for tool results during evidence gathering
)
CONTENT_LIMIT_CHAT_EVIDENCE = (
    300000  # Character limit for evidence in chat response prompt
)
CONTENT_LIMIT_COMPACTION_BATCH = (
    150000  # Max chars per batch when compacting (for smaller context models)
)
SNIPPET_LENGTH_THRESHOLD = (
    1000  # Snippets shorter than this are keep/drop; longer are drop/summarize
)


class EvidenceOperations(BaseLLMClient):
    """Operations related to evidence gathering and compaction from multiple papers."""

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
        Gather evidence from multiple papers based on the user's question.
        This function will interact with the LLM to gather relevant information
        and citations from the user's knowledge base.
        """
        from app.llm.citation_handler import CitationHandler

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
        should_stop = False

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
                    f"Tool results size exceeded {CONTENT_LIMIT_EVIDENCE_GATHERING} "
                    f"characters ({tool_results_size}), compacting."
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

            # Get tool call results from previous iterations
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

                fn_name_raw = fn_selected.name
                fn_name = fn_name_raw.lower() if fn_name_raw else fn_name_raw
                fn_args = fn_selected.args

                if fn_name == "stop":
                    logger.info(
                        "Received STOP signal from LLM. Will stop after processing "
                        "remaining tool calls in this batch."
                    )
                    should_stop = True
                    continue

                if f"{fn_name}:{fn_args}" in prev_queries:
                    logger.info(
                        f"Function call {fn_name} with args {fn_args} has already "
                        "been made, skipping to avoid repetition."
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

                        evidence_collection.add_tool_call_result(fn_selected, result)

                        preserve_line_numbers = fn_name in [
                            "search_file",
                            "search_all_files",
                        ]

                        if fn_name == "search_all_files" and isinstance(result, dict):
                            for paper_id, lines in result.items():
                                evidence_collection.add_evidence(
                                    paper_id, lines, preserve_line_numbers=True
                                )

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
                        evidence_collection.add_tool_call_result(
                            fn_selected, f"Error: {str(e)}"
                        )
                        yield {"type": "error", "content": str(e)}
                else:
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

        # Fallback: if no evidence was gathered, try keyword-based search
        if not evidence_collection.has_evidence():
            logger.info(
                "No evidence gathered through normal flow. "
                "Attempting fallback keyword search."
            )
            yield {
                "type": "status",
                "content": "Searching for relevant information...",
            }

            try:
                keywords = await self._extract_search_keywords(question, llm_provider)

                if keywords:
                    logger.info(f"Fallback search with keywords: {keywords}")

                    for keyword in keywords:
                        search_results = search_all_files(
                            query=keyword,
                            current_user=current_user,
                            db=db,
                            project_id=project_id,
                        )

                        if search_results:
                            for paper_id, lines in search_results.items():
                                evidence_collection.add_evidence(
                                    paper_id, lines, preserve_line_numbers=True
                                )

                    if evidence_collection.has_evidence():
                        logger.info(
                            f"Fallback search found evidence from "
                            f"{len(evidence_collection.evidence)} papers"
                        )
                        track_event(
                            "fallback_search_success",
                            {
                                "keywords": keywords,
                                "papers_found": len(evidence_collection.evidence),
                            },
                            user_id=str(current_user.id),
                        )
                    else:
                        logger.info("Fallback search found no relevant evidence")
                        track_event(
                            "fallback_search_no_results",
                            {"keywords": keywords},
                            user_id=str(current_user.id),
                        )
            except Exception as e:
                logger.warning(f"Fallback search failed: {e}")
                track_event(
                    "fallback_search_error",
                    {"error": str(e)},
                    user_id=str(current_user.id),
                )

        # Compact evidence if it exceeds the limit for chat response
        evidence_size = evidence_collection.get_evidence_size()
        if evidence_size > CONTENT_LIMIT_CHAT_EVIDENCE:
            yield {
                "type": "status",
                "content": "Compacting gathered evidence...",
            }
            logger.info(
                f"Evidence size ({evidence_size} chars) exceeds limit "
                f"({CONTENT_LIMIT_CHAT_EVIDENCE} chars). Compacting."
            )
            async for status in self.compact_evidence(
                evidence_collection,
                question,
                current_user,
                llm_provider,
            ):
                yield status

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

        tool_results_for_compaction = (
            evidence_collection.get_tool_results_for_compaction()
        )

        formatted_prompt = TOOL_RESULT_COMPACTION_PROMPT.format(
            question=original_question,
            tool_results=json.dumps(tool_results_for_compaction, indent=2),
            schema=ToolResultCompactionResponse.model_json_schema(),
        )

        message_content = [TextContent(text=formatted_prompt)]

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

    async def compact_evidence(
        self,
        evidence_collection: EvidenceCollection,
        original_question: str,
        current_user: CurrentUser,
        llm_provider: Optional[LLMProvider] = None,
    ) -> AsyncGenerator[Dict[str, Union[str, Dict[str, List[str]]]], None]:
        """
        Compact evidence to reduce context size for chat response.
        Modifies the evidence_collection in place.

        Uses a split approach based on snippet length:
        - Short snippets (<SNIPPET_LENGTH_THRESHOLD chars): keep/drop only (preserves citations)
        - Long snippets (>=SNIPPET_LENGTH_THRESHOLD chars): drop/summarize (condenses large blocks)

        Yields status updates for client keepalive.
        """
        start_time = time.time()
        original_size = evidence_collection.get_evidence_size()
        evidence_dict = evidence_collection.get_evidence_dict()
        original_count = sum(len(snippets) for snippets in evidence_dict.values())

        # Split evidence into short and long snippets
        short_snippets, long_snippets = self._split_evidence_by_length(evidence_dict)

        short_count = sum(len(s) for s in short_snippets.values())
        long_count = sum(len(s) for s in long_snippets.values())
        logger.info(
            f"Split evidence: {short_count} short snippets, {long_count} long snippets"
        )

        yield {
            "type": "status",
            "content": "Filtering evidence for relevance...",
        }

        # Process short snippets (keep/drop)
        compacted_short: Dict[str, List[str]] = {}
        if short_snippets:
            short_batches = self._split_indexed_evidence_into_batches(
                short_snippets, CONTENT_LIMIT_COMPACTION_BATCH
            )
            for batch_idx, batch in enumerate(short_batches):
                if len(short_batches) > 1:
                    yield {
                        "type": "status",
                        "content": f"Filtering short snippets ({batch_idx + 1}/{len(short_batches)})...",
                    }
                try:
                    batch_result = await self._compact_short_snippets(
                        batch, original_question, llm_provider
                    )
                    for paper_id, snippets in batch_result.items():
                        if paper_id in compacted_short:
                            compacted_short[paper_id].extend(snippets)
                        else:
                            compacted_short[paper_id] = snippets
                except Exception as e:
                    logger.warning(
                        f"Short snippet compaction failed: {e}. Keeping originals."
                    )
                    for paper_id, indexed_snippets in batch.items():
                        originals = [s for _, s in indexed_snippets]
                        if paper_id in compacted_short:
                            compacted_short[paper_id].extend(originals)
                        else:
                            compacted_short[paper_id] = originals

        # Process long snippets (drop/summarize)
        compacted_long: Dict[str, List[str]] = {}
        if long_snippets:
            yield {
                "type": "status",
                "content": "Summarizing large evidence blocks...",
            }
            long_batches = self._split_indexed_evidence_into_batches(
                long_snippets, CONTENT_LIMIT_COMPACTION_BATCH
            )
            for batch_idx, batch in enumerate(long_batches):
                if len(long_batches) > 1:
                    yield {
                        "type": "status",
                        "content": f"Summarizing evidence ({batch_idx + 1}/{len(long_batches)})...",
                    }
                try:
                    batch_result = await self._compact_long_snippets(
                        batch, original_question, llm_provider
                    )
                    for paper_id, snippets in batch_result.items():
                        if paper_id in compacted_long:
                            compacted_long[paper_id].extend(snippets)
                        else:
                            compacted_long[paper_id] = snippets
                except Exception as e:
                    logger.warning(
                        f"Long snippet compaction failed: {e}. Keeping originals."
                    )
                    for paper_id, indexed_snippets in batch.items():
                        originals = [s for _, s in indexed_snippets]
                        if paper_id in compacted_long:
                            compacted_long[paper_id].extend(originals)
                        else:
                            compacted_long[paper_id] = originals

        # Merge results
        all_compacted: Dict[str, List[str]] = {}
        for paper_id in set(list(compacted_short.keys()) + list(compacted_long.keys())):
            all_compacted[paper_id] = []
            if paper_id in compacted_short:
                all_compacted[paper_id].extend(compacted_short[paper_id])
            if paper_id in compacted_long:
                all_compacted[paper_id].extend(compacted_long[paper_id])

        evidence_collection.apply_compacted_evidence(all_compacted)

        new_size = evidence_collection.get_evidence_size()
        new_count = sum(len(snippets) for snippets in all_compacted.values())

        logger.info(
            f"Evidence compaction complete. "
            f"Original: {original_count} snippets ({original_size} chars), "
            f"Compacted: {new_count} snippets ({new_size} chars)"
        )

        track_event(
            "evidence_compacted",
            {
                "duration_ms": (time.time() - start_time) * 1000,
                "original_count": original_count,
                "original_size": original_size,
                "compacted_count": new_count,
                "compacted_size": new_size,
                "short_snippets_input": short_count,
                "long_snippets_input": long_count,
            },
            user_id=str(current_user.id),
        )

    def _split_evidence_by_length(
        self, evidence_dict: Dict[str, List[str]]
    ) -> tuple[Dict[str, List[tuple[int, str]]], Dict[str, List[tuple[int, str]]]]:
        """
        Split evidence into short and long snippets based on SNIPPET_LENGTH_THRESHOLD.
        Returns indexed snippets as (original_index, content) tuples.
        """
        short_snippets: Dict[str, List[tuple[int, str]]] = {}
        long_snippets: Dict[str, List[tuple[int, str]]] = {}

        for paper_id, snippets in evidence_dict.items():
            for idx, snippet in enumerate(snippets):
                if len(snippet) < SNIPPET_LENGTH_THRESHOLD:
                    if paper_id not in short_snippets:
                        short_snippets[paper_id] = []
                    short_snippets[paper_id].append((idx, snippet))
                else:
                    if paper_id not in long_snippets:
                        long_snippets[paper_id] = []
                    long_snippets[paper_id].append((idx, snippet))

        return short_snippets, long_snippets

    def _split_indexed_evidence_into_batches(
        self,
        indexed_evidence: Dict[str, List[tuple[int, str]]],
        max_batch_size: int,
    ) -> List[Dict[str, List[tuple[int, str]]]]:
        """Split indexed evidence into batches that fit within the size limit."""
        batches: List[Dict[str, List[tuple[int, str]]]] = []
        current_batch: Dict[str, List[tuple[int, str]]] = {}
        current_size = 0

        for paper_id, indexed_snippets in indexed_evidence.items():
            paper_size = sum(len(s) for _, s in indexed_snippets)

            if paper_size > max_batch_size:
                # Paper itself exceeds batch size - put in its own batch
                if current_batch:
                    batches.append(current_batch)
                    current_batch = {}
                    current_size = 0
                batches.append({paper_id: indexed_snippets})
                continue

            if current_size + paper_size > max_batch_size and current_batch:
                batches.append(current_batch)
                current_batch = {}
                current_size = 0

            current_batch[paper_id] = indexed_snippets
            current_size += paper_size

        if current_batch:
            batches.append(current_batch)

        return batches if batches else [{}]

    async def _compact_short_snippets(
        self,
        indexed_evidence: Dict[str, List[tuple[int, str]]],
        original_question: str,
        llm_provider: Optional[LLMProvider] = None,
    ) -> Dict[str, List[str]]:
        """
        Compact short snippets using keep/drop decisions.
        Short snippets are kept verbatim or dropped entirely - no summarization.
        """
        if not indexed_evidence:
            return {}

        # Format evidence with indices for the LLM
        formatted_evidence: Dict[str, Dict[int, str]] = {}
        for paper_id, indexed_snippets in indexed_evidence.items():
            formatted_evidence[paper_id] = {
                idx: snippet for idx, snippet in indexed_snippets
            }

        formatted_prompt = SHORT_SNIPPET_COMPACTION_PROMPT.format(
            question=original_question,
            evidence=json.dumps(formatted_evidence, indent=2),
            schema=ShortSnippetCompactionResponse.model_json_schema(),
        )

        message_content = [TextContent(text=formatted_prompt)]

        llm_response = self.generate_content(
            system_prompt="You are a research assistant that filters evidence snippets for relevance.",
            contents=message_content,
            model_type=ModelType.FAST,
            provider=llm_provider,
        )

        if llm_response and llm_response.text:
            response_json = JSONParser.validate_and_extract_json(llm_response.text)
            compaction_response = ShortSnippetCompactionResponse.model_validate(
                response_json
            )

            # Apply keep/drop decisions
            result: Dict[str, List[str]] = {}
            for paper_id, indexed_snippets in indexed_evidence.items():
                actions = compaction_response.actions.get(paper_id, [])
                action_map = {a.index: a.action for a in actions}

                kept_snippets = []
                for idx, snippet in indexed_snippets:
                    action = action_map.get(
                        idx, "delete"
                    )  # Default to delete if not specified
                    if action == "keep":
                        kept_snippets.append(snippet)

                if kept_snippets:
                    result[paper_id] = kept_snippets

            return result
        else:
            logger.warning("Empty response from LLM during short snippet compaction.")
            # Return all snippets unchanged
            return {
                paper_id: [s for _, s in indexed_snippets]
                for paper_id, indexed_snippets in indexed_evidence.items()
            }

    async def _compact_long_snippets(
        self,
        indexed_evidence: Dict[str, List[tuple[int, str]]],
        original_question: str,
        llm_provider: Optional[LLMProvider] = None,
    ) -> Dict[str, List[str]]:
        """
        Compact long snippets using drop/summarize decisions.
        Long snippets are either dropped or summarized - no keeping verbatim.
        """
        if not indexed_evidence:
            return {}

        # Format evidence with indices for the LLM
        formatted_evidence: Dict[str, Dict[int, str]] = {}
        for paper_id, indexed_snippets in indexed_evidence.items():
            formatted_evidence[paper_id] = {
                idx: snippet for idx, snippet in indexed_snippets
            }

        formatted_prompt = LONG_SNIPPET_COMPACTION_PROMPT.format(
            question=original_question,
            evidence=json.dumps(formatted_evidence, indent=2),
            schema=LongSnippetCompactionResponse.model_json_schema(),
        )

        message_content = [TextContent(text=formatted_prompt)]

        llm_response = self.generate_content(
            system_prompt="You are a research assistant that condenses large evidence blocks while preserving key information.",
            contents=message_content,
            model_type=ModelType.DEFAULT,
            provider=llm_provider,
        )

        if llm_response and llm_response.text:
            response_json = JSONParser.validate_and_extract_json(llm_response.text)
            compaction_response = LongSnippetCompactionResponse.model_validate(
                response_json
            )

            # Apply drop/summarize decisions
            result: Dict[str, List[str]] = {}
            for paper_id, indexed_snippets in indexed_evidence.items():
                actions = compaction_response.actions.get(paper_id, [])
                action_map = {a.index: a for a in actions}

                processed_snippets = []
                for idx, snippet in indexed_snippets:
                    action_obj = action_map.get(idx)
                    if action_obj is None:
                        # Default to summarize with truncation if not specified
                        processed_snippets.append(f"(summarized) {snippet[:500]}...")
                    elif action_obj.action == "summarize" and action_obj.summary:
                        processed_snippets.append(action_obj.summary)
                    # If action is "drop", we skip the snippet

                if processed_snippets:
                    result[paper_id] = processed_snippets

            return result
        else:
            logger.warning("Empty response from LLM during long snippet compaction.")
            # Return truncated summaries as fallback
            return {
                paper_id: [f"(summarized) {s[:500]}..." for _, s in indexed_snippets]
                for paper_id, indexed_snippets in indexed_evidence.items()
            }

    async def _extract_search_keywords(
        self,
        question: str,
        llm_provider: Optional[LLMProvider] = None,
    ) -> List[str]:
        """Extract search keywords from a question using LLM."""
        formatted_prompt = KEYWORD_EXTRACTION_PROMPT.format(question=question)

        message_content = [TextContent(text=formatted_prompt)]

        llm_response = self.generate_content(
            system_prompt="You are a helpful assistant that extracts search keywords.",
            contents=message_content,
            model_type=ModelType.FAST,
            provider=llm_provider,
        )

        if llm_response and llm_response.text:
            try:
                keywords = json.loads(llm_response.text.strip())
                if isinstance(keywords, list):
                    return [str(k) for k in keywords if k][:5]
            except json.JSONDecodeError:
                logger.warning(f"Failed to parse keywords as JSON: {llm_response.text}")
                text = llm_response.text.strip().strip("[]\"'")
                keywords = [k.strip().strip("\"'") for k in re.split(r"[,\n]", text)]
                return [k for k in keywords if k][:5]

        logger.warning("Failed to extract keywords from question")
        return []
