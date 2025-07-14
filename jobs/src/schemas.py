"""
Pydantic schemas for PDF processing.
"""
from enum import Enum
from typing import List, Optional
from pydantic import BaseModel, Field

class PDFImage(BaseModel):
    """
    Schema for an image extracted from a PDF.
    """
    page_number: int = Field(description="Page number where the image was found (1-indexed)")
    image_index: int = Field(description="Index of the image on the page")
    s3_object_key: str = Field(description="S3 object key for the extracted image")
    image_url: str = Field(description="Public URL to access the image")
    width: int = Field(description="Width of the image in pixels")
    height: int = Field(description="Height of the image in pixels")
    format: str = Field(description="Image format (e.g., 'PNG', 'JPEG')")
    size_bytes: int = Field(description="Size of the image in bytes")
    caption: Optional[str] = Field(default=None, description="Extracted caption or subtitle for the image")
    placeholder_id: Optional[str] = Field(default=None, description="Placeholder ID for the image in the PDF, if applicable")


class ResponseCitation(BaseModel):
    """
    Schema for a citation in the paper.
    This is used to represent a single citation with its text and context.
    """

    text: str = Field(
        description="The raw text of the citation as it appears in the paper. Ensure that this is a direct quote or paraphrase from the paper."
    )
    index: int = Field(
        description="The index of the citation in the paper's reference list. This is used to identify the citation in discussions or findings."
    )


class HighlightType(str, Enum):
    TOPIC = "topic"
    MOTIVATION = "motivation"
    METHOD = "method"
    EVIDENCE = "evidence"
    RESULT = "result"
    IMPACT = "impact"

class AIHighlight(BaseModel):
    """
    Schema for a highlight in the paper.
    This is used to represent a single highlight with its text and context.
    """

    text: str = Field(
        description="The raw text of the highlight as it appears in the paper. Ensure that this is a direct quote or paraphrase from the paper."
    )
    annotation: str = Field(
        description="The context or annotation for the highlight, explaining its significance or relevance to the paper's content. Less than 350 characters."
    )

    type: HighlightType = Field(
        description="The type of highlight. This can be one of the following: topic, motivation, method, evidence, result, impact. This helps categorize the highlight based on its content and significance."
    )


class TitleAuthorsAbstract(BaseModel):
    """Schema for title, authors, and abstract extraction."""
    title: str = Field(description="Title of the paper in normal case")
    authors: List[str] = Field(default=[], description="List of authors")
    abstract: str = Field(default="", description="Abstract of the paper")
    publish_date: Optional[str] = Field(
        default="", description="Publishing date of the paper in YYYY-MM-DD format"
    )


class InstitutionsKeywords(BaseModel):
    """Schema for institutions and keywords extraction."""
    institutions: List[str] = Field(
        default=[], description="List of institutions involved in the publication."
    )
    keywords: List[str] = Field(default=[], description="List of keywords")


# Extracted images are referenced here! Refer to parser.py to see how place holder IDs are generated and inserted. This logic is super convoluted unfortunately, but the best workaround for image understanding in the PDF + LLM flow.
class SummaryAndCitations(BaseModel):
    """Schema for summary and citations extraction."""
    summary: str = Field(
        description="""
A concise, well-structured summary of the paper in markdown format. Include:
1. Key findings and contributions
2. Research methodology
3. Results and implications
4. Potential applications or impact

Format guidelines:
- Optional opening title (under 10 words)
- First paragraph: 2-4 sentence overview of the paper
- Use clear headings, bullet points, and tables for organization
- Include relevant data points and metrics when available
- Use plain language while preserving technical accuracy
- Include inline citations to support claims that refer to the paper's content. This is especially important for claims about the findings, methodology, and results.
- You may include images of figures if they are helpful to the summary. You may reference them in markdown image format inline using the placeholder IDs. Example: ![Figure 1](IMG_placeholder_1)

Citation guidelines:
- Use [^1], [^2], [^6, ^7] etc. for citations in the summary
- Always increase the index of the citation sequentially, starting from 1
- You will separately provide a list of citations in the `summary_citations` field with the raw text and index

The summary should be accessible to readers with basic domain knowledge while maintaining scientific integrity.
                         """,
    )
    summary_citations: List[ResponseCitation] = Field(
        description="List of citations that are relevant to the summary. These should be direct quotes or paraphrases from the paper that support the summary provided. Remember to include the citation index (e.g., [^1], [^2]) in the summary.",
    )


class StarterQuestions(BaseModel):
    """Schema for starter questions extraction."""
    starter_questions: List[str] = Field(
        default=[],
        description="""
        List of starter questions for discussion.
        These should be open-ended questions that can guide further exploration of the paper's content and implications.
        They should help elicit a better understanding of the paper's findings, methodology, and potential applications.
        """,
    )


class Highlights(BaseModel):
    """Schema for highlights extraction."""
    highlights: List[AIHighlight] = Field(
        default=[],
        description="List of key highlights from the paper. These should be significant quotes that are must-reads of the paper's findings and contributions. Each highlight should include the text of the highlight and an annotation explaining its significance or relevance to the paper's content. Particularly drill into interesting, novel findings, methodologies, or implications that are worth noting. Pay special attention to tables, figures, and diagrams that may contain important information.",
    )


class PaperMetadataExtraction(BaseModel):
    """Extracted metadata from a paper"""
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
- Optional opening title (under 10 words)
- First paragraph: 2-4 sentence overview of the paper
- Use clear headings, bullet points, and tables for organization
- Include relevant data points and metrics when available
- Use plain language while preserving technical accuracy
- Include inline citations to support claims that refer to the paper's content. This is especially important for claims about the findings, methodology, and results.

Citation guidelines:
- Use [^1], [^2], [^6, ^7] etc. for citations in the summary
- Always increase the index of the citation sequentially, starting from 1
- You will separately provide a list of citations in the `summary_citations` field with the raw text and index

The summary should be accessible to readers with basic domain knowledge while maintaining scientific integrity.
                         """,
    )
    summary_citations: List[ResponseCitation] = Field(
        default=[],
        description="List of citations that are relevant to the summary. These should be direct quotes or paraphrases from the paper that support the summary provided. Remember to include the citation index (e.g., [^1], [^2]) in the summary.",
    )
    publish_date: Optional[str] = Field(
        default=None, description="Publishing date of the paper in YYYY-MM-DD format"
    )
    starter_questions: List[str] = Field(
        default=[],
        description="""
        List of starter questions for discussion.
        These should be open-ended questions that can guide further exploration of the paper's content and implications.
        They should help elicit a better understanding of the paper's findings, methodology, and potential applications.
        """,
    )
    highlights: List[AIHighlight] = Field(
        default=[],
        description="List of key highlights from the paper. These should be significant quotes that are must-reads of the paper's findings and contributions. Each highlight should include the text of the highlight and an annotation explaining its significance or relevance to the paper's content. Particularly drill into interesting, novel findings, methodologies, or implications that are worth noting. Pay special attention to tables, figures, and diagrams that may contain important information.",
    )


class PDFProcessingResult(BaseModel):
    """Result of PDF processing"""
    success: bool
    job_id: str
    raw_content: Optional[str] = None
    page_offset_map: Optional[dict[int, list[int]]] = None
    metadata: Optional[PaperMetadataExtraction] = None
    s3_object_key: Optional[str] = None
    file_url: Optional[str] = None
    preview_url: Optional[str] = None
    preview_object_key: Optional[str] = None
    extracted_images: Optional[List[PDFImage]] = Field(default=None, description="List of images extracted from the PDF")
    error: Optional[str] = None
    duration: Optional[float] = None  # Duration in seconds
