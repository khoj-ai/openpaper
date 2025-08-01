"""
Simplified LLM client for metadata extraction.
"""
import json
import logging
import os
import re
import io
import asyncio
from google import genai
from google.genai import types
from typing import Optional, Type, TypeVar, Callable

from pydantic import BaseModel

from src.schemas import (
    PaperMetadataExtraction,
    TitleAuthorsAbstract,
    InstitutionsKeywords,
    SummaryAndCitations,
    StarterQuestions,
    Highlights,
)
from src.utils import retry_llm_operation, time_it

logger = logging.getLogger(__name__)

# Constants
DEFAULT_CHAT_MODEL = "gemini-2.5-pro-preview-03-25"
FAST_CHAT_MODEL = "gemini-2.5-flash"
CACHE_TTL_SECONDS = 3600

# Pydantic model type variable
T = TypeVar("T", bound=BaseModel)


SYSTEM_INSTRUCTIONS_CACHE = """
You are a metadata extraction assistant. Your task is to extract specific information from the provided academic paper content. Pay special attention ot the details and ensure accuracy in the extracted metadata.

Always think deeply and step-by-step when making a determination with respect to the contents of the paper. If you are unsure about a specific field, provide a best guess based on the content available.

You will be rewarded for your accuracy and attention to detail. You are helping to facilitate humanity's understanding of scientific knowledge by delivering accurate and reliable metadata extraction.
"""

# LLM Prompts
EXTRACT_METADATA_PROMPT_TEMPLATE = """
You are a metadata extraction assistant. Your task is to extract specific information from the provided academic paper content. You must be thorough in your approach and ensure that all relevant metadata is captured accurately.

Please extract the following fields and structure them in a JSON format according to the provided schema.
"""

SYSTEM_INSTRUCTIONS_IMAGE_CAPTION_CACHE = """
You are an image captioning assistant for academic papers. Your task is to extract exact captions for images.

Return only the caption text with no additional commentary or explanations.

Rules:
- For figures, graphs, or charts: Return the exact caption from the paper
- Return an empty string if the image is:
  • Not a graph, chart, or figure
  • Not useful for understanding the paper
  • A partial portion of a larger figure, thus not a standalone or complete figure
  • Has no caption and is not useful for understanding the paper
"""


class JSONParser:

    @staticmethod
    def validate_and_extract_json(json_data: str) -> dict:
        """Extract and validate JSON data from various formats"""
        if not json_data or not isinstance(json_data, str):
            raise ValueError("Invalid input: empty or non-string data")

        json_data = json_data.strip()

        # Case 1: Try parsing directly first
        try:
            return json.loads(json_data)
        except json.JSONDecodeError:
            pass

        # Case 2: Check for code block format
        if "```" in json_data:
            code_blocks = re.findall(r"```(?:json)?\s*([\s\S]*?)```", json_data)

            for block in code_blocks:
                block = block.strip()
                block = re.sub(r"}\s+\w+\s+}", "}}", block)
                block = re.sub(r"}\s+\w+\s+,", "},", block)

                try:
                    return json.loads(block)
                except json.JSONDecodeError:
                    continue

        raise ValueError(
            "Could not extract valid JSON from the provided string. "
            "Please ensure the response contains proper JSON format."
        )


