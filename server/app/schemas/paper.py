from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel


class BulkTagRequest(BaseModel):
    paper_ids: List[UUID]
    tag_ids: List[UUID]


class EnrichedData(BaseModel):
    publisher: Optional[str]
    journal: Optional[str]
