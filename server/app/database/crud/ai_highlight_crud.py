from typing import Optional

from app.database.crud.base_crud import CRUDBase
from app.database.models import AIHighlight, Paper
from app.schemas.user import CurrentUser
from pydantic import BaseModel
from sqlalchemy.orm import Session


class AIHighlightBase(BaseModel):
    paper_id: str
    raw_text: str
    start_offset_hint: int
    end_offset_hint: int
    page_number: Optional[int] = None


class AIHighlightCreate(AIHighlightBase):
    pass


class AIHighlightUpdate(AIHighlightBase):
    pass


class AIHighlightCrud(CRUDBase[AIHighlight, AIHighlightCreate, AIHighlightUpdate]):
    """CRUD operations specifically for AIHighlight model"""

    def get_ai_highlights_by_paper_id(
        self, db: Session, *, paper_id: str, user: CurrentUser
    ):
        """Get AI highlights associated with document"""
        query = (
            db.query(AIHighlight)
            .join(Paper, AIHighlight.paper_id == Paper.id)
            .filter(AIHighlight.paper_id == paper_id, Paper.user_id == user.id)
            .order_by(AIHighlight.created_at)
        )

        return query.all()

    def get_public_ai_highlights_by_paper_id(self, db: Session, *, share_id: str):
        """Get public AI highlights associated with document"""
        return (
            db.query(AIHighlight)
            .join(Paper, AIHighlight.paper_id == Paper.id)
            .filter(Paper.share_id == share_id, Paper.is_public == True)
            .order_by(AIHighlight.created_at)
            .all()
        )


# Create a single instance to use throughout the application
ai_highlight_crud = AIHighlightCrud(AIHighlight)
