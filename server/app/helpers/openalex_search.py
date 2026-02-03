"""OpenAlex API integration for research paper discovery."""

import logging
from dataclasses import dataclass, field
from typing import Optional

from app.helpers.paper_search import search_open_alex

logger = logging.getLogger(__name__)


@dataclass
class OpenAlexResult:
    title: str
    url: str
    author: Optional[str] = None
    published_date: Optional[str] = None
    text: Optional[str] = None  # Abstract
    highlights: list[str] = field(default_factory=list)
    highlight_scores: list[float] = field(default_factory=list)
    favicon: Optional[str] = None
    cited_by_count: Optional[int] = None

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
            "cited_by_count": self.cited_by_count,
        }


def search_openalex(query: str, num_results: int = 10) -> list[OpenAlexResult]:
    """Search OpenAlex for research papers matching the query."""
    try:
        response = search_open_alex(query)

        results = []
        for work in response.results[:num_results]:
            # Skip results without a proper title
            if not work.title or not work.title.strip():
                continue

            # Extract first author name
            author = None
            if work.authorships and len(work.authorships) > 0:
                first_author = work.authorships[0]
                if first_author.author and first_author.author.display_name:
                    author = first_author.author.display_name
                    if len(work.authorships) > 1:
                        author += " et al."

            # Get the best URL (prefer landing page, fall back to DOI)
            url = None
            if work.primary_location and work.primary_location.landing_page_url:
                url = work.primary_location.landing_page_url
            elif work.doi:
                url = (
                    work.doi
                    if work.doi.startswith("http")
                    else f"https://doi.org/{work.doi}"
                )
            else:
                # Use OpenAlex URL as fallback
                url = work.id

            if not url:
                continue

            results.append(
                OpenAlexResult(
                    title=work.title.strip(),
                    url=url,
                    author=author,
                    published_date=work.publication_date,
                    text=work.abstract,
                    highlights=[],
                    highlight_scores=[],
                    favicon=None,
                    cited_by_count=work.cited_by_count,
                )
            )

        return results
    except Exception as e:
        logger.error(f"OpenAlex search failed for query '{query}': {e}")
        raise
