import logging
import uuid
from datetime import datetime
from typing import List, Optional, Tuple

from app.database.crud.annotation_crud import AnnotationCreate, annotation_crud
from app.database.crud.base_crud import CRUDBase
from app.database.crud.highlight_crud import HighlightCreate, highlight_crud
from app.database.models import JobStatus, Paper, PaperStatus, PaperUploadJob, RoleType
from app.helpers.parser import get_start_page_from_offset
from app.llm.schemas import PaperMetadataExtraction, ResponseCitation
from app.llm.utils import find_offsets
from app.schemas.user import CurrentUser
from pydantic import BaseModel
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


# Define Pydantic models for type safety
class PaperBase(BaseModel):
    file_url: Optional[str] = None
    s3_object_key: Optional[str] = None
    authors: Optional[List[str]] = None
    title: Optional[str] = None
    abstract: Optional[str] = None
    institutions: Optional[List[str]] = None
    keywords: Optional[List[str]] = None
    summary: Optional[str] = None
    summary_citations: Optional[List[ResponseCitation]] = None
    starter_questions: Optional[List[str]] = None
    publish_date: Optional[str] = None
    raw_content: Optional[str] = None
    upload_job_id: Optional[str] = None
    preview_url: Optional[str] = None
    size_in_kb: Optional[int] = None
    # We can't save tuples in the db, so we use a list (length 2) to represent page offsets
    page_offset_map: Optional[dict[int, List[int]]] = None


class PaperCreate(PaperBase):
    # Only mandate required fields for creation, others are optional
    file_url: str  # type: ignore
    raw_content: str  # type: ignore
    s3_object_key: Optional[str] = None
    upload_job_id: Optional[str] = None
    preview_url: Optional[str] = None


class PaperUpdate(PaperBase):
    status: Optional[PaperStatus] = PaperStatus.todo
    cached_presigned_url: Optional[str] = None
    presigned_url_expires_at: Optional[datetime] = None
    open_alex_id: Optional[str] = None
    doi: Optional[str] = None
    size_in_kb: Optional[int] = None


class PaperDocumentMetadata(BaseModel):
    raw_content: Optional[str] = None
    page_offsets: Optional[dict[int, Tuple[int, int]]] = None


# Paper CRUD that inherits from the base CRUD
class PaperCRUD(CRUDBase[Paper, PaperCreate, PaperUpdate]):
    """CRUD operations specifically for Document model"""

    def read_raw_document_content(
        self,
        db: Session,
        *,
        paper_id: str,
        current_user: CurrentUser,
    ) -> PaperDocumentMetadata:
        """
        Read raw document content by ID.
        For PDF files, extract and return the text content.
        """
        paper: Paper | None = self.get(db, paper_id, user=current_user)
        if paper is None:
            raise ValueError(f"Paper with ID {paper_id} not found.")

        if not paper.raw_content:
            raise ValueError(f"Raw content for paper {paper_id} is not set.")

        offsets = {k: tuple(v) for k, v in paper.page_offset_map.items()}

        return PaperDocumentMetadata(
            raw_content=str(paper.raw_content),
            page_offsets=offsets,
        )

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
            .filter(Paper.user_id == user.id, Paper.status == PaperStatus.todo)
            .order_by(Paper.last_accessed_at.desc())
            .limit(remaining_limit)
            .all()
        )

        # Combine and return
        return reading_papers + todo_papers

    def get_size_of_knowledge_base(self, db: Session, *, user: CurrentUser) -> int:
        """
        Get the total size of the user's knowledge base in KB.
        This includes all papers that have completed uploads.
        """
        from app.helpers.s3 import s3_service

        papers = self.get_multi_uploads_completed(db, user=user)
        total_size = 0
        for paper in papers:
            # Use the size_in_kb if available, otherwise fetch from S3 and update the paper.size_in_kb value
            size_value = getattr(paper, "size_in_kb", None)
            if size_value is not None:
                total_size += size_value
            elif paper.s3_object_key:
                paper_size_in_kb = s3_service.get_file_size_in_kb(
                    str(paper.s3_object_key)
                )
                total_size += paper_size_in_kb if paper_size_in_kb is not None else 0
                if paper_size_in_kb:
                    # Update the paper's size_in_kb field in the database
                    update_paper = PaperUpdate(size_in_kb=paper_size_in_kb)
                    self.update(db, db_obj=paper, obj_in=update_paper)

        return total_size

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

    def get_by_upload_job_id(
        self, db: Session, *, upload_job_id: str, user: CurrentUser
    ) -> Optional[Paper]:
        """Get a paper by its upload job ID"""
        return (
            db.query(Paper)
            .filter(Paper.upload_job_id == upload_job_id, Paper.user_id == user.id)
            .first()
        )

    def get_multi_uploads_completed(
        self,
        db: Session,
        *,
        user: CurrentUser,
        skip: int = 0,
        limit: int = 100,
        status: Optional[PaperStatus] = None,
    ) -> List[Paper]:
        """
        Get multiple papers that have completed uploads
        Completed uploads are those either with a null upload_job_id OR an upload_job with status 'completed'.
        """
        return (
            db.query(Paper)
            .outerjoin(PaperUploadJob, Paper.upload_job_id == PaperUploadJob.id)
            .filter(
                Paper.user_id == user.id,
                (
                    Paper.upload_job_id.is_(None)  # No upload job (direct uploads)
                    | (
                        PaperUploadJob.status == JobStatus.COMPLETED
                    )  # Or job is completed
                ),
                (Paper.status == status if status else True),
            )
            .order_by(Paper.updated_at.desc())
            .offset(skip)
            .limit(limit)
            .all()
        )

    def create_ai_annotations(
        self,
        db: Session,
        *,
        paper_id: str,
        extract_metadata: PaperMetadataExtraction,
        current_user: CurrentUser,
    ):
        raw_file = self.read_raw_document_content(
            db, paper_id=paper_id, current_user=current_user
        )

        if not raw_file.raw_content:
            raise ValueError(f"Raw content for paper {paper_id} is not set.")

        for ai_highlight in extract_metadata.highlights:
            offsets = find_offsets(ai_highlight.text, raw_file.raw_content)

            page_number = None
            if offsets and raw_file.page_offsets:
                # Get the starting page number from the offsets
                page_number = get_start_page_from_offset(
                    raw_file.page_offsets, offsets[0]
                )

            new_ai_highlight_obj = HighlightCreate(
                paper_id=uuid.UUID(paper_id),
                raw_text=ai_highlight.text,
                start_offset=offsets[0],
                end_offset=offsets[1],
                page_number=page_number,
                role=RoleType.ASSISTANT,
            )

            n_ai_h = highlight_crud.create(
                db, obj_in=new_ai_highlight_obj, user=current_user
            )

            if not n_ai_h:
                logger.error(
                    f"Failed to create AI highlights for {paper_id}",
                    exc_info=True,
                )
                continue

            n_annotation_obj = AnnotationCreate(
                paper_id=uuid.UUID(paper_id),
                highlight_id=n_ai_h.id,  # type: ignore
                role=RoleType.ASSISTANT,
                content=ai_highlight.annotation,
            )

            n_ai_annotation = annotation_crud.create(
                db, obj_in=n_annotation_obj, user=current_user
            )

            if not n_ai_annotation:
                logger.error(
                    f"Failed to create AI annotation for highlight {n_ai_h.id} in {paper_id}",
                    exc_info=True,
                )


# Create a single instance to use throughout the application
paper_crud = PaperCRUD(Paper)
