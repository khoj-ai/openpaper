from typing import Any, List, Optional, Set
from uuid import UUID

from app.database.crud.base_crud import CRUDBase
from app.database.models import Highlight, Paper
from app.schemas.user import CurrentUser
from pydantic import BaseModel
from sqlalchemy.orm import Session


class HighlightBase(BaseModel):
    paper_id: UUID
    raw_text: Optional[str] = None
    start_offset: Optional[int] = None
    end_offset: Optional[int] = None
    page_number: Optional[int] = None
    role: Optional[str] = None
    type: Optional[str] = None  # HighlightType enum value
    position: Optional[dict[str, Any]] = None  # ScaledPosition JSON
    color: Optional[str] = None  # Highlight color: yellow, green, blue, pink, purple
    zotero_annotation_key: Optional[str] = None


class HighlightCreate(HighlightBase):
    pass


class HighlightUpdate(HighlightBase):
    pass


class HighlightCrud(CRUDBase[Highlight, HighlightCreate, HighlightUpdate]):
    """CRUD operations specifically for Highlight model"""

    def get_highlights_by_paper_id(
        self, db: Session, *, paper_id: str, user: Optional[CurrentUser] = None
    ):
        """Get highlights associated with document"""
        query = db.query(Highlight).filter(Highlight.paper_id == paper_id)

        # Add user filter if user is provided
        if user:
            query = query.filter(Highlight.user_id == user.id)

        return query.order_by(Highlight.created_at).all()

    def get_zotero_annotation_keys_for_paper(
        self, db: Session, *, paper_id: UUID
    ) -> Set[str]:
        rows = (
            db.query(Highlight.zotero_annotation_key)
            .filter(
                Highlight.paper_id == paper_id,
                Highlight.zotero_annotation_key.isnot(None),
            )
            .all()
        )
        return {row[0] for row in rows if row[0]}

    def find_backfill_candidate(
        self,
        db: Session,
        *,
        paper_id: UUID,
        raw_text: str,
        page_number: Optional[int],
    ) -> Optional[Highlight]:
        normalized_text = raw_text.strip().casefold()
        query = db.query(Highlight).filter(
            Highlight.paper_id == paper_id,
            Highlight.zotero_annotation_key.is_(None),
        )
        if page_number is not None:
            query = query.filter(Highlight.page_number == page_number)

        candidates = query.all()
        matches = [
            h
            for h in candidates
            if (h.raw_text or "").strip().casefold() == normalized_text
        ]
        if len(matches) == 1:
            return matches[0]
        return None

    def set_zotero_annotation_key(
        self,
        db: Session,
        *,
        highlight: Highlight,
        zotero_annotation_key: str,
    ) -> Highlight:
        highlight.zotero_annotation_key = zotero_annotation_key
        db.add(highlight)
        db.commit()
        db.refresh(highlight)
        return highlight

    def get_public_highlights_data_by_paper_id(self, db: Session, *, share_id: str):
        """Get public highlights associated with document"""
        return (
            db.query(Highlight)
            .join(Paper, Highlight.paper_id == Paper.id)
            .filter(Paper.share_id == share_id, Paper.is_public == True)
            .order_by(Highlight.created_at)
            .all()
        )


# Create a single instance to use throughout the application
highlight_crud = HighlightCrud(Highlight)
