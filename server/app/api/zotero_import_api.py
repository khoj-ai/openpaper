import logging

from app.auth.dependencies import get_required_user
from app.database.crud.zotero_crud import zotero_crud
from app.database.crud.zotero_import_crud import zotero_import_crud
from app.database.database import get_db
from app.database.telemetry import track_event
from app.helpers.subscription_limits import (
    can_user_upload_paper,
    get_remaining_paper_upload_slots,
)
from app.schemas.user import CurrentUser
from app.schemas.zotero import (
    ZoteroImportAndSyncResponse,
    ZoteroImportError,
    ZoteroImportItemResult,
    ZoteroImportRequest,
    ZoteroImportResponse,
    ZoteroImportStatusItem,
    ZoteroImportStatusListResponse,
    ZoteroSyncItemResult,
    ZoteroSyncResponse,
)
from app.services.zotero_import import import_batch, sync_batch
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

zotero_router = APIRouter()


@zotero_router.post("/import", response_model=ZoteroImportResponse)
async def zotero_import(
    request: ZoteroImportRequest,
    current_user: CurrentUser = Depends(get_required_user),
    db: Session = Depends(get_db),
):
    """Import up to 50 journal articles, conference papers, and preprints from Zotero (PDF or URL fallback)."""
    connection = zotero_crud.get_by_user_id(db, user_id=current_user.id)
    if not connection:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Zotero account not connected",
        )

    can_upload, upload_err = can_user_upload_paper(db, current_user)
    if not can_upload:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=upload_err or "Upload limit reached",
        )

    effective_limit = min(request.limit, get_remaining_paper_upload_slots(db, current_user))
    try:
        result = await import_batch(db, user=current_user, limit=effective_limit)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e
    except Exception as e:
        logger.error("Zotero import failed: %s", e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to import from Zotero",
        ) from e

    if result["imported_count"] > 0:
        track_event(
            "zotero_import_batch",
            user_id=str(current_user.id),
            properties={"count": result["imported_count"]},
            db=db,
        )

    return ZoteroImportResponse(
        imported=[ZoteroImportItemResult(**item) for item in result["imported"]],
        imported_count=result["imported_count"],
        imported_via_url=result["imported_via_url"],
        skipped_already_imported=result["skipped_already_imported"],
        errors=[ZoteroImportError(**err) for err in result["errors"]],
    )


@zotero_router.post("/import-and-sync", response_model=ZoteroImportAndSyncResponse)
async def zotero_import_and_sync(
    request: ZoteroImportRequest,
    current_user: CurrentUser = Depends(get_required_user),
    db: Session = Depends(get_db),
):
    """Import new Zotero papers, then append-only sync of annotations on existing imports."""
    connection = zotero_crud.get_by_user_id(db, user_id=current_user.id)
    if not connection:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Zotero account not connected",
        )

    can_upload, upload_err = can_user_upload_paper(db, current_user)
    import_blocked_reason: str | None = None

    try:
        if can_upload:
            effective_limit = min(
                request.limit, get_remaining_paper_upload_slots(db, current_user)
            )
            import_result = await import_batch(
                db, user=current_user, limit=effective_limit
            )
        else:
            import_blocked_reason = upload_err
            import_result = {
                "imported": [],
                "imported_count": 0,
                "imported_via_url": 0,
                "skipped_already_imported": 0,
                "errors": [],
            }
        sync_result = await sync_batch(db, user=current_user, limit=request.limit)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e
    except Exception as e:
        logger.error("Zotero import-and-sync failed: %s", e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to import and sync from Zotero",
        ) from e

    if import_result["imported_count"] > 0:
        track_event(
            "zotero_import_batch",
            user_id=str(current_user.id),
            properties={"count": import_result["imported_count"]},
            db=db,
        )
    if sync_result["new_annotations_count"] > 0:
        track_event(
            "zotero_sync_batch",
            user_id=str(current_user.id),
            properties={
                "papers": sync_result["synced_papers_count"],
                "annotations": sync_result["new_annotations_count"],
            },
            db=db,
        )

    return ZoteroImportAndSyncResponse(
        imported=[
            ZoteroImportItemResult(**item) for item in import_result["imported"]
        ],
        imported_count=import_result["imported_count"],
        imported_via_url=import_result["imported_via_url"],
        skipped_already_imported=import_result["skipped_already_imported"],
        errors=[ZoteroImportError(**err) for err in import_result["errors"]],
        synced=[ZoteroSyncItemResult(**item) for item in sync_result["synced"]],
        synced_papers_count=sync_result["synced_papers_count"],
        new_annotations_count=sync_result["new_annotations_count"],
        sync_errors=[ZoteroImportError(**err) for err in sync_result["errors"]],
        import_blocked_reason=import_blocked_reason,
    )


@zotero_router.post("/sync", response_model=ZoteroSyncResponse)
async def zotero_sync(
    request: ZoteroImportRequest,
    current_user: CurrentUser = Depends(get_required_user),
    db: Session = Depends(get_db),
):
    """Sync new Zotero PDF highlights into already-imported papers (no new paper imports)."""
    connection = zotero_crud.get_by_user_id(db, user_id=current_user.id)
    if not connection:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Zotero account not connected",
        )

    try:
        sync_result = await sync_batch(db, user=current_user, limit=request.limit)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e
    except Exception as e:
        logger.error("Zotero sync failed: %s", e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to sync from Zotero",
        ) from e

    if sync_result["new_annotations_count"] > 0:
        track_event(
            "zotero_sync_batch",
            user_id=str(current_user.id),
            properties={
                "papers": sync_result["synced_papers_count"],
                "annotations": sync_result["new_annotations_count"],
            },
            db=db,
        )

    return ZoteroSyncResponse(
        synced=[ZoteroSyncItemResult(**item) for item in sync_result["synced"]],
        synced_papers_count=sync_result["synced_papers_count"],
        new_annotations_count=sync_result["new_annotations_count"],
        sync_errors=[ZoteroImportError(**err) for err in sync_result["errors"]],
    )


@zotero_router.get("/import/status", response_model=ZoteroImportStatusListResponse)
async def zotero_import_status_list(
    current_user: CurrentUser = Depends(get_required_user),
    db: Session = Depends(get_db),
):
    """List recent Zotero import records for the current user."""
    rows = zotero_import_crud.list_recent_by_user(db, user_id=current_user.id)
    items = [
        ZoteroImportStatusItem(
            zotero_item_key=row.zotero_item_key,
            paper_id=str(row.paper_id) if row.paper_id else None,
            upload_job_id=str(row.upload_job_id) if row.upload_job_id else None,
            import_source=row.import_source,
            status=row.status,
            title=title,
            error_message=row.error_message,
            created_at=row.created_at,
            last_synced_at=row.last_synced_at,
        )
        for row, title in rows
    ]
    return ZoteroImportStatusListResponse(items=items)
