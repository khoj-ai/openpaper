from typing import List, Optional

from pydantic import BaseModel, Field


class PaperMetadataExtraction(BaseModel):
    title: str = Field(description="Title of the paper in normal case")
    authors: List[str] = Field(default=[], description="List of authors")
    abstract: str = Field(default="", description="Abstract of the paper")
    institutions: List[str] = Field(
        default=[], description="List of institutions involved in the publication."
    )
    keywords: List[str] = Field(default=[], description="List of keywords")
    summary: str = Field(
        default="",
        description="""
A concise, well-structured summary of the paper in markdown format. Include:
1. Key findings and contributions
2. Research methodology
3. Results and implications
4. Potential applications or impact

Format guidelines:
- First paragraph: 2-4 sentence overview of the paper
- Use clear headings, bullet points, and tables for organization
- Include relevant data points and metrics when available
- Use plain language while preserving technical accuracy
- Optional brief title (under 10 words)

The summary should be accessible to readers with basic domain knowledge while maintaining scientific integrity.
                         """,
    )
    publish_date: Optional[str] = Field(
        default=None, description="Publishing date of the paper in YYYY-MM-DD format"
    )
    starter_questions: List[str] = Field(
        default=[], description="List of starter questions for discussion."
    )
