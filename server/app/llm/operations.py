import os
from typing import Optional

from google import genai # type: ignore
from sqlalchemy.orm import Session
from fastapi import Depends
from app.database.database import get_db

from app.llm.schemas import PaperMetadataExtraction
from app.database.crud.document_crud import document_crud
from app.database.models import Document

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

gemini_client = genai.Client(api_key=GEMINI_API_KEY)


class Operations:
    """
    Class to handle operations related to LLM
    """

    def __init__(self):
        self.client = genai.Client(api_key=GEMINI_API_KEY)
        self.default_model = "gemini-2.0-flash"

    async def explain_text(self, contents: str, model: Optional[str] = "gemini-2.0-flash"):
        """
        Explain the provided text using the specified model
        """
        async for chunk in self.client.models.generate_content_stream(
            model=model, contents=contents
        ):
            # Process the chunk of generated content
            yield chunk.text
            
    def extract_paper_metadata(self, paper_id: str, db: Session = Depends(get_db)):
        """
        Extract metadata from the paper using the specified model
        """
        paper = document_crud.get(db, id=paper_id)
        
        if not paper:
            raise ValueError(f"Paper with ID {paper_id} not found.")
        
        # Extract metadata using the LLM
        response = self.client.models.generate_content(
            model=self.default_model,
            contents=paper,
            prompt="You are a metadata extraction assistant. Your task is to extract relevant information from academic papers."
        )
        
        # Parse the response and return the metadata
        metadata = PaperMetadataExtraction.parse_raw(response)
        return metadata
        
        
        
    