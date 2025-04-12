from typing import Optional
from uuid import UUID

from app.database.crud.base_crud import CRUDBase
from app.database.models import Highlight
from app.schemas.user import CurrentUser
from pydantic import BaseModel
from sqlalchemy.orm import Session


class HighlightBase(BaseModel):
    document_id: UUID
    raw_text: Optional[str] = None
    start_offset: Optional[int] = None
    end_offset: Optional[int] = None


class HighlightCreate(HighlightBase):
    pass


class HighlightUpdate(HighlightBase):
    pass


class HighlightCrud(CRUDBase[Highlight, HighlightCreate, HighlightUpdate]):
    """CRUD operations specifically for Highlight model"""

    def get_highlights_by_document_id(
        self, db: Session, *, document_id: str, user: Optional[CurrentUser] = None
    ):
        """Get highlights associated with document"""
        query = db.query(Highlight).filter(Highlight.document_id == document_id)

        # Add user filter if user is provided
        if user:
            query = query.filter(Highlight.user_id == user.id)

        return query.order_by(Highlight.created_at).all()


# Create a single instance to use throughout the application
highlight_crud = HighlightCrud(Highlight)
