import uuid
from typing import List, Optional

from app.database.crud.base_crud import CRUDBase
from app.database.models import Paper, PaperTag, PaperTagAssociation, User
from app.schemas.user import CurrentUser
from pydantic import BaseModel
from sqlalchemy import func
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

    def get_or_create_by_name(
        self,
        db: Session,
        *,
        name: str,
        user_id: uuid.UUID,
        commit: bool = True,
    ) -> Optional[PaperTag]:
        """Return the user's tag matching ``name`` (case-insensitive, trimmed),
        creating it with the original casing if none exists.

        Returns ``None`` for blank names. This is the single reuse rule that both
        keyword ingestion (webhook) and the keywords->tags migration rely on, so
        neither produces near-duplicate tags differing only by case or whitespace.
        """
        normalized = (name or "").strip()
        if not normalized:
            return None

        existing = (
            db.query(PaperTag)
            .filter(
                PaperTag.user_id == user_id,
                func.lower(PaperTag.name) == normalized.lower(),
            )
            .first()
        )
        if existing:
            return existing

        db_obj = PaperTag(name=normalized, color=None, user_id=user_id)
        db.add(db_obj)
        if commit:
            db.commit()
            db.refresh(db_obj)
        else:
            # Flush so the generated id is available to callers building
            # associations within the same (uncommitted) transaction.
            db.flush()
        return db_obj

    def apply_keyword_tags(
        self,
        db: Session,
        *,
        paper_id: uuid.UUID,
        keywords: List[str],
        user_id: uuid.UUID,
        commit: bool = True,
    ) -> int:
        """Turn a paper's extracted keywords into user tags and attach them.

        For each keyword, reuses an existing tag (case-insensitive) or creates
        one, then links it to the paper if not already linked. Idempotent — safe
        to re-run. Returns the number of new paper<->tag associations created.
        """
        if not keywords:
            return 0

        existing_tag_ids = {
            row[0]
            for row in db.query(PaperTagAssociation.tag_id)
            .filter(PaperTagAssociation.paper_id == paper_id)
            .all()
        }

        new_associations = 0
        seen_tag_ids: set = set()
        for keyword in keywords:
            tag = self.get_or_create_by_name(
                db, name=keyword, user_id=user_id, commit=False
            )
            if tag is None or tag.id in seen_tag_ids:
                continue
            seen_tag_ids.add(tag.id)
            if tag.id in existing_tag_ids:
                continue
            db.add(PaperTagAssociation(paper_id=paper_id, tag_id=tag.id))
            new_associations += 1

        if commit:
            db.commit()
        else:
            db.flush()
        return new_associations

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

    def bulk_add_tags_to_papers(
        self,
        db: Session,
        *,
        paper_ids: List[uuid.UUID],
        tag_ids: List[uuid.UUID],
        user: CurrentUser,
    ):
        # First, verify all papers and tags belong to the user
        papers = (
            db.query(Paper.id)
            .filter(Paper.user_id == user.id, Paper.id.in_(paper_ids))
            .all()
        )
        # Convert list of tuples to list of UUIDs
        found_paper_ids = {p[0] for p in papers}
        if len(found_paper_ids) != len(set(paper_ids)):
            raise ValueError(
                "One or more papers not found or do not belong to the user."
            )

        tags = (
            db.query(PaperTag.id)
            .filter(PaperTag.user_id == user.id, PaperTag.id.in_(tag_ids))
            .all()
        )
        found_tag_ids = {t[0] for t in tags}
        if len(found_tag_ids) != len(set(tag_ids)):
            raise ValueError("One or more tags not found or do not belong to the user.")

        associations_to_create = []
        for paper_id in paper_ids:
            for tag_id in tag_ids:
                # Check if the association already exists
                existing_association = (
                    db.query(PaperTagAssociation)
                    .filter_by(paper_id=paper_id, tag_id=tag_id)
                    .first()
                )
                if not existing_association:
                    associations_to_create.append(
                        {"paper_id": paper_id, "tag_id": tag_id}
                    )

        if associations_to_create:
            db.bulk_insert_mappings(PaperTagAssociation, associations_to_create)
            db.commit()


paper_tag_crud = PaperTagCRUD(PaperTag)
