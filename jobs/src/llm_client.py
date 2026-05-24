"""
Simplified LLM client for metadata extraction.
"""
import json
import logging
import os
import re
import io
import asyncio
import random
import httpx
from google import genai
from google.genai import types
from google.genai.errors import APIError, ClientError, ServerError
from typing import Any, Dict, List, Optional, Type, TypeVar, Callable

from pydantic import BaseModel, ValidationError, create_model, Field, ConfigDict

from src.prompts import EXTRACT_COLS_INSTRUCTION, SYSTEM_INSTRUCTIONS_CACHE, EXTRACT_METADATA_PROMPT_TEMPLATE
from src.schemas import (
    DataTableRow,
    PaperMetadataExtraction,
    TitleAuthorsAbstract,
    InstitutionsKeywords,
    SummaryAndCitations,
    Highlights,
    DataTableCellValue,
)
from src.utils import retry_llm_operation, time_it

logger = logging.getLogger(__name__)

# Constants
DEFAULT_CHAT_MODEL = "gemini-3.1-pro-preview"
FAST_CHAT_MODEL = "gemini-3-flash-preview"
CACHE_TTL_SECONDS = 3600

# Pydantic model type variable
T = TypeVar("T", bound=BaseModel)


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

    DEFAULT_TIMEOUT = 90_000  # 90s for text/cached operations
    PDF_TIMEOUT = 120_000    # 120s for PDF file operations

    def __init__(
        self,
        api_key: str,
        default_model: Optional[str] = None,
    ):
        self.api_key = api_key
        self.default_model: str = default_model or DEFAULT_CHAT_MODEL

    def _create_client(self, timeout: int = DEFAULT_TIMEOUT) -> genai.Client:
        """Create a fresh client instance for thread-safe concurrent calls."""
        if not self.api_key:
            raise ValueError("API key is not set")
        return genai.Client(
            api_key=self.api_key,
            http_options=types.HttpOptions(timeout=timeout),
        )

    async def create_cache(self, cache_content: str, client: genai.Client, model: Optional[str] = None) -> str:
        """Create a cache entry for the given content.

        Args:
            cache_content (str): The content to cache.
            client: The genai client to use.
            model: Optional model override. Defaults to self.default_model.

        Returns:
            str: The cache key for the stored content.
        """
        cached_content = await client.aio.caches.create(
            model=model or self.default_model,
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
        client: genai.Client,
        system_instructions: Optional[str] = None,
    ):
        """Create a cache entry for the given file.

        Args:
            file_path (str): The path to the file to cache.
            client: The genai client to use.

        Returns:
            str: The cache key for the stored file.
        """
        # Read the file content
        with open(file_path, 'rb') as f:
            file_content = f.read()

        doc_io = io.BytesIO(file_content)
        document = await client.aio.files.upload(
            file=doc_io,
            config=types.UploadFileConfig(
                mime_type='application/pdf',
            )
        )

        cached_content = await client.aio.caches.create(
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
        file_path: Optional[str] = None,
        max_retries: int = 3,
        base_delay: float = 1.0,
        client: Optional[genai.Client] = None,
    ) -> str:
        """
        Generate content using the LLM with automatic retry and exponential backoff.

        Args:
            prompt: The prompt to send to the LLM
            model: Optional specific model to use, defaults to self.default_model
            max_retries: Maximum number of retry attempts (default: 3)
            base_delay: Base delay in seconds for exponential backoff (default: 1.0)
            client: Optional client to use (for concurrent calls)

        Returns:
            str: The generated content from the LLM
        """
        if not client:
            raise ValueError("Client is required for generate_content")

        if not model:
            model = self.default_model

        parts = []
        if image_bytes:
            parts.append(types.Part.from_bytes(data=image_bytes, mime_type=image_mime_type or 'image/png'))

        if file_path:
            with open(file_path, "rb") as f:
                file_data = f.read()
            parts.append(types.Part.from_bytes(data=file_data, mime_type='application/pdf'))


        parts.append(types.Part.from_text(text=prompt))

        config = types.GenerateContentConfig(
            cached_content=cache_key
        )

        if schema:
            config.response_mime_type = 'application/json'
            config.response_schema = schema.model_json_schema()

        last_exception: Optional[Exception] = None

        for attempt in range(max_retries + 1):
            try:
                response = await client.aio.models.generate_content(
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

            except (ServerError, ClientError, APIError, httpx.TimeoutException) as e:
                last_exception = e
                if attempt < max_retries:
                    # Exponential backoff with jitter
                    backoff_time = base_delay * (2 ** attempt) * (0.5 + 0.5 * random.random())
                    logger.warning(
                        f"LLM API error (attempt {attempt + 1}/{max_retries + 1}): {e}. "
                        f"Retrying in {backoff_time:.2f}s"
                    )
                    await asyncio.sleep(backoff_time)
                else:
                    logger.error(f"All {max_retries + 1} attempts failed for generate_content: {e}")

        # If we reach here, all retries failed
        raise last_exception or ValueError("Failed to generate content after all retries")

    async def generate_structured(
        self,
        prompt: str,
        schema: Type[T],
        client: genai.Client,
        model: Optional[str] = None,
        file_path: Optional[str] = None,
        cache_key: Optional[str] = None,
        max_retries: int = 3,
        base_delay: float = 1.0,
    ) -> T:
        """
        Generate content constrained to a Pydantic schema and return a validated instance.

        Prefers the SDK's parsed object (response.parsed); falls back to parsing the raw
        response text. Retries on transport errors as well as parse/validation failures,
        adding a corrective instruction on retry. Logs the raw response if all attempts fail.
        """
        if not client:
            raise ValueError("Client is required for generate_structured")

        if not model:
            model = self.default_model

        base_parts = []
        if file_path:
            with open(file_path, "rb") as f:
                file_data = f.read()
            base_parts.append(types.Part.from_bytes(data=file_data, mime_type='application/pdf'))
        base_parts.append(types.Part.from_text(text=prompt))

        # Passing the Pydantic class (not model_json_schema()) lets the SDK populate response.parsed.
        config = types.GenerateContentConfig(
            cached_content=cache_key,
            response_mime_type='application/json',
            response_schema=schema,
        )

        last_exception: Optional[Exception] = None
        last_raw: Optional[str] = None

        for attempt in range(max_retries + 1):
            parts = list(base_parts)
            if attempt > 0 and last_raw is not None:
                parts.append(types.Part.from_text(
                    text=(
                        "Your previous response could not be parsed as valid JSON. "
                        "Respond with ONLY a single JSON object matching the schema — "
                        "no prose, no markdown code fences, and properly escape any quotes inside string values."
                    )
                ))

            try:
                response = await client.aio.models.generate_content(
                    model=model,
                    contents=types.Content(role='user', parts=parts),
                    config=config,
                )

                parsed = getattr(response, "parsed", None)
                if isinstance(parsed, schema):
                    return parsed

                last_raw = response.text if response else None
                if not last_raw:
                    raise ValueError("No content generated from LLM response")

                response_json = JSONParser.validate_and_extract_json(last_raw)
                return schema.model_validate(response_json)

            except (ServerError, ClientError, APIError, httpx.TimeoutException) as e:
                last_exception = e
                if attempt < max_retries:
                    backoff_time = base_delay * (2 ** attempt) * (0.5 + 0.5 * random.random())
                    logger.warning(
                        f"LLM API error (attempt {attempt + 1}/{max_retries + 1}): {e}. "
                        f"Retrying in {backoff_time:.2f}s"
                    )
                    await asyncio.sleep(backoff_time)
                else:
                    logger.error(f"All {max_retries + 1} attempts failed for generate_structured: {e}")
            except (ValueError, ValidationError) as e:
                last_exception = e
                if attempt < max_retries:
                    backoff_time = base_delay * (2 ** attempt) * (0.5 + 0.5 * random.random())
                    logger.warning(
                        f"Structured parse failed for {schema.__name__} "
                        f"(attempt {attempt + 1}/{max_retries + 1}): {e}. Retrying in {backoff_time:.2f}s"
                    )
                    await asyncio.sleep(backoff_time)
                else:
                    logger.error(
                        f"All {max_retries + 1} attempts failed to parse structured response for "
                        f"{schema.__name__}. Raw response (first 1000 chars): {(last_raw or '')[:1000]!r}"
                    )

        raise last_exception or ValueError("Failed to generate structured content after all retries")


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
        client: genai.Client,
        cache_key: Optional[str] = None,
        llm_model: Optional[str] = None,
    ) -> T:
        """
        Helper function to extract a single metadata field.

        Args:
            model: The Pydantic model for the data to extract.
            paper_content: The paper content.
            status_callback: Optional function to update task status.
            client: The genai client to use.
            llm_model: Optional LLM model override.

        Returns:
            An instance of the provided Pydantic model.
        """
        prompt = EXTRACT_METADATA_PROMPT_TEMPLATE.format(
        )

        if paper_content and not cache_key:
            prompt = f"Paper Content:\n\n{paper_content}\n\n{prompt}"

        instance = await self.generate_structured(
            prompt, schema=model, cache_key=cache_key, client=client, model=llm_model
        )

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
        client: genai.Client,
        cache_key: Optional[str] = None,
        llm_model: Optional[str] = None,
    ) -> TitleAuthorsAbstract:
        result = await self._extract_single_metadata_field(
            model=TitleAuthorsAbstract,
            cache_key=cache_key,
            schema=TitleAuthorsAbstract,
            paper_content=paper_content,
            status_callback=status_callback,
            client=client,
            llm_model=llm_model,
        )
        return result

    @retry_llm_operation(max_retries=3, delay=1.0)
    async def extract_institutions_keywords(
        self,
        paper_content: str,
        status_callback: Callable[[str], None],
        client: genai.Client,
        cache_key: Optional[str] = None,
        llm_model: Optional[str] = None,
    ) -> InstitutionsKeywords:
        return await self._extract_single_metadata_field(
            model=InstitutionsKeywords,
            cache_key=cache_key,
            schema=InstitutionsKeywords,
            paper_content=paper_content,
            status_callback=status_callback,
            client=client,
            llm_model=llm_model,
        )

    @retry_llm_operation(max_retries=3, delay=1.0)
    async def extract_summary_and_citations(
        self,
        paper_content: str,
        status_callback: Callable[[str], None],
        client: genai.Client,
        cache_key: Optional[str] = None,
        llm_model: Optional[str] = None,
    ) -> SummaryAndCitations:
        result = await self._extract_single_metadata_field(
            model=SummaryAndCitations,
            cache_key=cache_key,
            schema=SummaryAndCitations,
            paper_content=paper_content,
            status_callback=status_callback,
            client=client,
            llm_model=llm_model,
        )
        return result

    @retry_llm_operation(max_retries=3, delay=1.0)
    async def extract_highlights(
        self,
        paper_content: str,
        status_callback: Callable[[str], None],
        client: genai.Client,
        cache_key: Optional[str] = None,
        llm_model: Optional[str] = None,
    ) -> Highlights:
        return await self._extract_single_metadata_field(
            model=Highlights,
            paper_content=paper_content,
            status_callback=status_callback,
            cache_key=cache_key,
            schema=Highlights,
            client=client,
            llm_model=llm_model,
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
            extraction_model = os.getenv("EXTRACTION_MODEL", FAST_CHAT_MODEL)
            logger.info(f"Using extraction model: {extraction_model}")

            # Create a fresh client for this operation
            client = self._create_client()

            try:
                try:
                    async with time_it("Creating cache for paper content", job_id=job_id):
                        cache_key = await self.create_cache(paper_content, client, model=extraction_model)
                except Exception as e:
                    logger.error(f"Failed to create cache: {e}", exc_info=True)
                    cache_key = None

                # Run all extraction tasks concurrently
                async with time_it("Running all metadata extraction tasks concurrently", job_id=job_id):
                    tasks = [
                        asyncio.create_task(time_it("Extracting title, authors, and abstract", job_id=job_id)(
                            self.extract_title_authors_abstract
                        )(
                            paper_content=paper_content,
                            cache_key=cache_key,
                            status_callback=status_callback,
                            client=client,
                            llm_model=extraction_model,
                        )),
                        asyncio.create_task(time_it("Extracting institutions and keywords", job_id=job_id)(
                            self.extract_institutions_keywords
                        )(
                            paper_content=paper_content,
                            cache_key=cache_key,
                            status_callback=status_callback,
                            client=client,
                            llm_model=extraction_model,
                        )),
                        asyncio.create_task(time_it("Extracting summary and citations", job_id=job_id)(
                            self.extract_summary_and_citations
                        )(
                            paper_content=paper_content,
                            cache_key=cache_key,
                            status_callback=status_callback,
                            client=client,
                            llm_model=extraction_model,
                        )),
                        asyncio.create_task(time_it("Extracting highlights", job_id=job_id)(
                            self.extract_highlights
                        )(
                            paper_content=paper_content,
                            cache_key=cache_key,
                            status_callback=status_callback,
                            client=client,
                            llm_model=extraction_model,
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
                    highlights=getattr(highlights, "highlights", []),
                    publish_date=getattr(title_authors_abstract, "publish_date", None),
                )

            except Exception as e:
                logger.error(f"Error extracting metadata: {e}", exc_info=True)
                if status_callback:
                    status_callback(f"Error during metadata extraction: {e}")
                raise ValueError(f"Failed to extract metadata: {str(e)}")

    async def extract_data_table(
        self,
        columns: List[str],
        file_path: str,
        paper_id: str,
    ) -> DataTableRow:
        """
        Extract structured data table from paper content.

        Args:
            columns: List of column names for the data table
            file_path: The file path to the PDF
        Returns:
            str: JSON string representing the data table
        """
        # Create a fresh client with longer timeout since we're sending full PDFs
        client = self._create_client(timeout=self.PDF_TIMEOUT)

        try:
            # Map each column to a safe field name. User-supplied column names can contain
            # quotes, apostrophes, accents, or spaces (e.g. Italian columns), which become
            # fragile JSON property names that the model struggles to generate correctly.
            aliases: Dict[str, str] = {f"col_{i}": col for i, col in enumerate(columns)}

            cols_str = "\n".join(f'- {alias}: "{col}"' for alias, col in aliases.items())
            prompt = EXTRACT_COLS_INSTRUCTION.format(
                cols_str=cols_str,
                n_cols=len(columns)
            )

            # Create the dynamic schema that matches DataTableRow structure.
            # Each aliased column maps to a DataTableCellValue (value + citations).
            field_definitions: Dict[str, Any] = {
                alias: (DataTableCellValue, Field(description=f"Value and citations for column: {col!r}"))
                for alias, col in aliases.items()
            }

            # Create the values model that enforces all column names as required fields
            ValuesModel = create_model(
                'ValuesModel',
                __config__=ConfigDict(),  # Prevent extra fields
                **field_definitions
            )

            values_instance = await self.generate_structured(
                prompt,
                schema=ValuesModel,
                model=self.default_model,
                file_path=file_path,
                client=client,
            )

            # Map aliased fields back to the original column names.
            values_dict: Dict[str, DataTableCellValue] = {
                col: getattr(values_instance, alias)
                for alias, col in aliases.items()
            }

            # Create and return the DataTableRow
            return DataTableRow(
                paper_id=paper_id,
                values=values_dict
            )
        except Exception as e:
            logger.error(f"Error extracting data table: {str(e)}", exc_info=True)
            raise ValueError(f"Failed to extract DT for paper {paper_id}: {str(e)}")


# Create a single instance to use throughout the application
api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")

if not api_key:
    raise ValueError(
        "GOOGLE_API_KEY or GEMINI_API_KEY environment variable must be set"
    )

llm_client = PaperOperations(api_key=api_key, default_model=DEFAULT_CHAT_MODEL)
fast_llm_client = PaperOperations(api_key=api_key, default_model=FAST_CHAT_MODEL)
