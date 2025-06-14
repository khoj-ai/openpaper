from typing import Optional
from uuid import UUID

from app.database.crud.base_crud import CRUDBase
from app.database.models import AIAnnotation, Paper
from app.schemas.user import CurrentUser
from pydantic import BaseModel
from sqlalchemy.orm import Session


class AIAnnotationBase(BaseModel):
    paper_id: str
    ai_highlight_id: str
    content: Optional[str] = None


class AIAnnotationCreate(AIAnnotationBase):
    pass


class AIAnnotationUpdate(AIAnnotationBase):
    pass


class AIAnnotationCrud(CRUDBase[AIAnnotation, AIAnnotationCreate, AIAnnotationUpdate]):
    """CRUD operations specifically for AIAnnotation model"""

    def get_ai_annotations_by_paper_id(
        self, db: Session, *, paper_id: UUID, user: CurrentUser
    ):
        """Get AI annotations associated with document"""
        return (
            db.query(AIAnnotation)
            .join(Paper, AIAnnotation.paper_id == Paper.id)
            .filter(AIAnnotation.paper_id == str(paper_id), Paper.user_id == user.id)
            .order_by(AIAnnotation.id)
            .all()
        )

    def get_public_ai_annotations_data_by_paper_id(
        self,
        db: Session,
        *,
        share_id: UUID,
    ):
        """Get public AI annotations associated with document"""

        return (
            db.query(AIAnnotation)
            .join(Paper, AIAnnotation.paper_id == Paper.id)
            .filter(Paper.share_id == str(share_id), Paper.is_public == True)
            .order_by(AIAnnotation.id)
            .all()
        )


# Create a single instance to use throughout the application
ai_annotation_crud = AIAnnotationCrud(AIAnnotation)
