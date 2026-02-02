"""CRUD operations for DiscoverSearch."""

import logging
from datetime import datetime, timedelta, timezone
from typing import List, Optional
from uuid import UUID

from app.database.models import DiscoverSearch
from app.schemas.user import CurrentUser
from pydantic import BaseModel
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


class DiscoverSearchCreate(BaseModel):
    question: str
    subqueries: list[str]
    results: dict


class DiscoverSearchCRUD:
    def create(
        self,
        db: Session,
        *,
        question: str,
        subqueries: list[str],
        results: dict,
        user: CurrentUser,
    ) -> Optional[DiscoverSearch]:
        try:
            obj = DiscoverSearch(
                user_id=user.id,
                question=question,
                subqueries=subqueries,
                results=results,
            )
            db.add(obj)
            db.commit()
            db.refresh(obj)
            return obj
        except Exception as e:
            db.rollback()
            logger.error(f"Error creating DiscoverSearch: {e}", exc_info=True)
            return None

    def get_history(
        self,
        db: Session,
        *,
        user: CurrentUser,
        limit: int = 20,
    ) -> List[DiscoverSearch]:
        try:
            return (
                db.query(DiscoverSearch)
                .filter(DiscoverSearch.user_id == user.id)
                .order_by(DiscoverSearch.created_at.desc())
                .limit(limit)
                .all()
            )
        except Exception as e:
            logger.error(f"Error fetching discover history: {e}", exc_info=True)
            return []

    def get_by_id(
        self,
        db: Session,
        *,
        search_id: str,
        user: CurrentUser,
    ) -> Optional[DiscoverSearch]:
        try:
            return (
                db.query(DiscoverSearch)
                .filter(
                    DiscoverSearch.id == UUID(search_id),
                    DiscoverSearch.user_id == user.id,
                )
                .first()
            )
        except Exception as e:
            logger.error(
                f"Error fetching discover search {search_id}: {e}", exc_info=True
            )
            return None

    def get_searches_this_week(self, db: Session, *, user: CurrentUser) -> int:
        """Count discover searches by this user in the current week (Monday-based)."""
        try:
            now = datetime.now(timezone.utc)
            # Monday of current week
            monday = now - timedelta(days=now.weekday())
            monday = monday.replace(hour=0, minute=0, second=0, microsecond=0)

            return (
                db.query(DiscoverSearch)
                .filter(
                    DiscoverSearch.user_id == user.id,
                    DiscoverSearch.created_at >= monday,
                )
                .count()
            )
        except Exception as e:
            logger.error(f"Error counting weekly discover searches: {e}", exc_info=True)
            return 0


discover_search_crud = DiscoverSearchCRUD()