class AsyncLLMClient:
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
        self.client: Optional[genai.Client] = None

    def refresh_client(self):
        """Refresh the LLM client with the current API key."""
        if not self.api_key:
            raise ValueError("API key is not set")
        self.client = genai.Client(api_key=self.api_key)

    async def create_cache(self, cache_content: str) -> str:
        """Create a cache entry for the given content.

        Args:
            cache_content (str): The content to cache.

        Returns:
            str: The cache key for the stored content.
        """

        if not self.client:
            raise ValueError("Client not initialized. Call extract_paper_metadata first.")

        cached_content = await self.client.aio.caches.create(
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

    async def create_file_cache(
        self,
        file_path: str,
        system_instructions: Optional[str] = None,
    ):
        """Create a cache entry for the given file.

        Args:
            file_path (str): The path to the file to cache.

        Returns:
            str: The cache key for the stored file.
        """

        if not self.client:
            raise ValueError("Client not initialized. Call extract_paper_metadata first.")

        # Read the file content
        with open(file_path, 'rb') as f:
            file_content = f.read()

        doc_io = io.BytesIO(file_content)
        document = await self.client.aio.files.upload(
            file=doc_io,
            config=types.UploadFileConfig(
                mime_type='application/pdf',
            )
        )

        cached_content = await self.client.aio.caches.create(
            model=self.default_model,
            config=types.CreateCachedContentConfig(
                contents=document,
                display_name="Paper Metadata Cache",
                ttl='3600s',
                system_instruction=system_instructions or SYSTEM_INSTRUCTIONS_CACHE
            ),
        )

        if cached_content and cached_content.name:
            logger.info(f"File cache created successfully: {cached_content.name}")
        else:
            logger.error("Failed to create cache entry")
            raise ValueError("Cache creation failed")

        return cached_content.name

    async def generate_content(
        self,
        prompt: str,
        image_bytes: Optional[bytes] = None,
        image_mime_type: Optional[str] = None,
        cache_key: Optional[str] = None,
        model: Optional[str] = None,
        schema: Optional[Type[BaseModel]] = None,
    ) -> str:
        """
        Generate content using the LLM.

        Args:
            prompt: The prompt to send to the LLM
            model: Optional specific model to use, defaults to self.default_model

        Returns:
            str: The generated content from the LLM
        """
        if not self.client:
            raise ValueError("Client not initialized. Call extract_paper_metadata first.")

        if not model:
            model = self.default_model

        parts = []
        if image_bytes:
            parts.append(types.Part.from_bytes(data=image_bytes, mime_type=image_mime_type or 'image/png'))

        parts.append(types.Part.from_text(text=prompt))

        config = types.GenerateContentConfig(
            cached_content=cache_key
        )

        if schema:
            config.response_mime_type = 'application/json'
            config.response_schema = schema.model_json_schema()

        response = await self.client.aio.models.generate_content(
            model=model,
            contents=types.Content(
                role='user',
                parts=parts
            ),
            config=config
        )

        if response and response.text:
            return response.text

        raise ValueError("No content generated from LLM response")


class PaperOperations(AsyncLLMClient):
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
        paper_content: str,
        schema: Type[BaseModel],
        status_callback: Callable[[str], None],
        cache_key: Optional[str] = None
    ) -> T:
        """
        Helper function to extract a single metadata field.

        Args:
            model: The Pydantic model for the data to extract.
            paper_content: The paper content.
            status_callback: Optional function to update task status.

        Returns:
            An instance of the provided Pydantic model.
        """
        prompt = EXTRACT_METADATA_PROMPT_TEMPLATE.format(
        )

        if paper_content and not cache_key:
            prompt = f"Paper Content:\n\n{paper_content}\n\n{prompt}"

        response = await self.generate_content(prompt, cache_key=cache_key, schema=schema)
        response_json = JSONParser.validate_and_extract_json(response)
        instance = model.model_validate(response_json)

        if model == SummaryAndCitations:
            n_citations = len(getattr(instance, "summary_citations", []))
            status_callback(f"Compiled with {n_citations} citations")
        elif model == InstitutionsKeywords:
            keywords = getattr(instance, "keywords", [])
            institutions = getattr(instance, "institutions", [])
            first_keyword = keywords[0] if keywords else ""
            if first_keyword:
                status_callback(
                    f"Building on {first_keyword} context"
                )
            elif institutions:
                institutions = getattr(instance, "institutions", [])
                first_institution = institutions[0] if institutions else ""
                status_callback(
                    f"Adding context from institution: {first_institution}"
                )
            else:
                status_callback("Processing without keyword data")
        elif model == StarterQuestions:
            starter_questions = getattr(instance, "starter_questions", [])
            if starter_questions:
                status_callback(
                    f"Constructed {len(starter_questions)} initial questions"
                )
            else:
                status_callback("No starter questions generated")
        elif model == Highlights:
            highlights = getattr(instance, "highlights", [])
            if highlights:
                status_callback(
                    f"Formulated {len(highlights)} annotations"
                )
            else:
                status_callback("No annotations extracted")
        elif model == TitleAuthorsAbstract:
            title = getattr(instance, "title", "")
            status_callback(
                f"Reading {title if title else 'untitled paper'}"
            )
        else:
            status_callback(f"Successfully extracted {model.__name__}")

        return instance

    @retry_llm_operation(max_retries=3, delay=1.0)
    async def extract_title_authors_abstract(
        self,
        paper_content: str,
        status_callback: Callable[[str], None],
        cache_key: Optional[str] = None,
    ) -> TitleAuthorsAbstract:
        result = await self._extract_single_metadata_field(
            model=TitleAuthorsAbstract,
            cache_key=cache_key,
            schema=TitleAuthorsAbstract,
            paper_content=paper_content,
            status_callback=status_callback,
        )
        return result

    @retry_llm_operation(max_retries=3, delay=1.0)
    async def extract_institutions_keywords(
        self,
        paper_content: str,
        status_callback: Callable[[str], None],
        cache_key: Optional[str] = None,
    ) -> InstitutionsKeywords:
        return await self._extract_single_metadata_field(
            model=InstitutionsKeywords,
            cache_key=cache_key,
            schema=InstitutionsKeywords,
            paper_content=paper_content,
            status_callback=status_callback,
        )

    @retry_llm_operation(max_retries=3, delay=1.0)
    async def extract_summary_and_citations(
        self,
        paper_content: str,
        status_callback: Callable[[str], None],
        cache_key: Optional[str] = None,
    ) -> SummaryAndCitations:
        result = await self._extract_single_metadata_field(
            model=SummaryAndCitations,
            cache_key=cache_key,
            schema=SummaryAndCitations,
            paper_content=paper_content,
            status_callback=status_callback,
        )
        return result

    @retry_llm_operation(max_retries=3, delay=1.0)
    async def extract_starter_questions(
        self,
        paper_content: str,
        status_callback: Callable[[str], None],
        cache_key: Optional[str] = None,
    ) -> StarterQuestions:
        return await self._extract_single_metadata_field(
            model=StarterQuestions,
            cache_key=cache_key,
            schema=StarterQuestions,
            paper_content=paper_content,
            status_callback=status_callback,
        )

    @retry_llm_operation(max_retries=3, delay=1.0)
    async def extract_highlights(
        self,
        paper_content: str,
        status_callback: Callable[[str], None],
        cache_key: Optional[str] = None,
    ) -> Highlights:
        return await self._extract_single_metadata_field(
            model=Highlights,
            paper_content=paper_content,
            status_callback=status_callback,
            cache_key=cache_key,
            schema=Highlights,
        )

    async def extract_paper_metadata(
        self,
        paper_content: str,
        job_id: str,  # Add job_id here
        status_callback: Optional[Callable[[str], None]] = None,
    ) -> PaperMetadataExtraction:
        """
        Extract metadata from paper content using LLM.

        Args:
            paper_content: The extracted text content from the PDF
            status_callback: Optional function to update task status

        Returns:
            PaperMetadataExtraction: Extracted metadata
        """
        async with time_it("Extracting paper metadata from LLM", job_id=job_id):
            # Create a new client for this operation
            self.client = genai.Client(api_key=self.api_key)

            try:
                try:
                    async with time_it("Creating cache for paper content", job_id=job_id):
                        cache_key = await self.create_cache(paper_content)
                except Exception as e:
                    logger.error(f"Failed to create cache: {e}", exc_info=True)
                    cache_key = None

                # Run all extraction tasks concurrently
                async with time_it("Running all metadata extraction tasks concurrently", job_id=job_id):
                    tasks = [
                        asyncio.create_task(time_it("Extracting title, authors, and abstract", job_id=job_id)                        (
                            self.extract_title_authors_abstract
                        )(
                            paper_content=paper_content,
                            cache_key=cache_key,
                            status_callback=status_callback
                        )),
                        asyncio.create_task(time_it("Extracting institutions and keywords", job_id=job_id)                        (
                            self.extract_institutions_keywords
                        )(
                            paper_content=paper_content,
                            cache_key=cache_key,
                            status_callback=status_callback
                        )),
                        asyncio.create_task(time_it("Extracting summary and citations", job_id=job_id)                        (
                            self.extract_summary_and_citations
                        )(
                            paper_content=paper_content,
                            cache_key=cache_key,
                            status_callback=status_callback
                        )),
                        asyncio.create_task(time_it("Extracting starter questions", job_id=job_id)                        (
                            self.extract_starter_questions
                        )(
                            paper_content=paper_content,
                            cache_key=cache_key,
                            status_callback=status_callback
                        )),
                        asyncio.create_task(time_it("Extracting highlights", job_id=job_id)                        (
                            self.extract_highlights
                        )(
                            paper_content=paper_content,
                            cache_key=cache_key,
                            status_callback=status_callback
                        )),
                    ]

                    # Use shield to prevent task cancellation during cleanup
                    shielded_tasks = [asyncio.shield(task) for task in tasks]
                    results = await asyncio.gather(*shielded_tasks, return_exceptions=True)

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
                if status_callback:
                    status_callback(f"Error during metadata extraction: {e}")
                raise ValueError(f"Failed to extract metadata: {str(e)}")
            finally:
                # Set client to None to allow for proper garbage collection
                self.client = None

    async def extract_image_captions(
        self,
        cache_key: Optional[str],
        image_data: bytes,
        image_mime_type: Optional[str] = None,
    ) -> str:
        """
        Extract caption for an image in a PDF using LLM.

        Args:
            cache_key: Optional cache key for the LLM
            image_data: Bytes of the image to extract captions for
            image_mime_type: Optional MIME type of the image

        Returns:
            The caption for the image as a string
        """
        # Create a new client for this operation
        self.client = genai.Client(api_key=self.api_key)

        try:
            system_instructions = SYSTEM_INSTRUCTIONS_IMAGE_CAPTION_CACHE

            response = await self.generate_content(
                system_instructions,
                cache_key=cache_key,
                image_bytes=image_data,
                image_mime_type=image_mime_type
            )

            return response

        except Exception as e:
            logger.error(f"Error extracting image captions: {e}", exc_info=True)
            return ""
        finally:
            # Set client to None to allow for proper garbage collection
            self.client = None

# Create a single instance to use throughout the application
api_key = os.getenv("GOOGLE_API_KEY")

if not api_key:
    raise ValueError("GOOGLE_API_KEY environment variable is not set")

llm_client = PaperOperations(api_key=api_key, default_model=DEFAULT_CHAT_MODEL)
fast_llm_client = PaperOperations(api_key=api_key, default_model=FAST_CHAT_MODEL)
