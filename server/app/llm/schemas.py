from typing import List, Optional

from pydantic import BaseModel, Field


class PaperMetadataExtraction(BaseModel):
    title: str = Field(default="", description="Title of the paper")
    authors: List[str] = Field(default=[], description="List of authors")
    abstract: str = Field(default="", description="Abstract of the paper")
    institutions: List[str] = Field(default=[], description="List of institutions")
    keywords: List[str] = Field(default=[], description="List of keywords")
    summary: str = Field(..., description="Summary of the paper")
    publish_date: Optional[str] = Field(
        default=None, description="Publishing date of the paper"
    )
    starter_questions: List[str] = Field(
        default=[], description="List of starter questions"
    )
