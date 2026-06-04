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
    item_keys: List[str] = Field(..., min_length=1, max_length=50)


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


class ZoteroSyncResponse(BaseModel):
    synced_papers_count: int
    new_annotations_count: int


class ZoteroLibraryItem(BaseModel):
    zotero_item_key: str
    title: str
    authors: List[str]
    date: Optional[str] = None
    item_type: str
    venue: Optional[str] = None
    already_imported: bool


class ZoteroLibraryResponse(BaseModel):
    items: List[ZoteroLibraryItem]
    remaining_slots: int
