"""Schemas for the Discover feature."""

from typing import Optional

from pydantic import BaseModel

# Available source filters for discover search
# "openalex" routes to OpenAlex backend, others filter Exa by domain
DISCOVER_SOURCES = {
    "openalex": {
        "label": "Academic Databases",
        "description": "OpenAlex scholarly index",
        "domains": None,  # Uses OpenAlex backend instead of Exa
    },
    "arxiv": {
        "label": "arXiv",
        "description": "Preprints in physics, math, CS, and more",
        "domains": ["arxiv.org"],
    },
    "pubmed": {
        "label": "PubMed",
        "description": "Biomedical and life sciences",
        "domains": ["pubmed.ncbi.nlm.nih.gov", "ncbi.nlm.nih.gov"],
    },
    "nature": {
        "label": "Nature",
        "description": "Nature family of journals",
        "domains": ["nature.com"],
    },
    "science": {
        "label": "Science",
        "description": "Science family of journals",
        "domains": ["science.org"],
    },
    "plos": {
        "label": "PLOS",
        "description": "Open access journals",
        "domains": ["plos.org"],
    },
    "biorxiv": {
        "label": "bioRxiv / medRxiv",
        "description": "Biology and medicine preprints",
        "domains": ["biorxiv.org", "medrxiv.org"],
    },
    "ssrn": {
        "label": "SSRN",
        "description": "Social sciences research",
        "domains": ["ssrn.com"],
    },
    "ieee": {
        "label": "IEEE",
        "description": "Engineering and technology",
        "domains": ["ieee.org", "ieeexplore.ieee.org"],
    },
    "acm": {
        "label": "ACM",
        "description": "Computing and information technology",
        "domains": ["acm.org", "dl.acm.org"],
    },
}


class DiscoverSearchRequest(BaseModel):
    question: str
    sources: Optional[list[str]] = None  # List of source keys from DISCOVER_SOURCES
    sort: Optional[str] = (
        None  # Sort option: "cited_by_count:desc" or "publication_date:desc"
    )
    only_open_access: bool = False  # Filter for open access papers (OpenAlex only)
