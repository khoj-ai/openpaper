import os
import tempfile
from typing import List, Optional

import requests
from app.database.crud.base_crud import CRUDBase
from app.database.models import Paper
from app.helpers.parser import extract_text_from_pdf
from app.helpers.s3 import s3_service
from app.schemas.user import CurrentUser
from fastapi import HTTPException
from pydantic import BaseModel, HttpUrl
from sqlalchemy.orm import Session


# Define Pydantic models for type safety
class PaperBase(BaseModel):
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


class PaperCreate(PaperBase):
    # Only mandate required fields for creation, others are optional
    filename: str
    file_url: str
    s3_object_key: Optional[str] = None


class PaperUpdate(PaperBase):
    pass


# Paper CRUD that inherits from the base CRUD
class PaperCRUD(CRUDBase[Paper, PaperCreate, PaperUpdate]):
    """CRUD operations specifically for Document model"""

    async def create_from_url(
        self, db: Session, *, url: HttpUrl, current_user: CurrentUser
    ) -> Paper:
        """
        Create a new paper from a URL

        Args:
            db: Database session
            url: URL of the PDF file
            current_user: Current user making the request

        Returns:
            Paper: Created paper

        Raises:
            HTTPException: If upload fails
        """
        try:
            # Upload file to S3
            object_key, file_url = await s3_service.read_and_upload_file_from_url(
                str(url)
            )

            # Create paper
            doc_in = PaperCreate(
                filename=os.path.basename(file_url),
                file_url=file_url,
                s3_object_key=object_key,
            )

            paper = self.create(db=db, obj_in=doc_in, user=current_user)

            # Extract and update content
            raw_content = self.read_raw_document_content(
                db, paper_id=paper.id, current_user=current_user
            )

            return paper

        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=500, detail="Failed to process document")

    def read_raw_document_content(
        self,
        db: Session,
        *,
        paper_id: str,
        current_user: CurrentUser,
        file_path: Optional[str] = None,
    ) -> str:
        """
        Read raw document content by ID.
        For PDF files, extract and return the text content.
        """
        paper: Paper | None = self.get(db, paper_id, user=current_user)
        if paper is None:
            raise ValueError(f"Paper with ID {paper_id} not found.")

        if paper.raw_content:
            return str(paper.raw_content)

        file_url = str(paper.file_url) if file_path is None else file_path

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
            db_obj=paper,
            obj_in=PaperUpdate(
                raw_content=raw_content,
            ),
        )
        return raw_content


# Create a single instance to use throughout the application
paper_crud = PaperCRUD(Paper)
