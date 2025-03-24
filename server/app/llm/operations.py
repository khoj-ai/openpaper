import json
import os
from typing import Optional, Union

from app.database.crud.document_crud import document_crud
from app.database.database import get_db
from app.database.models import Document
from app.llm.prompts import EXTRACT_PAPER_METADATA
from app.llm.schemas import PaperMetadataExtraction
from fastapi import Depends
from google import genai  # type: ignore
from sqlalchemy.orm import Session

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

gemini_client = genai.Client(api_key=GEMINI_API_KEY)


class Operations:
    """
    Class to handle operations related to LLM
    """

    def __init__(self):
        self.client = genai.Client(api_key=GEMINI_API_KEY)
        self.default_model = "gemini-2.0-flash"

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
        file_path: Optional[str] = None,
        db: Session = Depends(get_db),
    ) -> PaperMetadataExtraction:
        """
        Extract metadata from the paper using the specified model
        """
        paper = document_crud.get(db, id=paper_id)

        if not paper:
            raise ValueError(f"Paper with ID {paper_id} not found.")

        # Load and extract raw data from the PDF
        raw_file = document_crud.read_raw_document_content(
            db, document_id=paper_id, file_path=file_path
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
