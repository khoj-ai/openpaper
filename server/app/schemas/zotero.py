from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class ZoteroConnectResponse(BaseModel):
    auth_url: str


class ZoteroStatusResponse(BaseModel):
    connected: bool
    zotero_user_id: Optional[str] = None
    connected_at: Optional[datetime] = None


class ZoteroDisconnectResponse(BaseModel):
    success: bool
    message: str
