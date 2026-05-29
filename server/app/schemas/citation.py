from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

CitationMethod = Literal[
    "cached",  # all required fields already present
    "deterministic",  # filled via CrossRef/OpenAlex hydration
    "agentic",  # filled via web search/fetch
    "partial",  # attempted but some required fields still missing
    "not_found",  # paper not found / inaccessible
]

StepKind = Literal[
    "check",
    "deterministic",
    "thinking",
    "web_search",
    "web_fetch",
    "submit",
    "write_back",
    "resolve",
]


class CitationStep(BaseModel):
    """A single step in the citation-finding trajectory, for a user-facing trace."""

    kind: StepKind
    detail: str
    data: Optional[dict[str, Any]] = None


class CitationData(BaseModel):
    """Structured, populated citation metadata. The client renders this into a
    citation string in the user's chosen style — the server does not format it."""

    paper_id: str
    title: Optional[str] = None
    authors: list[str] = Field(default_factory=list)
    publish_date: Optional[str] = None
    journal: Optional[str] = None
    publisher: Optional[str] = None
    doi: Optional[str] = None


class CitationResult(BaseModel):
    paper_id: str
    preferred_style: str  # canonical key (e.g. "APA")
    style_display: str  # human-readable (e.g. "APA 7th Edition")
    data: CitationData
    method: CitationMethod
    missing_fields: list[str] = Field(default_factory=list)
    filled_fields: dict[str, Any] = Field(default_factory=dict)
    confidence: Optional[float] = None
    steps: list[CitationStep] = Field(default_factory=list)
