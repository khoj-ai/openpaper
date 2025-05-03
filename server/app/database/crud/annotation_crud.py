from typing import Optional
from uuid import UUID

from app.database.crud.base_crud import CRUDBase
from app.database.models import Annotation, Paper
from app.schemas.user import CurrentUser
from pydantic import BaseModel
from sqlalchemy.orm import Session


class AnnotationBase(BaseModel):
    paper_id: UUID
    highlight_id: UUID
    content: Optional[str] = None


class AnnotationCreate(AnnotationBase):
    pass


class AnnotationUpdate(AnnotationBase):
    pass


class AnnotationCrud(CRUDBase[Annotation, AnnotationCreate, AnnotationUpdate]):
    """CRUD operations specifically for Annotation model"""

    def get_annotations_by_paper_id(
        self, db: Session, *, paper_id: UUID, user: CurrentUser
    ):
        """Get annotations associated with document"""

        return (
            db.query(Annotation)
            .filter(Annotation.paper_id == paper_id, Annotation.user_id == user.id)
            .order_by(Annotation.created_at)
            .all()
        )

    def get_public_annotations_data_by_paper_id(
        self,
        db: Session,
        *,
        share_id: UUID,
    ):
        """Get public annotations associated with document"""

        return (
            db.query(Annotation)
            .join(Paper, Annotation.paper_id == Paper.id)
            .filter(Paper.share_id == share_id, Paper.is_public == True)
            .order_by(Annotation.created_at)
            .all()
        )


# Create a single instance to use throughout the application
annotation_crud = AnnotationCrud(Annotation)
