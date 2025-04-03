from typing import Optional
from uuid import UUID

from app.database.crud.base_crud import CRUDBase
from app.database.models import PaperNote
from pydantic import BaseModel
from sqlalchemy.orm import Session


class PaperNoteBase(BaseModel):
    document_id: UUID
    content: Optional[str] = None


class PaperNoteCreate(PaperNoteBase):
    pass


class PaperNoteUpdate(BaseModel):
    content: str


class PaperNoteCRUD(CRUDBase[PaperNote, PaperNoteCreate, PaperNoteUpdate]):
    """CRUD operations specifically for PaperNote model"""

    def get_paper_note_by_document_id(self, db: Session, *, document_id: str):
        """Get paper note associated with document"""

        return (
            db.query(PaperNote)
            .filter(PaperNote.document_id == document_id)
            .order_by(PaperNote.created_at)
            .first()
        )


# Create a single instance to use throughout the application
paper_note_crud = PaperNoteCRUD(PaperNote)
