"""Citation metadata helpers (server side).

The server does NOT render citation strings — the client owns the citation
templates (client/src/components/utils/paperUtils.ts) and renders an interactive
card from structured data. This module only provides what the metadata-hydration
agent needs: style normalization and a per-style "what's still missing" check
that decides whether we need to go look up more metadata.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

# Canonical style keys (mirror the client's supported styles).
MLA = "MLA"
HARVARD = "HARVARD"
AAA = "AAA"
IEEE = "IEEE"
AMA = "AMA"
CHICAGO = "CHICAGO"
APA = "APA"
BIBTEX = "BIBTEX"

CITATION_STYLES = [MLA, HARVARD, AAA, IEEE, AMA, CHICAGO, APA, BIBTEX]

# Display names matching the client's citationStyles list.
STYLE_DISPLAY_NAMES = {
    MLA: "MLA 9th Edition",
    HARVARD: "Harvard",
    AAA: "AAA",
    IEEE: "IEEE",
    AMA: "AMA 11th Edition",
    CHICAGO: "Chicago 17th (Author-Date)",
    APA: "APA 7th Edition",
    BIBTEX: "BibTeX",
}


def normalize_style(value: Optional[str]) -> str:
    """Map a free-form style string (e.g. "APA 7th edition") to a canonical key.

    Defaults to APA when the input is empty or unrecognized.
    """
    if not value:
        return APA
    v = value.strip().lower()
    # Order matters: check the more specific tokens first.
    if "bibtex" in v or "bib tex" in v:
        return BIBTEX
    if "mla" in v:
        return MLA
    if "harvard" in v:
        return HARVARD
    if "aaa" in v or "anthropological" in v:
        return AAA
    if "ieee" in v:
        return IEEE
    if "ama" in v:
        return AMA
    if "chicago" in v or "turabian" in v:
        return CHICAGO
    if "apa" in v:
        return APA
    return APA


@dataclass
class CitationFields:
    """The subset of paper metadata needed to render a citation."""

    title: Optional[str] = None
    authors: list[str] = field(default_factory=list)
    publish_date: Optional[str] = None  # ISO date string; year is extracted from it
    journal: Optional[str] = None
    publisher: Optional[str] = None
    doi: Optional[str] = None


def fields_from_paper(paper: object) -> CitationFields:
    """Build CitationFields from a Paper ORM row (or any object with those attrs)."""
    publish_date = getattr(paper, "publish_date", None)
    if publish_date is not None and not isinstance(publish_date, str):
        # SQLAlchemy may hand back a datetime/date.
        publish_date = publish_date.isoformat()
    authors = getattr(paper, "authors", None) or []
    return CitationFields(
        title=getattr(paper, "title", None),
        authors=list(authors),
        publish_date=publish_date,
        journal=getattr(paper, "journal", None),
        publisher=getattr(paper, "publisher", None),
        doi=getattr(paper, "doi", None),
    )


def has_year(publish_date: Optional[str]) -> bool:
    """Whether a 4-digit year can be extracted from the date string."""
    if not publish_date:
        return False
    head = publish_date.strip()[:4]
    return len(head) == 4 and head.isdigit()


def missing_required_fields(fields: CitationFields, style: str) -> list[str]:
    """Return the labels of citation-critical fields still missing for this style.

    Used to decide whether find_citation should attempt metadata recovery. A
    missing field here means the rendered citation would contain a placeholder
    or an "n.d." year. Authors and DOI are omitted gracefully by the templates,
    so they are not treated as blocking here.
    """
    style = normalize_style(style)
    missing: list[str] = []

    if not has_year(fields.publish_date):
        missing.append("publish_date")

    if style == BIBTEX:
        # BibTeX renders cleanly without a journal; only the year matters above.
        return missing

    if style == AMA:
        if not fields.journal:
            missing.append("journal")
    else:
        if not (fields.journal or fields.publisher):
            missing.append("source")  # journal or publisher

    return missing
