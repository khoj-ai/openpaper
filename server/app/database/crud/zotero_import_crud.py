from datetime import datetime, timedelta, timezone
from typing import List, Optional, Tuple
from uuid import UUID

from app.database.models import Paper, ZoteroImportedItem, ZoteroImportSource, ZoteroImportStatus
from sqlalchemy import or_
from sqlalchemy.orm import Session


class CRUDZoteroImport:
    def get_by_item_key(
        self, db: Session, *, user_id: UUID, zotero_item_key: str
    ) -> Optional[ZoteroImportedItem]:
        return (
            db.query(ZoteroImportedItem)
            .filter(
                ZoteroImportedItem.user_id == user_id,
                ZoteroImportedItem.zotero_item_key == zotero_item_key,
            )
            .first()
        )

    def get_by_upload_job_id(
        self, db: Session, *, upload_job_id: UUID
    ) -> Optional[ZoteroImportedItem]:
        return (
            db.query(ZoteroImportedItem)
            .filter(ZoteroImportedItem.upload_job_id == upload_job_id)
            .first()
        )

    def list_recent_by_user(
        self, db: Session, *, user_id: UUID, limit: int = 20
    ) -> List[Tuple[ZoteroImportedItem, Optional[str]]]:
        return (
            db.query(ZoteroImportedItem, Paper.title)
            .outerjoin(Paper, ZoteroImportedItem.paper_id == Paper.id)
            .filter(ZoteroImportedItem.user_id == user_id)
            .order_by(ZoteroImportedItem.created_at.desc())
            .limit(limit)
            .all()
        )

    def create(
        self,
        db: Session,
        *,
        user_id: UUID,
        zotero_item_key: str,
        import_source: str,
        zotero_attachment_key: Optional[str] = None,
        source_url: Optional[str] = None,
        paper_id: Optional[UUID] = None,
        upload_job_id: Optional[UUID] = None,
        annotations_payload: Optional[list] = None,
        status: str = ZoteroImportStatus.PROCESSING,
    ) -> ZoteroImportedItem:
        db_obj = ZoteroImportedItem(
            user_id=user_id,
            zotero_item_key=zotero_item_key,
            zotero_attachment_key=zotero_attachment_key,
            import_source=import_source,
            source_url=source_url,
            paper_id=paper_id,
            upload_job_id=upload_job_id,
            annotations_payload=annotations_payload,
            status=status,
        )
        db.add(db_obj)
        db.commit()
        db.refresh(db_obj)
        return db_obj

    def update_status(
        self,
        db: Session,
        *,
        item: ZoteroImportedItem,
        status: str,
        error_message: Optional[str] = None,
        paper_id: Optional[UUID] = None,
    ) -> ZoteroImportedItem:
        item.status = status
        if error_message is not None:
            item.error_message = error_message
        if paper_id is not None:
            item.paper_id = paper_id
        db.add(item)
        db.commit()
        db.refresh(item)
        return item

    def list_syncable_by_user(
        self, db: Session, *, user_id: UUID, limit: int
    ) -> List[ZoteroImportedItem]:
        return (
            db.query(ZoteroImportedItem)
            .join(Paper, ZoteroImportedItem.paper_id == Paper.id)
            .filter(
                ZoteroImportedItem.user_id == user_id,
                ZoteroImportedItem.status == ZoteroImportStatus.COMPLETED,
                ZoteroImportedItem.paper_id.isnot(None),
                ZoteroImportedItem.import_source == ZoteroImportSource.PDF_ATTACHMENT,
                ZoteroImportedItem.zotero_attachment_key.isnot(None),
            )
            .order_by(
                ZoteroImportedItem.last_synced_at.asc().nullsfirst(),
                ZoteroImportedItem.created_at.desc(),
            )
            .limit(limit)
            .all()
        )

    def list_user_ids_due_for_sync(
        self, db: Session, *, threshold_hours: int = 24
    ) -> List[UUID]:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=threshold_hours)
        rows = (
            db.query(ZoteroImportedItem.user_id)
            .filter(
                ZoteroImportedItem.status == ZoteroImportStatus.COMPLETED,
                ZoteroImportedItem.import_source == ZoteroImportSource.PDF_ATTACHMENT,
                ZoteroImportedItem.zotero_attachment_key.isnot(None),
                or_(
                    ZoteroImportedItem.last_synced_at.is_(None),
                    ZoteroImportedItem.last_synced_at < cutoff,
                ),
            )
            .distinct()
            .all()
        )
        return [row.user_id for row in rows]

    def update_after_sync(
        self,
        db: Session,
        *,
        item: ZoteroImportedItem,
        annotations_payload: Optional[list],
        last_synced_at: datetime,
    ) -> ZoteroImportedItem:
        item.annotations_payload = annotations_payload
        item.last_synced_at = last_synced_at
        db.add(item)
        db.commit()
        db.refresh(item)
        return item


zotero_import_crud = CRUDZoteroImport()
