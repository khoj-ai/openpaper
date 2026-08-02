"""OpenAlex API integration for research paper discovery."""

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Optional
from urllib.parse import urlencode

from app.helpers.paper_search import (
    OpenAlexFilter,
    _request_with_retry,
    _with_openalex_auth,
    search_open_alex,
)

logger = logging.getLogger(__name__)

# OpenAlex accepts up to 50 values in an OR filter; leave headroom under that.
OPENALEX_DOI_BATCH_SIZE = 40

# This lookup only enriches results that are already displayable, and it sits in
# the middle of a streaming response, so it must fail fast rather than retry.
# The shared defaults (3 attempts, 10s each) could stall a chunk for ~30s; these
# cap the worst case near the p99 of a healthy call, which measures under 0.7s.
OPENALEX_HYDRATION_TIMEOUT = 5
OPENALEX_HYDRATION_ATTEMPTS = 1


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


@dataclass
class OpenAlexWorkMetadata:
    """The subset of an OpenAlex work used to fill gaps in another source's results."""

    source: Optional[str] = None
    cited_by_count: Optional[int] = None
    institutions: list[str] = field(default_factory=list)


def normalize_openalex_doi(doi: Optional[str]) -> Optional[str]:
    """Reduce a DOI to the bare, lowercased form OpenAlex filters on."""
    if not doi:
        return None
    cleaned = doi.strip().lower()
    for prefix in ("https://doi.org/", "http://doi.org/", "doi:"):
        if cleaned.startswith(prefix):
            cleaned = cleaned[len(prefix) :]
    return cleaned or None


def fetch_metadata_by_doi(dois: list[str]) -> dict[str, OpenAlexWorkMetadata]:
    """Look up works by DOI, batched into as few requests as possible.

    Returns a mapping keyed by normalized DOI, omitting anything OpenAlex has no
    record of. Never raises: this enriches results that are already displayable,
    so a failed lookup degrades to missing metadata rather than a failed search.
    """
    unique_dois = sorted({d for d in (normalize_openalex_doi(x) for x in dois) if d})
    if not unique_dois:
        return {}

    metadata: dict[str, OpenAlexWorkMetadata] = {}

    for start in range(0, len(unique_dois), OPENALEX_DOI_BATCH_SIZE):
        batch = unique_dois[start : start + OPENALEX_DOI_BATCH_SIZE]
        params = urlencode(
            {
                "filter": f"doi:{'|'.join(batch)}",
                "per-page": OPENALEX_DOI_BATCH_SIZE + 10,
                "select": "doi,primary_location,cited_by_count,authorships",
            }
        )
        url = _with_openalex_auth(f"https://api.openalex.org/works?{params}")

        try:
            response = _request_with_retry(
                url,
                max_retries=OPENALEX_HYDRATION_ATTEMPTS,
                timeout=OPENALEX_HYDRATION_TIMEOUT,
            )
            works = response.json().get("results", [])
        except Exception as e:
            logger.warning(
                f"OpenAlex DOI lookup failed for {len(batch)} DOIs: {e}. "
                "Continuing without the enriched metadata."
            )
            continue

        for work in works:
            doi = normalize_openalex_doi(work.get("doi"))
            if not doi:
                continue

            primary_location = work.get("primary_location") or {}
            work_source = primary_location.get("source") or {}

            institutions: set[str] = set()
            for authorship in work.get("authorships") or []:
                for institution in authorship.get("institutions") or []:
                    name = institution.get("display_name")
                    if name:
                        institutions.add(name)

            metadata[doi] = OpenAlexWorkMetadata(
                source=work_source.get("display_name"),
                cited_by_count=work.get("cited_by_count"),
                institutions=sorted(institutions),
            )

    return metadata


def search_openalex(
    query: str,
    num_results: int = 10,
    sort: Optional[str] = None,
    only_open_access: bool = False,
    year_filter: Optional[str] = None,
) -> list[OpenAlexResult]:
    """Search OpenAlex for research papers matching the query.

    Args:
        query: Search query string
        num_results: Maximum number of results to return
        sort: Optional sort parameter (e.g., "cited_by_count:desc" or "publication_date:desc")
        only_open_access: If True, only return open access papers
        year_filter: Optional time filter ("last_year", "last_5_years", or None for all time)
    """
    try:
        # Calculate from_publication_date based on year_filter
        from_date = None
        if year_filter == "last_year":
            from_date = (datetime.now() - timedelta(days=365)).strftime("%Y-%m-%d")
        elif year_filter == "last_5_years":
            from_date = (datetime.now() - timedelta(days=5 * 365)).strftime("%Y-%m-%d")

        # Build filter object if we have any filters
        filter_obj = None
        if only_open_access or from_date:
            filter_obj = OpenAlexFilter(
                only_oa=only_open_access,
                from_publication_date=from_date,
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
