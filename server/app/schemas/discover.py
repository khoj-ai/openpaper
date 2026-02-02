"""Schemas for the Discover feature."""

from pydantic import BaseModel


class DiscoverSearchRequest(BaseModel):
    question: str
