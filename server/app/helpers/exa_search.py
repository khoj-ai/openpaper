"""Exa API integration for research paper discovery."""

import logging
import os
import re
import time
from dataclasses import dataclass, field
from typing import Optional

import httpx
from exa_py import Exa

logger = logging.getLogger(__name__)

EXA_API_KEY = os.getenv("EXA_API_KEY")

# The publications index is reached over raw HTTP rather than through exa_py.
# Upgrading the SDK does not remove the need for this: its entity parser only
# builds company and person entities, so publication entities are dropped during
# parsing and every result arrives with `entities` set to None — losing the
# citation counts, abstracts, and structured authors this index exists to provide.
EXA_SEARCH_URL = "https://api.exa.ai/search"
EXA_REQUEST_TIMEOUT = 60.0

# Exa intermittently returns transient 5xx/429s ("Please try again later"); retry
# those a couple of times before giving up. exa_py raises a plain ValueError whose
# message embeds the HTTP status, and surfaces transport failures as httpx errors.
EXA_MAX_RETRIES = 2
EXA_RETRY_BASE_DELAY = 1.0
_RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}

SUMMARY_PROMPT = "You're reviewing academic literature. Describe the background and results in 2-3 sentences. The reader already knows this is a research paper, so skip meta-commentary and focus on the actual content and findings. Do not start with 'This paper' or similar phrases. Just summarize the key points."


def _is_retryable_exa_error(e: Exception) -> bool:
    """True if an Exa failure looks transient and worth retrying."""
    # A response we did receive is retryable only for the transient status codes;
    # checked before HTTPError since it is a subclass.
    if isinstance(e, httpx.HTTPStatusError):
        return e.response.status_code in _RETRYABLE_STATUS_CODES
    # Transport-level failures (timeouts, connection resets) are transient.
    if isinstance(e, httpx.HTTPError):
        return True
    # exa_py raises ValueError("Request failed with status code <N>: ...").
    match = re.search(r"status code (\d{3})", str(e))
    if match:
        return int(match.group(1)) in _RETRYABLE_STATUS_CODES
    return False


def _call_with_retries(operation, query: str):
    """Run an Exa call, retrying transient failures with exponential backoff."""
    for attempt in range(EXA_MAX_RETRIES + 1):
        try:
            return operation()
        except Exception as e:
            if attempt < EXA_MAX_RETRIES and _is_retryable_exa_error(e):
                delay = EXA_RETRY_BASE_DELAY * (2**attempt)
                logger.warning(
                    f"Exa search transient error (attempt {attempt + 1}/{EXA_MAX_RETRIES + 1}) "
                    f"for query '{query}': {e}. Retrying in {delay:.1f}s"
                )
                time.sleep(delay)
                continue
            logger.error(f"Exa search failed for query '{query}': {e}")
            raise

    # Unreachable: the loop either returns or raises on the final attempt.
    raise RuntimeError("Exa search retry loop exited unexpectedly")


@dataclass
class ExaResult:
    title: str
    url: str
    authors: list[str] = field(default_factory=list)
    published_date: Optional[str] = None
    text: Optional[str] = None
    highlights: list[str] = field(default_factory=list)
    highlight_scores: list[float] = field(default_factory=list)
    favicon: Optional[str] = None
    summary: Optional[str] = None
    cited_by_count: Optional[int] = None

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
            "summary": self.summary,
            "cited_by_count": self.cited_by_count,
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


def _search_web_index(
    query: str,
    num_results: int,
    domains: Optional[list[str]],
    start_published_date: Optional[str],
) -> list[ExaResult]:
    """Search Exa's general web index, scoped to known academic domains."""
    exa = Exa(api_key=EXA_API_KEY)

    search_params = {
        "query": query,
        "num_results": num_results,
        "type": "auto",
        "category": "research paper",
        "text": {"max_characters": 500},
        "highlights": {"num_sentences": 3},
        "summary": {"query": SUMMARY_PROMPT},
        "include_domains": domains or ACADEMIC_DOMAINS,
    }

    if start_published_date:
        search_params["start_published_date"] = start_published_date

    response = _call_with_retries(
        lambda: exa.search_and_contents(**search_params), query
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
                authors=[result.author] if result.author else [],
                published_date=result.published_date,
                text=result.text,
                highlights=result.highlights if result.highlights else [],
                highlight_scores=(
                    result.highlight_scores
                    if hasattr(result, "highlight_scores") and result.highlight_scores
                    else []
                ),
                favicon=getattr(result, "favicon", None),
                summary=getattr(result, "summary", None),
            )
        )

    return results


