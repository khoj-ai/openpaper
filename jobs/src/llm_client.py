"""
Simplified LLM client for metadata extraction.
This is a placeholder that would need to be implemented with your actual LLM provider.
"""
import json
import logging
import os
import asyncio
from google import genai
from google.genai import types
from typing import Optional, Type, TypeVar, Dict, Any

from pydantic import BaseModel

from src.schemas import (
    PaperMetadataExtraction,
    TitleAuthorsAbstract,
    InstitutionsKeywords,
    SummaryAndCitations,
    StarterQuestions,
    Highlights,
)
from src.utils import retry_llm_operation

logger = logging.getLogger(__name__)

# Constants
DEFAULT_CHAT_MODEL = "gemini-2.5-pro-preview-03-25"
CACHE_TTL_SECONDS = 3600

# Pydantic model type variable
T = TypeVar("T", bound=BaseModel)


SYSTEM_INSTRUCTIONS_CACHE = """
You are a metadata extraction assistant. Your task is to extract specific information from the provided academic paper content. Pay special attention ot the details and ensure accuracy in the extracted metadata.

Always think step-by-step when making a determination with respect to the contents of the paper. If you are unsure about a specific field, provide a best guess based on the content available.

You will be rewarded for your accuracy and attention to detail. You are helping to facilitate humanity's understanding of scientific knowledge by delivering accurate and reliable metadata extraction.
"""

# LLM Prompts
EXTRACT_METADATA_PROMPT_TEMPLATE = """
You are a metadata extraction assistant. Your task is to extract specific information from the provided academic paper content.

Please extract the following fields and structure them in a JSON format according to the provided schema.

Schema: {schema}
"""


class JSONParser:
    @staticmethod
    def validate_and_extract_json(response_text: str) -> Dict[str, Any]:
        """Extract and validate JSON from LLM response."""
        try:
            # Find the start and end of the JSON object
            start_idx = response_text.find("{")
            end_idx = response_text.rfind("}") + 1
            if start_idx == -1 or end_idx == 0:
                raise ValueError("No JSON object found in the response.")

            json_str = response_text[start_idx:end_idx]
            return json.loads(json_str)
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON format: {e}")
        except Exception as e:
            raise ValueError(f"Error processing JSON response: {e}")


class SimpleLLMClient:
    """
    A simple LLM client for metadata extraction.
    This is a placeholder implementation that would need to be replaced
    with actual LLM API calls (OpenAI, Anthropic, Google, etc.)
    """

    def __init__(
        self,
        api_key: str,
        default_model: Optional[str] = None,
    ):
        self.api_key = api_key
        self.default_model: str = default_model or DEFAULT_CHAT_MODEL
        self.client = genai.Client(api_key=self.api_key)

    def create_cache(self, cache_content: str) -> str:
        """Create a cache entry for the given content.

        Args:
            cache_content (str): The content to cache.

        Returns:
            str: The cache key for the stored content.
        """

        cached_content = self.client.caches.create(
            model=self.default_model,
            config=types.CreateCachedContentConfig(
                contents=types.Content(
                    role='user',
                    parts=[
                        types.Part.from_text(text=cache_content),
                        types.Part.from_text(text=SYSTEM_INSTRUCTIONS_CACHE)
                    ]
                ),
                display_name="Paper Metadata Cache",
                ttl='3600s'
            )
        )

        if cached_content and cached_content.name:
            logger.info(f"Cache created successfully: {cached_content.name}")
        else:
            logger.error("Failed to create cache entry")
            raise ValueError("Cache creation failed")

        return cached_content.name

    async def generate_content(self, prompt: str, cache_key: Optional[str] = None, model: Optional[str] = None) -> str:
        """
        Generate content using the LLM.

        Args:
            prompt: The prompt to send to the LLM
            model: Optional specific model to use, defaults to self.default_model

        Returns:
            str: The generated content from the LLM
        """
        if not model:
            model = self.default_model

        response = await self.client.aio.models.generate_content(
            model=model if model else self.default_model,
            contents=prompt,
            config=types.GenerateContentConfig(
                cached_content=cache_key,
            )
        )

        if response and response.text:
            return response.text

        raise ValueError("No content generated from LLM response")


