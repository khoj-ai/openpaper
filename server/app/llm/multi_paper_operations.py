import asyncio
import json
import logging
import uuid
from contextlib import suppress
from typing import AsyncGenerator, List, Literal, Optional, Sequence, Union

from app.database.crud.message_crud import message_crud
from app.database.crud.paper_crud import paper_crud
from app.database.crud.projects.project_crud import project_crud
from app.database.crud.projects.project_paper_crud import project_paper_crud
from app.database.database import get_db
from app.database.models import Paper
from app.llm.base import ModelType
from app.llm.citation_handler import CitationHandler
from app.llm.evidence_operations import EvidenceOperations
from app.llm.json_parser import JSONParser
from app.llm.prompts import (
    ANSWER_EVIDENCE_BASED_QUESTION_MESSAGE,
    ANSWER_EVIDENCE_BASED_QUESTION_SYSTEM_PROMPT,
    GENERATE_MULTI_PAPER_NARRATIVE_SUMMARY,
)
from app.llm.provider import LLMProvider, StreamChunk, SupplementaryContent, TextContent
from app.llm.utils import retry_llm_operation
from app.schemas.message import EvidenceCollection
from app.schemas.responses import AudioOverviewForLLM
from app.schemas.user import CurrentUser
from fastapi import Depends
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


class MultiPaperOperations(EvidenceOperations):
    """Operations related to multi-paper analysis and chat functionality.

    Inherits evidence gathering and compaction methods from EvidenceOperations.
    """

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

        # Build multipart message: supplementary evidence + user question
        message_content = [
            SupplementaryContent(
                content=json.dumps(evidence_gathered.get_evidence_dict(), indent=2),
                label="collected_evidence",
            ),
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

        # Check if stream_reader_task raised an exception
        if stream_reader_task.done():
            exc = stream_reader_task.exception()
            if exc is not None:
                logger.error(f"Stream reader task failed with exception: {exc}")
                yield {
                    "type": "error",
                    "content": "Sorry, an error occurred while working on this response. Please try again or contact support (saba@openpaper.ai) if the issue persists.",
                }
                return

        # Handle case where stream ended while still in evidence section
        if in_evidence_section and evidence_buffer:
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
                    yield {"type": "content", "content": reconstructed_buffer}

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
        evidence_collection = EvidenceCollection()

        summary_request = (
            additional_instructions
            or "Provide a comprehensive narrative summary of the key findings, contributions, and insights from the papers in this collection. Synthesize the information to highlight overarching themes and significant advancements."
        )

        # Word count targets for audio durations at ~150 words/min
        # short: ~3 min, medium: ~7 min, long: ~14 min
        word_count_map = {
            "short": 450,
            "medium": 1000,
            "long": 2000,
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
            length=word_count_map.get(str(length), word_count_map["medium"]),
            paper_metadata=paper_metadata,
            additional_instructions=additional_instructions or "",
            schema=audio_overview_schema,
        )

        message_content = [TextContent(text=formatted_prompt)]

        response = self.generate_content(
            contents=message_content,
            model_type=ModelType.DEFAULT,
            provider=LLMProvider.GEMINI,
        )

        try:
            if response and response.text:
                response_json = JSONParser.validate_and_extract_json(response.text)
                audio_overview = AudioOverviewForLLM.model_validate(response_json)
                return audio_overview
            else:
                raise ValueError("Empty response from LLM.")
        except ValueError as e:
            logger.error(f"Error parsing LLM response: {e}", exc_info=True)
            raise ValueError(f"Invalid response from LLM: {str(e)}")
