import os
import tempfile
import uuid
from datetime import datetime
from typing import List, Optional

import requests
from app.database.crud.base_crud import CRUDBase
from app.database.models import Paper, PaperStatus
from app.helpers.parser import extract_text_from_pdf
from app.schemas.user import CurrentUser
from pydantic import BaseModel
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
    filename: str  # type: ignore
    file_url: str  # type: ignore
    s3_object_key: Optional[str] = None


class PaperUpdate(PaperBase):
    status: Optional[PaperStatus] = PaperStatus.todo
    cached_presigned_url: Optional[str] = None
    presigned_url_expires_at: Optional[datetime] = None


# Paper CRUD that inherits from the base CRUD
class PaperCRUD(CRUDBase[Paper, PaperCreate, PaperUpdate]):
    """CRUD operations specifically for Document model"""

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

    def get_top_relevant_papers(
        self, db: Session, *, user: CurrentUser, limit: int = 3
    ) -> List[Paper]:
        """
        Get recent papers with priority logic:
        1. Order by most recently uploaded
        2. First get papers with 'reading' status
        3. If under limit, fill with 'todo' status papers
        4. Return up to limit papers
        """
        # First, get reading papers
        reading_papers = (
            db.query(Paper)
            .filter(Paper.user_id == user.id, Paper.status == PaperStatus.reading)
            .order_by(Paper.last_accessed_at.desc())
            .limit(limit)
            .all()
        )

        # If we have enough reading papers, return them
        if len(reading_papers) >= limit:
            return reading_papers[:limit]

        # Calculate how many more papers we need
        remaining_limit = limit - len(reading_papers)

        # Get todo papers to fill the remaining slots
        todo_papers = (
            db.query(Paper)
            .filter(Paper.owner_id == user.id, Paper.status == PaperStatus.todo)
            .order_by(Paper.last_accessed_at.desc())
            .limit(remaining_limit)
            .all()
        )

        # Combine and return
        return reading_papers + todo_papers

    def make_public(
        self, db: Session, *, paper_id: str, user: CurrentUser
    ) -> Optional[Paper]:
        """Make a paper publicly accessible via share link"""
        paper = self.get(db, id=paper_id, user=user)
        if paper:
            # Generate a unique share ID if not already present
            if not paper.share_id:
                paper.share_id = str(uuid.uuid4())  # type: ignore
            paper.is_public = True  # type: ignore
            db.commit()
            db.refresh(paper)
        return paper

    def make_private(
        self, db: Session, *, paper_id: str, user: CurrentUser
    ) -> Optional[Paper]:
        """Make a paper private (not publicly accessible)"""
        paper = self.get(db, id=paper_id, user=user)
        if paper:
            paper.is_public = False  # type: ignore
            db.commit()
            db.refresh(paper)
        return paper

    def get_public_paper(self, db: Session, *, share_id: str) -> Optional[Paper]:
        """Get a paper by its share_id if it's public"""
        return (
            db.query(Paper)
            .filter(Paper.share_id == share_id, Paper.is_public == True)
            .first()
        )


# Create a single instance to use throughout the application
paper_crud = PaperCRUD(Paper)
