import json
import os
import re
import uuid
from typing import Any, AsyncGenerator, Generator, List, Optional, Sequence, Union

from app.database.crud.document_crud import document_crud
from app.database.crud.message_crud import message_crud
from app.database.database import get_db
from app.database.models import Document, Message
from app.llm.prompts import (
    ANSWER_PAPER_QUESTION_SYSTEM_PROMPT,
    ANSWER_PAPER_QUESTION_USER_MESSAGE,
    CONCISE_MODE_INSTRUCTIONS,
    DETAILED_MODE_INSTRUCTIONS,
    EXTRACT_PAPER_METADATA,
    NORMAL_MODE_INSTRUCTIONS,
)
from app.llm.schemas import PaperMetadataExtraction
from app.schemas.message import ResponseStyle
from app.schemas.user import CurrentUser
from fastapi import Depends
from google import genai  # type: ignore
from google.genai.types import Content  # type: ignore
from sqlalchemy.orm import Session

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

gemini_client = genai.Client(api_key=GEMINI_API_KEY)


class Operations:
    """
    Class to handle operations related to LLM
    """

    def __init__(self):
        self.client = genai.Client(api_key=GEMINI_API_KEY)
        self.default_model = "gemini-2.5-pro-preview-03-25"

    def validate_and_extract_json(self, json_data: str) -> dict:
        """
        Extract and validate JSON data from various formats

        Args:
            json_data (str): String which may contain JSON in different formats

        Returns:
            dict: Parsed JSON data

        Raises:
            ValueError: If valid JSON cannot be extracted
        """
        if not json_data or not isinstance(json_data, str):
            raise ValueError("Invalid input: empty or non-string data")

        # Remove any leading/trailing whitespace
        json_data = json_data.strip()

        # Case 1: Try parsing directly first
        try:
            return json.loads(json_data)
        except json.JSONDecodeError:
            pass

        # Case 2: Check for code block format (```json ... ```)
        json_match = None
        if "```" in json_data:
            # Find content between triple backticks
            import re

            code_blocks = re.findall(r"```(?:json)?\s*([\s\S]*?)```", json_data)

            # Try each code block
            for block in code_blocks:
                try:
                    return json.loads(block.strip())
                except json.JSONDecodeError:
                    continue

        # If we got here, we couldn't find valid JSON
        raise ValueError(
            "Could not extract valid JSON from the provided string. "
            "Please ensure the response contains proper JSON format."
        )

    def convert_references_to_dict(self, references: Sequence[str]) -> dict:
        """
        Convert user references to structured citations
        """
        citations = []
        for idx, ref in enumerate(references):
            citations.append(
                {
                    "key": idx + 1,
                    "reference": ref,
                }
            )
        return {
            "citations": citations,
        }

    def convert_references_to_citations(
        self, references: Optional[Sequence[str]]
    ) -> str:
        """
        Convert user references to structured citations
        """
        if not references:
            return ""

        return self.format_citations(
            self.convert_references_to_dict(references)["citations"]
        )

    def format_citations(
        self,
        citations: list[dict],
    ) -> str:
        """
        Format citations into a structured string
        """
        citation_format = "---EVIDENCE---\n"

        citation_format += "\n".join(
            [
                f"@cite[{citation['key']}]\n{citation['reference']}"
                for citation in citations
            ]
        )

        citation_format += "\n---END-EVIDENCE---"
        return citation_format

    def convert_chat_history_to_api_format(
        self,
        messages: list[Message],
    ) -> list[Content]:
        """
        Convert chat history to Chat API format
        """
        api_format = []
        for message in messages:
            references = self.format_citations(message.references["citations"]) if message.references else None  # type: ignore

            f_message = (
                f"{message.content}\n\n{references}" if references else message.content
            )

            api_format.append(
                Content(
                    role="user" if message.role == "user" else "model",
                    parts=[{"text": f_message}],
                )
            )
        return api_format

    async def explain_text(
        self, contents: str, model: Optional[str] = "gemini-2.0-flash"
    ):
        """
        Explain the provided text using the specified model
        """
        async for chunk in self.client.models.generate_content_stream(
            model=model, contents=contents
        ):
            # Process the chunk of generated content
            yield chunk.text

    def extract_paper_metadata(
        self,
        paper_id: str,
        user: CurrentUser,
        file_path: Optional[str] = None,
        db: Session = Depends(get_db),
    ) -> PaperMetadataExtraction:
        """
        Extract metadata from the paper using the specified model
        """
        paper = document_crud.get(db, id=paper_id, user=user)

        if not paper:
            raise ValueError(f"Paper with ID {paper_id} not found.")

        # Load and extract raw data from the PDF
        raw_file = document_crud.read_raw_document_content(
            db, document_id=paper_id, current_user=user, file_path=file_path
        )

        if not raw_file:
            raise ValueError(
                f"Raw file content for paper ID {paper_id} could not be retrieved."
            )

        formatted_prompt = EXTRACT_PAPER_METADATA.format(
            paper=raw_file, schema=PaperMetadataExtraction.model_json_schema()
        )

        # Extract metadata using the LLM
        response = self.client.models.generate_content(
            model=self.default_model,
            contents=formatted_prompt,
        )

        # Check if the response is valid JSON
        try:
            response_json = self.validate_and_extract_json(response.text)
        except ValueError as e:
            raise ValueError(f"Invalid JSON response from LLM: {str(e)}")

        # Parse the response and return the metadata
        metadata = PaperMetadataExtraction.model_validate(response_json)
        return metadata

    async def chat_with_paper(
        self,
        paper_id: str,
        conversation_id: str,
        question: str,
        current_user: CurrentUser,
        user_references: Optional[Sequence[str]] = None,
        file_path: Optional[str] = None,
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
            self.convert_references_to_citations(user_references)
            if user_references
            else None
        )

        paper = document_crud.get(db, id=paper_id)

        if not paper:
            raise ValueError(f"Paper with ID {paper_id} not found.")

        # Load and extract raw data from the PDF
        raw_file = document_crud.read_raw_document_content(
            db, document_id=paper_id, current_user=current_user, file_path=file_path
        )
        if not raw_file:
            raise ValueError(
                f"Raw file content for paper ID {paper_id} could not be retrieved."
            )

        casted_conversation_id = uuid.UUID(conversation_id)

        conversation_history = message_crud.get_conversation_messages(
            db, conversation_id=casted_conversation_id, current_user=current_user
        )

        chat_history = self.convert_chat_history_to_api_format(conversation_history)

        additional_instructions = ""

        if response_style == ResponseStyle.DETAILED:
            additional_instructions = DETAILED_MODE_INSTRUCTIONS
        elif response_style == ResponseStyle.CONCISE:
            additional_instructions = CONCISE_MODE_INSTRUCTIONS
        else:
            additional_instructions = NORMAL_MODE_INSTRUCTIONS

        formatted_system_prompt = ANSWER_PAPER_QUESTION_SYSTEM_PROMPT.format(
            paper=raw_file
        )

        chat_session = self.client.chats.create(
            model=self.default_model,
            history=chat_history,
            config={
                "system_instruction": formatted_system_prompt,
            },
        )

        formatted_prompt = ANSWER_PAPER_QUESTION_USER_MESSAGE.format(
            question=f"{question}\n\n{user_citations}" if user_citations else question,
            additional_instructions=additional_instructions,
        )

        evidence_buffer: list[str] = []
        text_buffer: str = ""
        in_evidence_section = False

        START_DELIMITER = "---EVIDENCE---"
        END_DELIMITER = "---END-EVIDENCE---"

        # Extract metadata using the LLM
        for chunk in chat_session.send_message_stream(
            message=formatted_prompt,
        ):
            text = chunk.text

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

            if in_evidence_section and END_DELIMITER in text_buffer:
                # Split at delimiter
                evidence_part, remaining = text_buffer.split(END_DELIMITER)
                evidence_buffer.append(evidence_part)

                # Parse the complete evidence block
                raw_evidence = "".join(evidence_buffer).strip()
                structured_evidence = parse_evidence_block(raw_evidence)

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
