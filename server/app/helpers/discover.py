"""Discovery pipeline: decompose research questions into subqueries and search."""

import json
import logging
from typing import AsyncGenerator, List, Optional

from app.helpers.exa_search import search_exa
from app.helpers.openalex_search import search_openalex
from app.llm.base import BaseLLMClient, ModelType
from app.llm.provider import LLMProvider
from app.schemas.discover import DISCOVER_SOURCES
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

llm_client = BaseLLMClient(default_provider=LLMProvider.GEMINI)

DECOMPOSE_PROMPT = """You are a research assistant helping find academic papers. Given a research question, generate 2-5 search subqueries.

Guidelines:
- The FIRST subquery should be a direct, general search closely matching the original question's core intent
- Additional subqueries can explore specific aspects, related concepts, or alternative phrasings
- Vary specificity: include both broad and narrow queries
- If the original question is already specific and well-formed, fewer subqueries (2-3) may be better
- Each subquery should be a concise search phrase suitable for academic paper search
- Avoid over-decomposing simple questions into overly narrow fragments"""


class DecomposeResponse(BaseModel):
    subqueries: List[str] = Field(
        description="A list of 2-5 targeted search subqueries for finding relevant research papers.",
        min_length=2,
        max_length=5,
    )


def decompose_query(question: str) -> list[str]:
    """Use LLM to decompose a research question into targeted subqueries."""
    response = llm_client.generate_content(
        contents=question,
        system_prompt=DECOMPOSE_PROMPT,
        model_type=ModelType.FAST,
        enable_thinking=False,
        schema=DecomposeResponse.model_json_schema(),
    )

    parsed = DecomposeResponse.model_validate(json.loads(response.text))
    return parsed.subqueries


def _get_domains_for_sources(sources: list[str]) -> Optional[list[str]]:
    """Get combined domain list for the given source keys."""
    domains = []
    for source in sources:
        if source in DISCOVER_SOURCES:
            source_domains = DISCOVER_SOURCES[source].get("domains")
            if source_domains:
                domains.extend(source_domains)
    return domains if domains else None


async def run_discover_pipeline(
    question: str,
    sources: Optional[list[str]] = None,
    sort: Optional[str] = None,
    only_open_access: bool = False,
) -> AsyncGenerator[dict, None]:
    """
    Run the full discover pipeline, yielding streaming chunks:
    1. {"type": "subqueries", "content": [...]}
    2. {"type": "results", "subquery": "...", "content": [...]}
    3. {"type": "done"}

    Args:
        question: The research question to explore
        sources: Optional list of source keys to filter by. If includes "openalex",
                 uses OpenAlex backend. Otherwise uses Exa with domain filtering.
        sort: Optional sort parameter for OpenAlex (e.g., "cited_by_count:desc")
        only_open_access: If True, only return open access papers (OpenAlex only)
    """
    # Step 1: Decompose question into subqueries
    subqueries = decompose_query(question)
    yield {"type": "subqueries", "content": subqueries}

    # Determine search strategy based on sources
    use_openalex = sources and "openalex" in sources
    exa_domains = None
    if sources and not use_openalex:
        exa_domains = _get_domains_for_sources(sources)

    # Step 2: Search each subquery
    for subquery in subqueries:
        try:
            if use_openalex:
                results = search_openalex(
                    subquery,
                    num_results=10,
                    sort=sort,
                    only_open_access=only_open_access,
                )
            else:
                results = search_exa(subquery, num_results=10, domains=exa_domains)

            yield {
                "type": "results",
                "subquery": subquery,
                "content": [r.to_dict() for r in results],
            }
        except Exception as e:
            logger.error(f"Search failed for subquery '{subquery}': {e}")
            yield {
                "type": "results",
                "subquery": subquery,
                "content": [],
            }

    yield {"type": "done"}
