"""LLM tools for web search and fetch, backed by Exa and Firecrawl.

Used by the citation-finding agent to recover paper metadata (journal,
publisher, DOI, publication date) when structured APIs (CrossRef/OpenAlex)
come up empty.
"""

from logging import getLogger
from typing import Any

from app.helpers.exa_search import search_exa
from app.helpers.scrape import scrape_web_page

logger = getLogger(__name__)

# Cap scraped page content so a single fetch can't blow the context window.
MAX_FETCH_CHARS = 8000

web_search_function = {
    "name": "web_search",
    "description": (
        "Search the web (academic sources prioritized) for a paper's "
        "bibliographic details. Returns a list of results with title, url, "
        "published date, and a short summary. Use this to locate the "
        "publication venue, publisher, DOI, or publication date of a known "
        "paper. Search by the paper's exact title, optionally combined with "
        "terms like 'journal', 'DOI', or an author name."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "The search query.",
            },
            "num_results": {
                "type": "integer",
                "description": "How many results to return (default 5, max 10).",
            },
        },
        "required": ["query"],
    },
}

web_fetch_function = {
    "name": "web_fetch",
    "description": (
        "Fetch and read the content of a specific web page as markdown. Use "
        "this on a promising URL from web_search (e.g. a journal landing page "
        "or DOI resolver) to extract the exact journal name, publisher, or "
        "publication date."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "url": {
                "type": "string",
                "description": "The URL of the page to fetch.",
            },
        },
        "required": ["url"],
    },
}


def web_search(query: str, num_results: int = 5) -> list[dict[str, Any]]:
    """Search the web for paper metadata. Returns a list of result dicts."""
    capped = max(1, min(num_results, 10))
    results = search_exa(query, num_results=capped)
    return [
        {
            "title": r.title,
            "url": r.url,
            "published_date": r.published_date,
            "summary": r.summary or (r.text[:300] if r.text else None),
        }
        for r in results
    ]


def web_fetch(url: str) -> str:
    """Fetch a web page as markdown, truncated to a safe length."""
    content = scrape_web_page(url)
    if len(content) > MAX_FETCH_CHARS:
        return content[:MAX_FETCH_CHARS] + "\n\n[...truncated...]"
    return content
