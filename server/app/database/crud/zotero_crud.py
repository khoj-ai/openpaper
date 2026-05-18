import datetime
from typing import Optional
from uuid import UUID

from app.database.models import ZoteroConnection, ZoteroOAuthPending
from sqlalchemy.orm import Session

PENDING_TTL_MINUTES = 15


class CRUDZotero:
    def create_pending(
        self,
        db: Session,
        *,
        user_id: UUID,
        oauth_token: str,
        oauth_token_secret: str,
    ) -> ZoteroOAuthPending:
        expires_at = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(
            minutes=PENDING_TTL_MINUTES
        )
        db_obj = ZoteroOAuthPending(
            user_id=user_id,
            oauth_token=oauth_token,
            oauth_token_secret=oauth_token_secret,
            expires_at=expires_at,
        )
        db.add(db_obj)
        db.commit()
        db.refresh(db_obj)
        return db_obj

    def get_pending_by_token(
        self, db: Session, *, oauth_token: str
    ) -> Optional[ZoteroOAuthPending]:
        return (
            db.query(ZoteroOAuthPending)
            .filter(ZoteroOAuthPending.oauth_token == oauth_token)
            .first()
        )

    def delete_pending(self, db: Session, *, pending: ZoteroOAuthPending) -> None:
        db.delete(pending)
        db.commit()

    def delete_pending_for_user(self, db: Session, *, user_id: UUID) -> None:
        db.query(ZoteroOAuthPending).filter(
            ZoteroOAuthPending.user_id == user_id
        ).delete()
        db.commit()

    def upsert_connection(
        self,
        db: Session,
        *,
        user_id: UUID,
        zotero_user_id: str,
        api_key: str,
    ) -> ZoteroConnection:
        existing = self.get_by_user_id(db, user_id=user_id)
        if existing:
            existing.zotero_user_id = zotero_user_id
            existing.api_key = api_key
            db.add(existing)
            db.commit()
            db.refresh(existing)
            return existing

        db_obj = ZoteroConnection(
            user_id=user_id,
            zotero_user_id=zotero_user_id,
            api_key=api_key,
        )
        db.add(db_obj)
        db.commit()
        db.refresh(db_obj)
        return db_obj

    def get_by_user_id(
        self, db: Session, *, user_id: UUID
    ) -> Optional[ZoteroConnection]:
        return (
            db.query(ZoteroConnection).filter(ZoteroConnection.user_id == user_id).first()
        )

    def delete_by_user_id(self, db: Session, *, user_id: UUID) -> bool:
        connection = self.get_by_user_id(db, user_id=user_id)
        if not connection:
            return False
        db.delete(connection)
        db.commit()
        return True


zotero_crud = CRUDZotero()