class PaperOperations(SimpleLLMClient):
    """
    Simplified LLM client for metadata extraction.
    This is a placeholder implementation that would need to be replaced
    with actual LLM API calls (OpenAI, Anthropic, Google, etc.)
    """

    def __init__(self, api_key: str, default_model: Optional[str] = None):
        """Initialize the LLM client for paper operations."""
        super().__init__(api_key, default_model=default_model)

    async def _extract_single_metadata_field(
        self,
        model: Type[T],
        cache_key: Optional[str] = None,
        paper_content: Optional[str] = None,
    ) -> T:
        """
        Helper function to extract a single metadata field.

        Args:
            model: The Pydantic model for the data to extract.
            cache_key: The cache key for the paper content.
            paper_content: The paper content, used if cache_key is None.

        Returns:
            An instance of the provided Pydantic model.
        """
        if not cache_key and not paper_content:
            raise ValueError("Either cache_key or paper_content must be provided")

        prompt = EXTRACT_METADATA_PROMPT_TEMPLATE.format(
            schema=model.model_json_schema()
        )

        if paper_content and not cache_key:
            prompt = f"Paper Content:\n\n{paper_content}\n\n{prompt}"

        response = await self.generate_content(prompt, cache_key=cache_key)
        response_json = JSONParser.validate_and_extract_json(response)
        return model.model_validate(response_json)

    @retry_llm_operation(max_retries=3, delay=1.0)
    async def extract_title_authors_abstract(
        self, cache_key: Optional[str] = None, paper_content: Optional[str] = None
    ) -> TitleAuthorsAbstract:
        return await self._extract_single_metadata_field(
            model=TitleAuthorsAbstract,
            cache_key=cache_key,
            paper_content=paper_content,
        )

    @retry_llm_operation(max_retries=3, delay=1.0)
    async def extract_institutions_keywords(
        self, cache_key: Optional[str] = None, paper_content: Optional[str] = None
    ) -> InstitutionsKeywords:
        return await self._extract_single_metadata_field(
            model=InstitutionsKeywords,
            cache_key=cache_key,
            paper_content=paper_content,
        )

    @retry_llm_operation(max_retries=3, delay=1.0)
    async def extract_summary_and_citations(
        self, cache_key: Optional[str] = None, paper_content: Optional[str] = None
    ) -> SummaryAndCitations:
        return await self._extract_single_metadata_field(
            model=SummaryAndCitations,
            cache_key=cache_key,
            paper_content=paper_content,
        )

    @retry_llm_operation(max_retries=3, delay=1.0)
    async def extract_starter_questions(
        self, cache_key: Optional[str] = None, paper_content: Optional[str] = None
    ) -> StarterQuestions:
        return await self._extract_single_metadata_field(
            model=StarterQuestions, cache_key=cache_key, paper_content=paper_content
        )

    @retry_llm_operation(max_retries=3, delay=1.0)
    async def extract_highlights(
        self, cache_key: Optional[str] = None, paper_content: Optional[str] = None
    ) -> Highlights:
        return await self._extract_single_metadata_field(
            model=Highlights, cache_key=cache_key, paper_content=paper_content
        )

    async def extract_paper_metadata(
        self, paper_content: str
    ) -> PaperMetadataExtraction:
        """
        Extract metadata from paper content using LLM.

        Args:
            paper_content: The extracted text content from the PDF

        Returns:
            PaperMetadataExtraction: Extracted metadata
        """
        try:
            try:
                cache_key = self.create_cache(paper_content)
            except Exception as e:
                logger.error(f"Failed to create cache: {e}", exc_info=True)
                cache_key = None

            # Run all extraction tasks concurrently
            tasks = [
                self.extract_title_authors_abstract(
                    cache_key=cache_key,
                    paper_content=paper_content if not cache_key else None,
                ),
                self.extract_institutions_keywords(
                    cache_key=cache_key,
                    paper_content=paper_content if not cache_key else None,
                ),
                self.extract_summary_and_citations(
                    cache_key=cache_key,
                    paper_content=paper_content if not cache_key else None,
                ),
                self.extract_starter_questions(
                    cache_key=cache_key,
                    paper_content=paper_content if not cache_key else None,
                ),
                self.extract_highlights(
                    cache_key=cache_key,
                    paper_content=paper_content if not cache_key else None,
                ),
            ]
            results = await asyncio.gather(*tasks, return_exceptions=True)

            # Process results and handle potential errors
            (
                title_authors_abstract,
                institutions_keywords,
                summary_and_citations,
                starter_questions,
                highlights,
            ) = results

            # Combine the results into the final metadata object
            return PaperMetadataExtraction(
                title=getattr(title_authors_abstract, "title", ""),
                authors=getattr(title_authors_abstract, "authors", []),
                abstract=getattr(title_authors_abstract, "abstract", ""),
                institutions=getattr(institutions_keywords, "institutions", []),
                keywords=getattr(institutions_keywords, "keywords", []),
                summary=getattr(summary_and_citations, "summary", ""),
                summary_citations=getattr(
                    summary_and_citations, "summary_citations", []
                ),
                starter_questions=getattr(starter_questions, "starter_questions", []),
                highlights=getattr(highlights, "highlights", []),
                publish_date=getattr(title_authors_abstract, "publish_date", None),
            )

        except Exception as e:
            logger.error(f"Error extracting metadata: {e}", exc_info=True)
            raise ValueError(f"Failed to extract metadata: {str(e)}")


# Create a single instance to use throughout the application
api_key = os.getenv("GOOGLE_API_KEY")

if not api_key:
    raise ValueError("GOOGLE_API_KEY environment variable is not set")

llm_client = PaperOperations(api_key=api_key, default_model=DEFAULT_CHAT_MODEL)
