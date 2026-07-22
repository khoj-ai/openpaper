from dataclasses import dataclass
from typing import Any, Dict, List, Literal, Optional

from app.database.models import HighlightType
from pydantic import BaseModel, Field


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
    paper_id: Optional[str] = Field(
        default=None,
        description="The unique identifier of the paper from which this citation is drawn. This helps to contextualize the citation within the broader multi-paper analysis. This is required when there are multiple papers being analyzed.",
    )


class AudioOverviewForLLM(BaseModel):
    summary: str = Field(
        description="The helpful summary of the research. This should include key findings, contributions, and implications of the paper. Include inline citations, which are to be documented separately in the citations field, which directly back up your claims. The format should include the citation index (e.g., [^1], [^2]) in the summary."
    )
    citations: List[ResponseCitation] = Field(
        default=[],
        description="List of the raw text citations from the paper that are relevant to the summary. These should be direct quotes or paraphrases from the paper(s) that support the summary provided. These should not be extracted references from the references of the paper. Rather, they are references from the raw documents relevant to your summary.",
    )
    title: str = Field(description="The title of the narrative overview.")


class PaperMetadataExtraction(BaseModel):
    title: str = Field(description="Title of the paper in normal case")
    authors: List[str] = Field(default=[], description="List of authors")
    abstract: str = Field(default="", description="Abstract of the paper")
    institutions: List[str] = Field(
        default=[], description="List of institutions involved in the publication."
    )
    keywords: List[str] = Field(
        default=[],
        description=(
            "3-8 concise topical keywords in normal case (not Title Case or ALL "
            "CAPS); capitalize only proper nouns and acronyms."
        ),
    )
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
    highlights: List[AIHighlight] = Field(
        default=[],
        description="List of key highlights from the paper. These should be significant quotes that are must-reads of the paper's findings and contributions. Each highlight should include the text of the highlight and an annotation explaining its significance or relevance to the paper's content. Particularly drill into interesting, novel findings, methodologies, or implications that are worth noting. Pay special attention to tables, figures, and diagrams that may contain important information.",
    )


################################
# Data-table related Schemas   #
################################


class DocumentMapping(BaseModel):
    title: str
    s3_object_key: str
    id: str


class DerivedColumnSpec(BaseModel):
    """A column computed by the calculator from other (primitive) columns,
    never by the extraction model. Mirrors jobs/src/schemas.py."""

    label: str = Field(description="Display label of the derived column")
    expression: str = Field(
        description="Arithmetic expression over input aliases, e.g. 'cohens_d(mean_t, sd_t, n_t, mean_c, sd_c, n_c)'"
    )
    inputs: dict[str, str] = Field(
        description="Mapping of expression alias -> primitive column label"
    )


class DataTableSchema(BaseModel):
    """Extraction payload sent to the jobs service — primitive columns only;
    derived columns never travel to the worker."""

    columns: List[str] = Field(description="List of column names in the data table.")
    papers: List[DocumentMapping] = Field(
        description="List of papers included in the data table."
    )
    list_columns: List[str] = Field(
        default=[],
        description="Subset of columns whose value is a per-paper collection (one entry per instance found) rather than a single scalar.",
    )


class CellEntry(BaseModel):
    """One element of a list-valued cell, individually cited."""

    value: str
    citations: List[ResponseCitation] = []


class DerivationInput(BaseModel):
    """One input to a derived cell, carrying the citations of the primitive it came from."""

    alias: str
    column: str
    value: str
    citations: List[ResponseCitation] = []


class CellDerivation(BaseModel):
    """The shown work for a calculator-computed cell."""

    expression: str
    inputs: List[DerivationInput] = []
    warnings: List[str] = []


class DataTableCellValue(BaseModel):
    """Value for a single cell in the data table with supporting citations."""

    value: str = Field(description="The extracted value for this column")
    citations: List[ResponseCitation] = Field(
        default=[],
        description="List of citations that support this specific value. These should be direct quotes or paraphrases from the paper.",
    )
    derivation: Optional[CellDerivation] = Field(
        default=None,
        description="Present only on calculator-computed cells.",
    )
    entries: Optional[List[CellEntry]] = Field(
        default=None,
        description="Present only on list-valued cells: the individual elements, each with its own citations. `value` holds their joined display form.",
    )


class DataTableRow(BaseModel):
    """A row in the data table representing extracted values for a single paper."""

    paper_id: str = Field(description="The ID of the paper this row corresponds to")
    values: dict[str, DataTableCellValue] = Field(
        description="Mapping of column name to cell value with citations"
    )


class DataTableResult(BaseModel):
    """Result of a data table extraction job."""

    success: bool = Field(description="Whether the extraction was successful")
    columns: List[str] = Field(description="List of column names in the data table.")
    rows: List[DataTableRow] = Field(default=[], description="Row data per paper")
    row_failures: List[str] = Field(
        default=[], description="List of paper IDs that failed extraction"
    )


# -----------------
# LLM Base Schemas
# -----------------


class ToolCall(BaseModel):
    """Standardized tool call format"""

    id: Optional[str] = Field(
        default=None,
        description="Unique identifier for the tool call. Returned by OpenAI, generated for Gemini.",
    )
    name: str
    args: Dict[str, Any]


class ToolCallResult(BaseModel):
    """Standardized tool call result format for passing back to LLM providers"""

    id: Optional[str] = Field(
        default=None,
        description="Unique identifier for the tool call. Required for OpenAI, optional for Gemini.",
    )
    name: str = Field(description="The name of the tool/function that was called")
    args: Dict[str, Any] = Field(
        default_factory=dict,
        description="The arguments that were passed to the tool/function call.",
    )
    result: Any = Field(
        description="The result returned by the tool. Will be serialized to string for the API."
    )


class TextContent(BaseModel):
    text: str
    type: Literal["text"] = "text"


class FileContent(BaseModel):
    data: bytes
    mime_type: str
    filename: Optional[str] = None
    type: Literal["file"] = "file"
    # Plain-text equivalent of the file, used by providers that don't accept
    # native file blocks (e.g. Cerebras via OpenAI-compat). When set, the
    # provider substitutes this text in place of doing runtime extraction.
    text_fallback: Optional[str] = None


class SupplementaryContent(BaseModel):
    """Content representing supplementary/collected information for the model to use.

    This is used to separate retrieved context (e.g., evidence from papers) from
    the user's actual question, making the provenance of information clearer.
    """

    content: str
    label: str = "collected_evidence"
    type: Literal["supplementary"] = "supplementary"
