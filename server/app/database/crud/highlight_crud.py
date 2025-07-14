from typing import Optional
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
