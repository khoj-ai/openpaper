import logging
import re
import uuid
from typing import AsyncGenerator, Optional, Sequence, Union

import httpx
from app.database.crud.paper_crud import paper_crud
from app.database.models import Paper
from app.database.telemetry import track_event
from app.llm.base import BaseLLMClient
from app.llm.citation_handler import CitationHandler
from app.llm.json_parser import JSONParser
from app.llm.prompts import (
    ANSWER_PAPER_QUESTION_SYSTEM_PROMPT,
    ANSWER_PAPER_QUESTION_USER_MESSAGE,
    CONCISE_MODE_INSTRUCTIONS,
    DETAILED_MODE_INSTRUCTIONS,
    EXTRACT_PAPER_METADATA,
    GENERATE_NARRATIVE_SUMMARY,
    NORMAL_MODE_INSTRUCTIONS,
)
from app.llm.provider import FileContent, LLMProvider, TextContent
from app.llm.schemas import PaperMetadataExtraction
from app.llm.utils import retry_llm_operation
from app.schemas.message import ResponseStyle
from app.schemas.user import CurrentUser
from fastapi import Depends
from google.genai.types import Part
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

from app.database.crud.message_crud import message_crud
from app.database.database import get_db
from app.helpers.s3 import s3_service


class PaperOperations(BaseLLMClient):
    """Operations related to paper analysis and chat functionality"""

    @retry_llm_operation(max_retries=3, delay=1.0)
    def extract_paper_metadata(
        self,
        paper_id: str,
        user: CurrentUser,
        file_path: Optional[str] = None,
        db: Session = Depends(get_db),
    ):
        """
        Extract metadata from the paper using the specified model
        """
        paper = paper_crud.get(db, id=paper_id, user=user)

        if not paper:
            raise ValueError(f"Paper with ID {paper_id} not found.")

        # Load and extract raw data from the PDF
        raw_file = paper_crud.read_raw_document_content(
            db, paper_id=paper_id, current_user=user, file_path=file_path
        )

        if not raw_file:
            raise ValueError(
                f"Raw file content for paper ID {paper_id} could not be retrieved."
            )

        formatted_prompt = EXTRACT_PAPER_METADATA.format(
            paper=raw_file, schema=PaperMetadataExtraction.model_json_schema()
        )

        # Extract metadata using the LLM
        response = self.generate_content(
            contents=formatted_prompt,
        )

        # Check if the response is valid JSON
        try:
            if response and response.text:
                response_json = JSONParser.validate_and_extract_json(response.text)
            else:
                raise ValueError("Empty response from LLM.")
        except ValueError as e:
            logger.error(f"Error parsing LLM response: {e}", exc_info=True)
            raise ValueError(f"Invalid JSON response from LLM: {str(e)}")

        # Parse the response and return the metadata
        metadata = PaperMetadataExtraction.model_validate(response_json)

        # Track metadata extraction event
        track_event(
            "extracted_metadata",
            properties={
                "has_title": bool(metadata.title),
                "has_authors": bool(metadata.authors),
                "has_abstract": bool(metadata.abstract),
                "has_summary": bool(metadata.summary),
                "num_starter_questions": (
                    len(metadata.starter_questions) if metadata.starter_questions else 0
                ),
            },
            user_id=str(user.id),
        )

        return metadata

    @retry_llm_operation(max_retries=3, delay=1.0)
    def create_narrative_summary(
        self,
        paper_id: str,
        user: CurrentUser,
        additional_instructions: Optional[str] = None,
        db: Session = Depends(get_db),
    ) -> str:
        """
        Create a narrative summary of the paper using the specified model
        """
        paper = paper_crud.get(db, id=paper_id, user=user)

        if not paper:
            raise ValueError(f"Paper with ID {paper_id} not found.")

        formatted_prompt = GENERATE_NARRATIVE_SUMMARY.format(
            additional_instructions=additional_instructions,
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
                return response.text.strip()
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

        def parse_evidence_block(evidence_text: str) -> list[dict]:
            """
            Parse evidence block into structured citations
            Handles multi-line citations between @cite markers

            Incoming format of evidence_text:
            @cite[1]
            "First piece of evidence"
            @cite[2]
            "Second piece of evidence"
            """
            citations = []
            lines = evidence_text.strip().split("\n")
            current_citation: dict[str, Union[int, str]] | None = None
            current_text_lines: list[str] = []

            for line in lines:
                line = line.strip()
                if line.startswith("@cite["):
                    # If we have a previous citation pending, save it
                    if current_citation is not None:
                        current_citation["reference"] = " ".join(
                            current_text_lines
                        ).strip()
                        citations.append(current_citation)

                    # Start new citation
                    match = re.search(r"@cite\[(\d+)\]", line)
                    if match:
                        number = int(match.group(1))
                        current_citation = {"key": number, "reference": ""}
                        current_text_lines = []
                elif current_citation is not None and line:
                    # Accumulate lines for the current citation
                    current_text_lines.append(line)

            # Don't forget to save the last citation
            if current_citation is not None and current_text_lines:
                current_citation["reference"] = " ".join(current_text_lines).strip()
                citations.append(current_citation)

            return citations

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
                structured_evidence = parse_evidence_block(evidence_part)

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
