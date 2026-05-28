from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class ZoteroConnectResponse(BaseModel):
    auth_url: str


class ZoteroStatusResponse(BaseModel):
    connected: bool
    zotero_user_id: Optional[str] = None
    connected_at: Optional[datetime] = None


class ZoteroDisconnectResponse(BaseModel):
    success: bool
    message: str


class ZoteroImportRequest(BaseModel):
    limit: int = Field(default=50, ge=1, le=50)


class ZoteroImportItemResult(BaseModel):
    zotero_item_key: str
    paper_id: Optional[str] = None
    upload_job_id: Optional[str] = None
    import_source: Optional[str] = None
    title: Optional[str] = None


class ZoteroImportError(BaseModel):
    zotero_item_key: str
    error: str


class ZoteroImportResponse(BaseModel):
    imported: List[ZoteroImportItemResult]
    imported_count: int
    imported_via_url: int
    skipped_already_imported: int
    errors: List[ZoteroImportError]


class ZoteroSyncItemResult(BaseModel):
    zotero_item_key: str
    paper_id: Optional[str] = None
    new_annotations_count: int = 0


class ZoteroSyncResponse(BaseModel):
    synced: List[ZoteroSyncItemResult]
    synced_papers_count: int
    new_annotations_count: int
    sync_errors: List[ZoteroImportError]


class ZoteroImportAndSyncResponse(ZoteroImportResponse):
    synced: List[ZoteroSyncItemResult]
    synced_papers_count: int
    new_annotations_count: int
    sync_errors: List[ZoteroImportError]
    import_blocked_reason: Optional[str] = None


class ZoteroImportStatusItem(BaseModel):
    zotero_item_key: str
    paper_id: Optional[str] = None
    upload_job_id: Optional[str] = None
    import_source: str
    status: str
    title: Optional[str] = None
    error_message: Optional[str] = None
    created_at: Optional[datetime] = None
    last_synced_at: Optional[datetime] = None


class ZoteroImportStatusListResponse(BaseModel):
    items: List[ZoteroImportStatusItem]
