from datetime import datetime
from typing import List, Optional

from app.database.models import Annotation, Highlight, Paper
from app.schemas.user import CurrentUser
from pydantic import BaseModel
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session, joinedload


class HighlightResult(BaseModel):
    id: str
    raw_text: str
    start_offset: Optional[int]
    end_offset: Optional[int]
    page_number: Optional[int]
    role: str
    created_at: datetime

    class Config:
        from_attributes = True


class AnnotationResult(BaseModel):
    id: str
    content: str
    role: str
    created_at: datetime
    highlight: HighlightResult

    class Config:
        from_attributes = True


class PaperResult(BaseModel):
    id: str
    title: Optional[str]
    authors: Optional[List[str]]
    abstract: Optional[str]
    status: str
    publish_date: Optional[datetime]
    created_at: datetime
    last_accessed_at: datetime
    highlights: List[HighlightResult]
    annotations: List[AnnotationResult]

    class Config:
        from_attributes = True


class SearchResults(BaseModel):
    papers: List[PaperResult]
    total_papers: int
    total_highlights: int
    total_annotations: int


def search_knowledge_base(
    db: Session, user: CurrentUser, query: str, limit: int = 50, offset: int = 0
) -> SearchResults:
    """
    Search across papers, annotations, and highlights in a user's knowledge base.
    Returns a hierarchical view with matching content organized under paper metadata.

    Args:
        db: Database session
        user: Current authenticated user
        query: Search query string
        limit: Maximum number of papers to return
        offset: Number of papers to skip (for pagination)

    Returns:
        SearchResults with hierarchical data structure
    """

    # Create case-insensitive search pattern
    search_pattern = f"%{query.lower()}%"

    # Build the main query for papers that match the search criteria
    # We'll search in paper title, abstract, raw_content, and related annotations/highlights
    paper_query = (
        db.query(Paper)
        .filter(Paper.user_id == user.id)
        .filter(
            or_(
                func.lower(Paper.title).like(search_pattern),
                func.lower(Paper.abstract).like(search_pattern),
                func.lower(Paper.raw_content).like(search_pattern),
                # Include papers that have matching highlights
                Paper.id.in_(
                    db.query(Highlight.paper_id).filter(
                        and_(
                            Highlight.user_id == user.id,
                            func.lower(Highlight.raw_text).like(search_pattern),
                        )
                    )
                ),
                # Include papers that have matching annotations
                Paper.id.in_(
                    db.query(Annotation.paper_id).filter(
                        and_(
                            Annotation.user_id == user.id,
                            func.lower(Annotation.content).like(search_pattern),
                        )
                    )
                ),
            )
        )
        .order_by(Paper.last_accessed_at.desc())
    )

    # Get total count for pagination
    total_papers = paper_query.count()

    # Apply pagination
    papers = paper_query.offset(offset).limit(limit).all()

    # For each paper, get matching highlights and annotations
    results = []
    total_highlights = 0
    total_annotations = 0

    for paper in papers:
        # Get highlights that match the search query for this paper
        matching_highlights = (
            db.query(Highlight)
            .filter(
                and_(
                    Highlight.paper_id == paper.id,
                    Highlight.user_id == user.id,
                    func.lower(Highlight.raw_text).like(search_pattern),
                )
            )
            .order_by(Highlight.created_at.desc())
            .all()
        )

        # Get annotations that match the search query for this paper
        matching_annotations = (
            db.query(Annotation)
            .options(joinedload(Annotation.highlight))
            .filter(
                and_(
                    Annotation.paper_id == paper.id,
                    Annotation.user_id == user.id,
                    func.lower(Annotation.content).like(search_pattern),
                )
            )
            .order_by(Annotation.created_at.desc())
            .all()
        )

        # Convert to Pydantic models
        highlight_results = [
            HighlightResult(
                id=str(h.id),
                raw_text=h.raw_text,
                start_offset=h.start_offset,
                end_offset=h.end_offset,
                page_number=h.page_number,
                role=h.role,
                created_at=h.created_at,
            )
            for h in matching_highlights
        ]

        annotation_results = [
            AnnotationResult(
                id=str(a.id),
                content=a.content,
                role=a.role,
                created_at=a.created_at,
                highlight=HighlightResult(
                    id=str(a.highlight.id),
                    raw_text=a.highlight.raw_text,
                    start_offset=a.highlight.start_offset,
                    end_offset=a.highlight.end_offset,
                    page_number=a.highlight.page_number,
                    role=a.highlight.role,
                    created_at=a.highlight.created_at,
                ),
            )
            for a in matching_annotations
        ]

        paper_result = PaperResult(
            id=str(paper.id),
            title=paper.title,
            authors=paper.authors,
            abstract=paper.abstract,
            status=paper.status,
            publish_date=paper.publish_date,
            created_at=paper.created_at,
            last_accessed_at=paper.last_accessed_at,
            highlights=highlight_results,
            annotations=annotation_results,
        )

        results.append(paper_result)
        total_highlights += len(highlight_results)
        total_annotations += len(annotation_results)

    return SearchResults(
        papers=results,
        total_papers=total_papers,
        total_highlights=total_highlights,
        total_annotations=total_annotations,
    )
