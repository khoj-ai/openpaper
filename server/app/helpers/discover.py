"""Discovery pipeline: decompose research questions into subqueries and search."""

import json
import logging
from typing import AsyncGenerator, List

from app.helpers.exa_search import ExaResult, search_exa
from app.llm.base import BaseLLMClient, ModelType
from app.llm.provider import LLMProvider
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


async def run_discover_pipeline(question: str) -> AsyncGenerator[dict, None]:
    """
    Run the full discover pipeline, yielding streaming chunks:
    1. {"type": "subqueries", "content": [...]}
    2. {"type": "results", "subquery": "...", "content": [...]}
    3. {"type": "done"}
    """
    # Step 1: Decompose question into subqueries
    subqueries = decompose_query(question)
    yield {"type": "subqueries", "content": subqueries}

    # Step 2: Search each subquery via Exa
    for subquery in subqueries:
        try:
            results = search_exa(subquery, num_results=5)

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
