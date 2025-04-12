import os
import tempfile
from typing import List, Optional

import requests
from app.database.crud.base_crud import CRUDBase
from app.database.models import Document
from app.helpers.parser import extract_text_from_pdf
from app.helpers.s3 import s3_service
from app.schemas.user import CurrentUser
from pydantic import BaseModel
from sqlalchemy.orm import Session


# Define Pydantic models for type safety
class DocumentBase(BaseModel):
    filename: Optional[str] = None
    file_url: Optional[str] = None
    s3_object_key: Optional[str] = None
    authors: Optional[List[str]] = None
    title: Optional[str] = None
    abstract: Optional[str] = None
    institutions: Optional[List[str]] = None
    keywords: Optional[List[str]] = None
    summary: Optional[str] = None
    starter_questions: Optional[List[str]] = None
    publish_date: Optional[str] = None
    raw_content: Optional[str] = None


class DocumentCreate(DocumentBase):
    # Only mandate required fields for creation, others are optional
    filename: str
    file_url: str
    s3_object_key: Optional[str] = None


class DocumentUpdate(DocumentBase):
    pass


# Document CRUD that inherits from the base CRUD
class DocumentCRUD(CRUDBase[Document, DocumentCreate, DocumentUpdate]):
    """CRUD operations specifically for Document model"""

    def read_raw_document_content(
        self,
        db: Session,
        *,
        document_id: str,
        current_user: CurrentUser,
        file_path: Optional[str] = None,
    ) -> str:
        """
        Read raw document content by ID.
        For PDF files, extract and return the text content.
        """
        document: Document | None = self.get(db, document_id, user=current_user)
        if document is None:
            raise ValueError(f"Document with ID {document_id} not found.")

        if document.raw_content:
            return str(document.raw_content)

        file_url = str(document.file_url) if file_path is None else file_path

        raw_content = ""

        # Handle online files
        if file_url.startswith("http"):
            response = requests.get(file_url, stream=True)
            if response.status_code != 200:
                raise ValueError(f"Failed to fetch document from {file_url}.")

            # If it's a PDF, download to a temp file and extract text
            if (
                file_url.lower().endswith(".pdf")
                or "content-type" in response.headers
                and response.headers["content-type"] == "application/pdf"
            ):
                with tempfile.NamedTemporaryFile(
                    delete=False, suffix=".pdf"
                ) as temp_file:
                    for chunk in response.iter_content(chunk_size=8192):
                        temp_file.write(chunk)
                    temp_file_path = temp_file.name

                try:
                    raw_content = extract_text_from_pdf(temp_file_path)
                finally:
                    os.unlink(temp_file_path)  # Clean up the temp file
            else:
                # For non-PDF files, return the text content directly
                raw_content = response.text

        # Handle local files
        elif file_url.lower().endswith(".pdf"):
            raw_content = extract_text_from_pdf(file_url)
        else:
            # For non-PDF files, read as text
            with open(file_url, "r", encoding="utf-8", errors="replace") as file:
                raw_content = file.read()

        self.update(
            db=db,
            db_obj=document,
            obj_in=DocumentUpdate(
                raw_content=raw_content,
            ),
        )
        return raw_content


# Create a single instance to use throughout the application
document_crud = DocumentCRUD(Document)
