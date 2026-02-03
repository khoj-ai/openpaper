"""Exa API integration for research paper discovery."""

import logging
import os
from dataclasses import dataclass, field
from typing import Optional

from exa_py import Exa

logger = logging.getLogger(__name__)

EXA_API_KEY = os.getenv("EXA_API_KEY")


@dataclass
class ExaResult:
    title: str
    url: str
    author: Optional[str] = None
    published_date: Optional[str] = None
    text: Optional[str] = None
    highlights: list[str] = field(default_factory=list)
    highlight_scores: list[float] = field(default_factory=list)
    favicon: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "title": self.title,
            "url": self.url,
            "author": self.author,
            "published_date": self.published_date,
            "text": self.text,
            "highlights": self.highlights,
            "highlight_scores": self.highlight_scores,
            "favicon": self.favicon,
        }


# Academic domains to prioritize for research paper searches
ACADEMIC_DOMAINS = [
    # Preprint servers & repositories
    "arxiv.org",
    "biorxiv.org",
    "medrxiv.org",
    "ssrn.com",
    "osf.io",  # Open Science Framework
    "zenodo.org",
    "researchgate.net",
    # Academic databases & indexes
    "pubmed.ncbi.nlm.nih.gov",
    "ncbi.nlm.nih.gov",
    "semanticscholar.org",
    "eric.ed.gov",  # Education research
    "jstor.org",
    "scholar.google.com",
    # Major publishers (multi-disciplinary)
    "nature.com",
    "sciencedirect.com",
    "springer.com",
    "link.springer.com",
    "wiley.com",
    "onlinelibrary.wiley.com",
    "sagepub.com",  # Social sciences, education, policy
    "tandfonline.com",  # Taylor & Francis - broad coverage
    "oup.com",  # Oxford University Press
    "academic.oup.com",
    "cambridge.org",
    # Open access publishers
    "plos.org",
    "frontiersin.org",
    "mdpi.com",
    "biomedcentral.com",
    "peerj.com",
    "elifesciences.org",
    "hindawi.com",
    # High-impact journals
    "science.org",
    "cell.com",
    "pnas.org",
    "thelancet.com",
    "bmj.com",
    "nejm.org",
    "jamanetwork.com",
    # Economics & policy
    "nber.org",  # National Bureau of Economic Research
    "aeaweb.org",  # American Economic Association
    "worldbank.org",
    "imf.org",
    "brookings.edu",
    "rand.org",
    # Education
    "educationnext.org",
    "edweek.org",
    "tcrecord.org",  # Teachers College Record
    # Social sciences & humanities
    "journals.uchicago.edu",
    "annualreviews.org",
    "mitpress.mit.edu",
    "press.princeton.edu",
    # CS/ML (limited selection)
    "ieee.org",
    "acm.org",
    "openreview.net",
    "jmlr.org",
    "aclweb.org",
]


def search_exa(query: str, num_results: int = 10) -> list[ExaResult]:
    """Search Exa for research papers matching the query."""
    if not EXA_API_KEY:
        raise ValueError("EXA_API_KEY environment variable is not set")

    exa = Exa(api_key=EXA_API_KEY)

    try:
        response = exa.search_and_contents(
            query=query,
            num_results=num_results,
            type="neural",
            category="research paper",
            include_domains=ACADEMIC_DOMAINS,
            text={"max_characters": 500},
            highlights={"num_sentences": 3},
        )

        results = []
        for result in response.results:
            # Skip results without a proper title
            if not result.title or not result.title.strip():
                continue

            results.append(
                ExaResult(
                    title=result.title.strip(),
                    url=result.url,
                    author=result.author,
                    published_date=result.published_date,
                    text=result.text,
                    highlights=result.highlights if result.highlights else [],
                    highlight_scores=(
                        result.highlight_scores
                        if hasattr(result, "highlight_scores")
                        and result.highlight_scores
                        else []
                    ),
                    favicon=getattr(result, "favicon", None),
                )
            )

        return results
    except Exception as e:
        logger.error(f"Exa search failed for query '{query}': {e}")
        raise
