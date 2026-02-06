"""OpenAlex API integration for research paper discovery."""

import logging
from dataclasses import dataclass, field
from typing import Optional

from app.helpers.paper_search import OpenAlexFilter, search_open_alex

logger = logging.getLogger(__name__)


@dataclass
class OpenAlexResult:
    title: str
    url: str
    authors: list[str] = field(default_factory=list)
    published_date: Optional[str] = None
    text: Optional[str] = None  # Abstract
    highlights: list[str] = field(default_factory=list)
    highlight_scores: list[float] = field(default_factory=list)
    favicon: Optional[str] = None
    cited_by_count: Optional[int] = None
    source: Optional[str] = None  # Publication venue/journal
    institutions: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "title": self.title,
            "url": self.url,
            "authors": self.authors,
            "published_date": self.published_date,
            "text": self.text,
            "highlights": self.highlights,
            "highlight_scores": self.highlight_scores,
            "favicon": self.favicon,
            "cited_by_count": self.cited_by_count,
            "source": self.source,
            "institutions": self.institutions,
        }


def search_openalex(
    query: str,
    num_results: int = 10,
    sort: Optional[str] = None,
    only_open_access: bool = False,
) -> list[OpenAlexResult]:
    """Search OpenAlex for research papers matching the query.

    Args:
        query: Search query string
        num_results: Maximum number of results to return
        sort: Optional sort parameter (e.g., "cited_by_count:desc" or "publication_date:desc")
        only_open_access: If True, only return open access papers
    """
    try:
        filter_obj = (
            OpenAlexFilter(only_oa=only_open_access) if only_open_access else None
        )
        response = search_open_alex(query, filter=filter_obj, sort=sort)

        results = []
        for work in response.results[:num_results]:
            # Skip results without a proper title
            if not work.title or not work.title.strip():
                continue

            # Extract all author names and institutions
            authors: list[str] = []
            institutions_set: set[str] = set()
            if work.authorships:
                for authorship in work.authorships:
                    if authorship.author and authorship.author.display_name:
                        authors.append(authorship.author.display_name)
                    if authorship.institutions:
                        for inst in authorship.institutions:
                            if inst.display_name:
                                institutions_set.add(inst.display_name)

            # Extract publication source (journal/venue)
            source = None
            if work.primary_location and work.primary_location.source:
                source = work.primary_location.source.display_name

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
                    authors=authors,
                    published_date=work.publication_date,
                    text=work.abstract,
                    highlights=[],
                    highlight_scores=[],
                    favicon=None,
                    cited_by_count=work.cited_by_count,
                    source=source,
                    institutions=list(institutions_set),
                )
            )

        return results
    except Exception as e:
        logger.error(f"OpenAlex search failed for query '{query}': {e}")
        raise
