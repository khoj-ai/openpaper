from typing import List
from uuid import UUID

from pydantic import BaseModel


class BulkTagRequest(BaseModel):
    paper_ids: List[UUID]
    tag_ids: List[UUID]
