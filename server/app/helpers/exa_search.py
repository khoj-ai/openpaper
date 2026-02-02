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
    score: Optional[float] = None

    def to_dict(self) -> dict:
        return {
            "title": self.title,
            "url": self.url,
            "author": self.author,
            "published_date": self.published_date,
            "text": self.text,
            "highlights": self.highlights,
            "score": self.score,
        }


def search_exa(query: str, num_results: int = 10) -> list[ExaResult]:
    """Search Exa for research papers matching the query."""
    if not EXA_API_KEY:
        raise ValueError("EXA_API_KEY environment variable is not set")

    exa = Exa(api_key=EXA_API_KEY)

    try:
        response = exa.search_and_contents(
            query=query,
            num_results=num_results,
            category="research paper",
            text={"max_characters": 500},
            highlights={"num_sentences": 3},
        )

        results = []
        for result in response.results:
            results.append(
                ExaResult(
                    title=result.title or "Untitled",
                    url=result.url,
                    author=result.author,
                    published_date=result.published_date,
                    text=result.text,
                    highlights=result.highlights if result.highlights else [],
                    score=result.score,
                )
            )

        return results
    except Exception as e:
        logger.error(f"Exa search failed for query '{query}': {e}")
        raise
