from typing import Optional
from uuid import UUID

from app.database.crud.base_crud import CRUDBase
from app.database.models import Annotation
from app.schemas.user import CurrentUser
from pydantic import BaseModel
from sqlalchemy.orm import Session


class AnnotationBase(BaseModel):
    document_id: UUID
    highlight_id: UUID
    content: Optional[str] = None


class AnnotationCreate(AnnotationBase):
    pass


class AnnotationUpdate(AnnotationBase):
    pass


class AnnotationCrud(CRUDBase[Annotation, AnnotationCreate, AnnotationUpdate]):
    """CRUD operations specifically for Annotation model"""

    def get_annotations_by_document_id(
        self, db: Session, *, document_id: UUID, user: CurrentUser
    ):
        """Get annotations associated with document"""

        return (
            db.query(Annotation)
            .filter(
                Annotation.document_id == document_id, Annotation.user_id == user.id
            )
            .order_by(Annotation.created_at)
            .all()
        )


# Create a single instance to use throughout the application
annotation_crud = AnnotationCrud(Annotation)
