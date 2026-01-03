import logging
import re
import uuid
from typing import AsyncGenerator, Literal, Optional, Sequence, Union

import httpx
from app.database.crud.paper_crud import paper_crud
from app.database.models import Paper
from app.llm.base import BaseLLMClient
from app.llm.citation_handler import CitationHandler
from app.llm.json_parser import JSONParser
from app.llm.prompts import (
    ANSWER_PAPER_QUESTION_SYSTEM_PROMPT,
    ANSWER_PAPER_QUESTION_USER_MESSAGE,
    CONCISE_MODE_INSTRUCTIONS,
    DETAILED_MODE_INSTRUCTIONS,
    GENERATE_NARRATIVE_SUMMARY,
    NORMAL_MODE_INSTRUCTIONS,
)
from app.llm.provider import FileContent, LLMProvider, TextContent
from app.llm.utils import retry_llm_operation
from app.schemas.message import ResponseStyle
from app.schemas.responses import AudioOverviewForLLM
from app.schemas.user import CurrentUser
from fastapi import Depends
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

from app.database.crud.message_crud import message_crud
from app.database.database import get_db
from app.helpers.s3 import s3_service


class PaperOperations(BaseLLMClient):
    """Operations related to paper analysis and chat functionality"""

    @retry_llm_operation(max_retries=3, delay=1.0)
    def create_narrative_summary(
        self,
        paper_id: str,
        user: CurrentUser,
        length: Optional[Literal["short", "medium", "long"]] = "medium",
        additional_instructions: Optional[str] = None,
        db: Session = Depends(get_db),
    ) -> AudioOverviewForLLM:
        """
        Create a narrative summary of the paper using the specified model
        """
        paper = paper_crud.get(db, id=paper_id, user=user)

        if not paper:
            raise ValueError(f"Paper with ID {paper_id} not found.")

        audio_overview_schema = AudioOverviewForLLM.model_json_schema()

        # Character limits calibrated for target audio durations
        # At ~150 words/min speaking rate, ~6 chars/word:
        # short: ~2-3 min, medium: ~5-7 min, long: ~10-15 min
        character_count_map = {
            "short": 2500,    # ~400 words, ~2.5 min
            "medium": 6000,   # ~1000 words, ~6 min
            "long": 12000,    # ~2000 words, ~12 min
        }

        formatted_prompt = GENERATE_NARRATIVE_SUMMARY.format(
            additional_instructions=additional_instructions,
            length=character_count_map.get(str(length), character_count_map["medium"]),
            schema=audio_overview_schema,
        )

        signed_url = s3_service.get_cached_presigned_url(
            db,
            paper_id=str(paper.id),
            object_key=str(paper.s3_object_key),
            current_user=user,
        )

        if not signed_url:
            raise ValueError(
                f"Could not generate presigned URL for paper with ID {paper_id}."
            )

        # Retrieve and encode the PDF byte
        pdf_bytes = httpx.get(signed_url).content

        message_content = [
            FileContent(
                data=pdf_bytes,
                mime_type="application/pdf",
                filename=f"{paper.title or 'paper'}.pdf",
            ),
            TextContent(text=formatted_prompt),
        ]

        # Generate narrative summary using the LLM
        response = self.generate_content(
            contents=message_content,
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

    async def chat_with_paper(
        self,
        paper_id: str,
        conversation_id: str,
        question: str,
        current_user: CurrentUser,
        llm_provider: Optional[LLMProvider] = None,
        user_references: Optional[Sequence[str]] = None,
        response_style: Optional[str] = "normal",
        db: Session = Depends(get_db),
    ) -> AsyncGenerator[Union[str, dict], None]:
        """
        Chat with the paper using the specified model
        """

        user_citations = (
            CitationHandler.convert_references_to_citations(user_references)
            if user_references
            else None
        )

        paper: Paper = paper_crud.get(db, id=paper_id)

        if not paper:
            raise ValueError(f"Paper with ID {paper_id} not found.")

        casted_conversation_id = uuid.UUID(conversation_id)

        conversation_history = message_crud.get_conversation_messages(
            db, conversation_id=casted_conversation_id, current_user=current_user
        )

        additional_instructions = ""

        if response_style == ResponseStyle.DETAILED:
            additional_instructions = DETAILED_MODE_INSTRUCTIONS
        elif response_style == ResponseStyle.CONCISE:
            additional_instructions = CONCISE_MODE_INSTRUCTIONS
        else:
            additional_instructions = NORMAL_MODE_INSTRUCTIONS

        formatted_system_prompt = ANSWER_PAPER_QUESTION_SYSTEM_PROMPT.format(
            additional_instructions=additional_instructions,
        )

        formatted_prompt = ANSWER_PAPER_QUESTION_USER_MESSAGE.format(
            question=f"{question}\n\n{user_citations}" if user_citations else question,
        )

        evidence_buffer: list[str] = []
        text_buffer: str = ""
        in_evidence_section = False

        START_DELIMITER = "---EVIDENCE---"
        END_DELIMITER = "---END-EVIDENCE---"

        signed_url = s3_service.get_cached_presigned_url(
            db,
            paper_id=str(paper.id),
            object_key=str(paper.s3_object_key),
            current_user=current_user,
        )

        if not signed_url:
            raise ValueError(
                f"Could not generate presigned URL for paper with ID {paper_id}."
            )

        # Retrieve and encode the PDF byte
        pdf_bytes = httpx.get(signed_url).content

        message_content = [
            TextContent(text=formatted_prompt),
        ]

        # Chat with the paper using the LLM
        for chunk in self.send_message_stream(
            message=message_content,
            file=FileContent(
                data=pdf_bytes,
                mime_type="application/pdf",
                filename=f"{paper.title or 'paper'}.pdf",
            ),
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
                structured_evidence = CitationHandler.parse_evidence_block(
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

        if text_buffer:
            yield {"type": "content", "content": text_buffer}