def _publication_authors(properties: dict) -> list[str]:
    """Pull author names out of a publication entity's structured author list."""
    names = []
    for author in properties.get("authors") or []:
        name = author.get("name") if isinstance(author, dict) else author
        if name:
            names.append(str(name))
    return names


def _parse_publication_result(raw: dict) -> Optional[ExaResult]:
    """Map one publication-index result, or None if it has no usable title."""
    title = (raw.get("title") or "").strip()
    if not title:
        return None

    # Only results drawn from the publications index carry an entity; the rest
    # come from the general web index and have web-shaped fields only.
    entities = raw.get("entities") or []
    properties = (entities[0].get("properties") or {}) if entities else {}

    authors = _publication_authors(properties)
    if not authors and raw.get("author"):
        authors = [raw["author"]]

    citation_count = properties.get("citationCount")

    return ExaResult(
        title=title,
        url=raw.get("url", ""),
        authors=authors,
        published_date=raw.get("publishedDate") or properties.get("date"),
        # The publisher's own abstract beats a truncated page scrape as a snippet.
        text=properties.get("abstract") or raw.get("text"),
        highlights=raw.get("highlights") or [],
        highlight_scores=raw.get("highlightScores") or [],
        favicon=raw.get("favicon"),
        summary=raw.get("summary"),
        cited_by_count=(
            int(citation_count) if isinstance(citation_count, (int, float)) else None
        ),
    )


def _search_publication_index(query: str, num_results: int) -> list[ExaResult]:
    """Search Exa's dedicated publications index.

    Neither domain nor date filtering is applied here. Domain filters are rejected
    outright for this category, and date filters only constrain results that carry
    a publication date — undated ones pass through regardless, which would make a
    date filter quietly incomplete. Callers needing either must use the web index.
    """
    payload = {
        "query": query,
        "type": "auto",
        "category": "publication",
        "numResults": num_results,
        "contents": {
            "text": {"maxCharacters": 500},
            "highlights": {"numSentences": 3},
            "summary": {"query": SUMMARY_PROMPT},
        },
    }

    headers = {
        "x-api-key": EXA_API_KEY or "",
        "Content-Type": "application/json",
    }

    def call():
        response = httpx.post(
            EXA_SEARCH_URL,
            headers=headers,
            json=payload,
            timeout=EXA_REQUEST_TIMEOUT,
        )
        response.raise_for_status()
        return response.json()

    data = _call_with_retries(call, query)

    parsed = (_parse_publication_result(raw) for raw in data.get("results", []))
    return [result for result in parsed if result]


def search_exa(
    query: str,
    num_results: int = 10,
    domains: Optional[list[str]] = None,
    start_published_date: Optional[str] = None,
    use_publication_index: bool = False,
) -> list[ExaResult]:
    """Search Exa for research papers matching the query.

    Args:
        query: Search query string
        num_results: Maximum number of results to return
        domains: Optional list of domains to filter by. If None, no domain filtering
                 is applied (relies on category="research paper" for relevance).
        start_published_date: Optional ISO date string (YYYY-MM-DD) for earliest publication date
        use_publication_index: Search Exa's publications index instead of the web
                 index. Yields richer metadata and reaches venues the domain
                 allowlist misses, but supports neither `domains` nor
                 `start_published_date`.
    """
    if not EXA_API_KEY:
        raise ValueError("EXA_API_KEY environment variable is not set")

    if use_publication_index:
        return _search_publication_index(query, num_results)

    return _search_web_index(query, num_results, domains, start_published_date)
