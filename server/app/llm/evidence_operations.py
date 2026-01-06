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
    EVIDENCE_COMPACTION_PROMPT,
    EVIDENCE_GATHERING_MESSAGE,
    EVIDENCE_GATHERING_SYSTEM_PROMPT,
    KEYWORD_EXTRACTION_PROMPT,
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
    EvidenceSummaryResponse,
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

        Single-pass compaction: summarizes all evidence per paper in one LLM call.
        """
        start_time = time.time()
        original_size = evidence_collection.get_evidence_size()
        evidence_dict = evidence_collection.get_evidence_dict()
        original_count = sum(len(snippets) for snippets in evidence_dict.values())

        yield {
            "type": "status",
            "content": "Compacting evidence...",
        }

        # Format evidence for compaction with strict size limits
        # Sort papers by snippet count (most evidence first) and limit total size

        MAX_TOTAL_CHARS = 50000  # Total input limit for fast compaction
        MAX_PER_PAPER = 3000  # Per-paper limit

        papers_by_evidence = sorted(
            evidence_dict.items(), key=lambda x: len(x[1]), reverse=True
        )

        evidence_for_compaction: List[Dict[str, str]] = []
        total_chars = 0
        for paper_id, snippets in papers_by_evidence:
            combined = "\n\n".join(snippets)[:MAX_PER_PAPER]
            if total_chars + len(combined) > MAX_TOTAL_CHARS:
                break
            evidence_for_compaction.append({"paper_id": paper_id, "content": combined})
            total_chars += len(combined)

        logger.info(
            f"Compacting {len(evidence_for_compaction)}/{len(evidence_dict)} papers ({total_chars} chars)"
        )

        formatted_prompt = EVIDENCE_COMPACTION_PROMPT.format(
            question=original_question,
            evidence=json.dumps(evidence_for_compaction, indent=2),
            schema=EvidenceSummaryResponse.model_json_schema(),
        )

        message_content = [TextContent(text=formatted_prompt)]

        llm_response = self.generate_content(
            system_prompt="Summarize evidence by paper.",
            contents=message_content,
            model_type=ModelType.FAST,
            provider=llm_provider,
        )

        all_compacted: Dict[str, List[str]] = {}

        try:
            if llm_response and llm_response.text:
                response_json = JSONParser.validate_and_extract_json(llm_response.text)
                compaction_response = EvidenceSummaryResponse.model_validate(
                    response_json
                )

                for paper_summary in compaction_response.papers:
                    if paper_summary.summary:
                        all_compacted[paper_summary.paper_id] = [paper_summary.summary]
            else:
                logger.warning("Empty response from LLM during evidence compaction.")

            # Add truncated fallback for papers not sent to LLM (due to size limits)
            for paper_id, snippets in evidence_dict.items():
                if paper_id not in all_compacted:
                    all_compacted[paper_id] = [
                        f"(summarized) {' '.join(snippets)[:500]}..."
                    ]
        except Exception as e:
            logger.warning(
                f"Evidence compaction failed: {e}. Using truncated fallback."
            )
            for paper_id, snippets in evidence_dict.items():
                all_compacted[paper_id] = [
                    f"(summarized) {' '.join(snippets)[:500]}..."
                ]

        evidence_collection.apply_compacted_evidence(all_compacted)

        new_size = evidence_collection.get_evidence_size()
        new_count = sum(len(snippets) for snippets in all_compacted.values())

        logger.info(
            f"Evidence compaction complete. "
            f"Original: {original_count} snippets ({original_size} chars), "
            f"Compacted: {new_count} summaries ({new_size} chars)"
        )

        track_event(
            "evidence_compacted",
            {
                "duration_ms": (time.time() - start_time) * 1000,
                "original_count": original_count,
                "original_size": original_size,
                "compacted_count": new_count,
                "compacted_size": new_size,
            },
            user_id=str(current_user.id),
        )

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
