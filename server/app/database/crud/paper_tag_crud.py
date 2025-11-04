import uuid
from typing import List, Optional

from app.database.crud.base_crud import CRUDBase
from app.database.models import Paper, PaperTag, PaperTagAssociation, User
from app.schemas.user import CurrentUser
from pydantic import BaseModel
from sqlalchemy.orm import Session


# Pydantic models for PaperTag
class PaperTagBase(BaseModel):
    name: str
    color: Optional[str] = None


class PaperTagCreate(PaperTagBase):
    pass


class PaperTagUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None


class PaperTagCRUD(CRUDBase[PaperTag, PaperTagCreate, PaperTagUpdate]):
    def create(
        self, db: Session, *, obj_in: PaperTagCreate, user: Optional[CurrentUser] = None
    ) -> PaperTag:
        if not user:
            raise ValueError("User must be provided to create a paper tag")

        db_obj = PaperTag(
            name=obj_in.name,
            color=obj_in.color,
            user_id=user.id,
        )
        db.add(db_obj)
        db.commit()
        db.refresh(db_obj)
        return db_obj

    def get_by_name(
        self, db: Session, *, name: str, user: CurrentUser
    ) -> Optional[PaperTag]:
        return (
            db.query(PaperTag)
            .filter(PaperTag.name == name, PaperTag.user_id == user.id)
            .first()
        )

    def add_tag_to_paper(
        self, db: Session, *, paper_id: uuid.UUID, tag_id: uuid.UUID, user: CurrentUser
    ) -> Optional[PaperTagAssociation]:
        # Ensure paper belongs to the user
        paper = (
            db.query(Paper)
            .filter(Paper.id == paper_id, Paper.user_id == user.id)
            .first()
        )
        if not paper:
            return None

        # Ensure tag belongs to the user
        tag = (
            db.query(PaperTag)
            .filter(PaperTag.id == tag_id, PaperTag.user_id == user.id)
            .first()
        )
        if not tag:
            return None

        association = PaperTagAssociation(paper_id=paper_id, tag_id=tag_id)
        db.add(association)
        db.commit()
        return association

    def remove_tag_from_paper(
        self, db: Session, *, paper_id: uuid.UUID, tag_id: uuid.UUID, user: CurrentUser
    ):
        # Ensure paper belongs to the user to enforce security
        paper = (
            db.query(Paper)
            .filter(Paper.id == paper_id, Paper.user_id == user.id)
            .first()
        )
        if not paper:
            # Or raise an exception
            return

        association = (
            db.query(PaperTagAssociation)
            .filter(
                PaperTagAssociation.paper_id == paper_id,
                PaperTagAssociation.tag_id == tag_id,
            )
            .first()
        )

        if association:
            db.delete(association)
            db.commit()

    def get_tags_for_paper(
        self, db: Session, *, paper_id: uuid.UUID, user: CurrentUser
    ) -> List[PaperTag]:
        # Ensure paper belongs to the user
        paper = (
            db.query(Paper)
            .filter(Paper.id == paper_id, Paper.user_id == user.id)
            .first()
        )
        if not paper:
            return []
        return paper.tags

    def get_papers_for_tag(
        self, db: Session, *, tag_id: uuid.UUID, user: CurrentUser
    ) -> List[Paper]:
        # Ensure tag belongs to the user
        tag = (
            db.query(PaperTag)
            .filter(PaperTag.id == tag_id, PaperTag.user_id == user.id)
            .first()
        )
        if not tag:
            return []
        return tag.papers


paper_tag_crud = PaperTagCRUD(PaperTag)
