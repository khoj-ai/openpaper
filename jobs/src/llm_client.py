"""
Provider-aware LLM client for jobs metadata extraction.
"""
import asyncio
import base64
import io
import json
import logging
import os
import random
import re
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional, Type, TypeVar

import httpx
from google import genai
from google.genai import types
from google.genai.errors import APIError, ClientError, ServerError
from openai import APIConnectionError, APIError as OpenAIAPIError
from openai import APITimeoutError, AsyncOpenAI, RateLimitError
from pydantic import BaseModel, ConfigDict, Field, create_model

from src.llm_config import LLMProvider, RoutingTask, get_llm_routing_config
from src.prompts import (
    EXTRACT_COLS_INSTRUCTION,
    EXTRACT_METADATA_PROMPT_TEMPLATE,
    SYSTEM_INSTRUCTIONS_CACHE,
)
from src.schemas import (
    DataTableCellValue,
    DataTableRow,
    Highlights,
    InstitutionsKeywords,
    PaperMetadataExtraction,
    SummaryAndCitations,
    TitleAuthorsAbstract,
)
from src.utils import retry_llm_operation, time_it

logger = logging.getLogger(__name__)

CACHE_TTL_SECONDS = 3600

T = TypeVar("T", bound=BaseModel)


def _normalize_openai_json_schema(
    schema: dict[str, Any], provider_type: str
) -> dict[str, Any]:
    """Normalize schemas for providers with stricter JSON schema validation."""
    if provider_type != "openai_compatible":
        return schema

    def normalize(node: Any) -> Any:
        if isinstance(node, dict):
            normalized = {key: normalize(value) for key, value in node.items()}

            if "$ref" in normalized:
                return {"$ref": normalized["$ref"]}

            if normalized.get("type") == "object":
                properties = normalized.get("properties")
                if isinstance(properties, dict):
                    normalized["properties"] = {
                        key: normalize(value) for key, value in properties.items()
                    }
                    normalized["required"] = list(normalized["properties"].keys())
                normalized["additionalProperties"] = False

            return normalized

        if isinstance(node, list):
            return [normalize(value) for value in node]

        return node

    return normalize(schema)

@dataclass(frozen=True)
class ProviderConfig:
    provider_key: str
    provider: Optional[LLMProvider]
    provider_type: str
    api_key: str
    default_model: str
    fast_model: str
    base_url: Optional[str] = None

def _parse_builtin_provider(provider_key: str) -> Optional[LLMProvider]:
    for provider in LLMProvider:
        if provider.value == provider_key:
            return provider
    return None


def _get_provider_config(provider_key: str) -> ProviderConfig:
    routing_config = get_llm_routing_config()
    provider_config = routing_config.providers.get(provider_key)
    if provider_config is None:
        raise ValueError(f"Unsupported LLM provider: {provider_key}")

    api_key = os.getenv(provider_config.api_key_env or "")
    if provider_key == LLMProvider.GEMINI.value and not api_key:
        api_key = os.getenv("GOOGLE_API_KEY", "")

    if not api_key:
        raise ValueError(
            f"Provider '{provider_key}' is not configured. Missing env var '{provider_config.api_key_env}'."
        )

    return ProviderConfig(
        provider_key=provider_key,
        provider=_parse_builtin_provider(provider_key),
        provider_type=provider_config.provider_type,
        api_key=api_key,
        default_model=provider_config.default_model,
        fast_model=provider_config.fast_model,
        base_url=provider_config.base_url,
    )


class JSONParser:
    @staticmethod
    def validate_and_extract_json(json_data: str) -> dict:
        """Extract and validate JSON data from various formats."""
        if not json_data or not isinstance(json_data, str):
            raise ValueError("Invalid input: empty or non-string data")

        json_data = json_data.strip()

        try:
            return json.loads(json_data)
        except json.JSONDecodeError:
            pass

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
    DEFAULT_TIMEOUT = 40.0
    PDF_TIMEOUT = 120.0

    def __init__(
        self,
        provider_config: ProviderConfig,
        default_model: Optional[str] = None,
    ):
        self.provider_config = provider_config
        self.provider_key = provider_config.provider_key
        self.provider = provider_config.provider
        self.provider_type = provider_config.provider_type
        self.api_key = provider_config.api_key
        self.base_url = provider_config.base_url
        self.default_model = default_model or provider_config.default_model

    def _create_client(
        self, timeout: float = DEFAULT_TIMEOUT
    ) -> genai.Client | AsyncOpenAI:
        if self.provider_key == LLMProvider.GEMINI.value:
            return genai.Client(
                api_key=self.api_key,
                http_options=types.HttpOptions(timeout=int(timeout * 1000)),
            )

        return AsyncOpenAI(
            api_key=self.api_key,
            base_url=self.base_url,
            timeout=timeout,
        )

    async def create_cache(
        self, cache_content: str, client: genai.Client | AsyncOpenAI
    ) -> Optional[str]:
        """Create a cache entry when the active provider supports it."""
        if self.provider_key != LLMProvider.GEMINI.value:
            return None

        assert isinstance(client, genai.Client)
        cached_content = await client.aio.caches.create(
            model=self.default_model,
            config=types.CreateCachedContentConfig(
                contents=types.Content(
                    role="user",
                    parts=[
                        types.Part.from_text(text=cache_content),
                        types.Part.from_text(text=SYSTEM_INSTRUCTIONS_CACHE),
                    ],
                ),
                display_name="Paper Metadata Cache",
                ttl=f"{CACHE_TTL_SECONDS}s",
            ),
        )

        if cached_content and cached_content.name:
            logger.info("Cache created successfully: %s", cached_content.name)
            return cached_content.name

        raise ValueError("Cache creation failed")

    async def create_file_cache(
        self,
        file_path: str,
        client: genai.Client | AsyncOpenAI,
        system_instructions: Optional[str] = None,
    ) -> Optional[str]:
        """Create a file-backed cache when the active provider supports it."""
        if self.provider_key != LLMProvider.GEMINI.value:
            return None

        assert isinstance(client, genai.Client)
        with open(file_path, "rb") as f:
            file_content = f.read()

        document = await client.aio.files.upload(
            file=io.BytesIO(file_content),
            config=types.UploadFileConfig(mime_type="application/pdf"),
        )

        cached_content = await client.aio.caches.create(
            model=self.default_model,
            config=types.CreateCachedContentConfig(
                contents=document,
                display_name="Paper Metadata Cache",
                ttl=f"{CACHE_TTL_SECONDS}s",
                system_instruction=system_instructions or SYSTEM_INSTRUCTIONS_CACHE,
            ),
        )

        if cached_content and cached_content.name:
            logger.info("File cache created successfully: %s", cached_content.name)
            return cached_content.name

        raise ValueError("Cache creation failed")

    def _build_openai_content_parts(
        self,
        prompt: str,
        image_bytes: Optional[bytes] = None,
        image_mime_type: Optional[str] = None,
        file_path: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        parts: list[dict[str, Any]] = []

        if image_bytes:
            base64_image = base64.b64encode(image_bytes).decode("utf-8")
            mime_type = image_mime_type or "image/png"
            parts.append(
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:{mime_type};base64,{base64_image}"},
                }
            )

        if file_path:
            with open(file_path, "rb") as f:
                file_data = base64.b64encode(f.read()).decode("utf-8")
            parts.append(
                {
                    "type": "file",
                    "file": {
                        "filename": os.path.basename(file_path),
                        "file_data": f"data:application/pdf;base64,{file_data}",
                    },
                }
            )

        parts.append({"type": "text", "text": prompt})
        return parts

    async def _generate_with_gemini(
        self,
        prompt: str,
        client: genai.Client,
        image_bytes: Optional[bytes] = None,
        image_mime_type: Optional[str] = None,
        cache_key: Optional[str] = None,
        model: Optional[str] = None,
        schema: Optional[Type[BaseModel]] = None,
        file_path: Optional[str] = None,
        max_retries: int = 3,
        base_delay: float = 1.0,
    ) -> str:
        target_model = model or self.default_model
        parts: list[types.Part] = []

        if image_bytes:
            parts.append(
                types.Part.from_bytes(
                    data=image_bytes,
                    mime_type=image_mime_type or "image/png",
                )
            )

        if file_path:
            with open(file_path, "rb") as f:
                parts.append(
                    types.Part.from_bytes(
                        data=f.read(),
                        mime_type="application/pdf",
                    )
                )

        parts.append(types.Part.from_text(text=prompt))

        config = types.GenerateContentConfig(cached_content=cache_key)
        if schema:
            config.response_mime_type = "application/json"
            config.response_schema = schema.model_json_schema()

        last_exception: Optional[Exception] = None
        for attempt in range(max_retries + 1):
            try:
                response = await client.aio.models.generate_content(
                    model=target_model,
                    contents=types.Content(role="user", parts=parts),
                    config=config,
                )

                if response and response.text:
                    return response.text

                raise ValueError("No content generated from LLM response")
            except (
                ServerError,
                ClientError,
                APIError,
                httpx.TimeoutException,
            ) as e:
                last_exception = e
                if attempt < max_retries:
                    backoff_time = base_delay * (2**attempt) * (
                        0.5 + 0.5 * random.random()
                    )
                    logger.warning(
                        "Gemini API error (attempt %s/%s): %s. Retrying in %.2fs",
                        attempt + 1,
                        max_retries + 1,
                        e,
                        backoff_time,
                    )
                    await asyncio.sleep(backoff_time)
                else:
                    logger.error(
                        "All %s Gemini attempts failed for generate_content: %s",
                        max_retries + 1,
                        e,
                    )

        raise last_exception or ValueError(
            "Failed to generate content after all retries"
        )

    async def _generate_with_openai_compatible(
        self,
        prompt: str,
        client: AsyncOpenAI,
        image_bytes: Optional[bytes] = None,
        image_mime_type: Optional[str] = None,
        model: Optional[str] = None,
        schema: Optional[Type[BaseModel]] = None,
        file_path: Optional[str] = None,
        max_retries: int = 3,
        base_delay: float = 1.0,
    ) -> str:
        target_model = model or self.default_model
        content_parts = self._build_openai_content_parts(
            prompt=prompt,
            image_bytes=image_bytes,
            image_mime_type=image_mime_type,
            file_path=file_path,
        )

        request_kwargs: dict[str, Any] = {}
        if schema:
            normalized_schema = _normalize_openai_json_schema(
                schema.model_json_schema(),
                self.provider_type,
            )
            request_kwargs["response_format"] = {
                "type": "json_schema",
                "json_schema": {
                    "name": "structured_response",
                    "strict": True,
                    "schema": normalized_schema,
                },
            }

        last_exception: Optional[Exception] = None
        for attempt in range(max_retries + 1):
            try:
                response = await client.chat.completions.create(
                    model=target_model,
                    messages=[{"role": "user", "content": content_parts}],
                    **request_kwargs,
                )

                if response.choices and response.choices[0].message.content:
                    return response.choices[0].message.content

                raise ValueError("No content generated from LLM response")
            except (
                OpenAIAPIError,
                APIConnectionError,
                APITimeoutError,
                RateLimitError,
                httpx.TimeoutException,
            ) as e:
                last_exception = e
                if attempt < max_retries:
                    backoff_time = base_delay * (2**attempt) * (
                        0.5 + 0.5 * random.random()
                    )
                    logger.warning(
                        "%s API error (attempt %s/%s): %s. Retrying in %.2fs",
                        self.provider_key,
                        attempt + 1,
                        max_retries + 1,
                        e,
                        backoff_time,
                    )
                    await asyncio.sleep(backoff_time)
                else:
                    logger.error(
                        "All %s attempts failed for %s generate_content: %s",
                        max_retries + 1,
                        self.provider_key,
                        e,
                    )

        raise last_exception or ValueError(
            "Failed to generate content after all retries"
        )

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
        client: Optional[genai.Client | AsyncOpenAI] = None,
    ) -> str:
        if client is None:
            raise ValueError("Client is required for generate_content")

        if self.provider_key == LLMProvider.GEMINI.value:
            assert isinstance(client, genai.Client)
            return await self._generate_with_gemini(
                prompt=prompt,
                client=client,
                image_bytes=image_bytes,
                image_mime_type=image_mime_type,
                cache_key=cache_key,
                model=model,
                schema=schema,
                file_path=file_path,
                max_retries=max_retries,
                base_delay=base_delay,
            )

        assert isinstance(client, AsyncOpenAI)
        return await self._generate_with_openai_compatible(
            prompt=prompt,
            client=client,
            image_bytes=image_bytes,
            image_mime_type=image_mime_type,
            model=model,
            schema=schema,
            file_path=file_path,
            max_retries=max_retries,
            base_delay=base_delay,
        )


class PaperOperations(AsyncLLMClient):
    """LLM operations used by the jobs service."""

    async def _extract_single_metadata_field(
        self,
        model: Type[T],
        paper_content: str,
        schema: Type[BaseModel],
        status_callback: Callable[[str], None],
        client: genai.Client | AsyncOpenAI,
        cache_key: Optional[str] = None,
    ) -> T:
        prompt = EXTRACT_METADATA_PROMPT_TEMPLATE.format()

        if paper_content and not cache_key:
            prompt = f"Paper Content:\n\n{paper_content}\n\n{prompt}"

        response = await self.generate_content(
            prompt,
            cache_key=cache_key,
            schema=schema,
            client=client,
        )
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
                status_callback(f"Building on {first_keyword} context")
            elif institutions:
                first_institution = institutions[0] if institutions else ""
                status_callback(f"Adding context from institution: {first_institution}")
            else:
                status_callback("Processing without keyword data")
        elif model == Highlights:
            highlights = getattr(instance, "highlights", [])
            if highlights:
                status_callback(f"Formulated {len(highlights)} annotations")
            else:
                status_callback("No annotations extracted")
        elif model == TitleAuthorsAbstract:
            title = getattr(instance, "title", "")
            status_callback(f"Reading {title if title else 'untitled paper'}")
        else:
            status_callback(f"Successfully extracted {model.__name__}")

        return instance

    @retry_llm_operation(max_retries=3, delay=1.0)
    async def extract_title_authors_abstract(
        self,
        paper_content: str,
        status_callback: Callable[[str], None],
        client: genai.Client | AsyncOpenAI,
        cache_key: Optional[str] = None,
    ) -> TitleAuthorsAbstract:
        return await self._extract_single_metadata_field(
            model=TitleAuthorsAbstract,
            cache_key=cache_key,
            schema=TitleAuthorsAbstract,
            paper_content=paper_content,
            status_callback=status_callback,
            client=client,
        )

    @retry_llm_operation(max_retries=3, delay=1.0)
    async def extract_institutions_keywords(
        self,
        paper_content: str,
        status_callback: Callable[[str], None],
        client: genai.Client | AsyncOpenAI,
        cache_key: Optional[str] = None,
    ) -> InstitutionsKeywords:
        return await self._extract_single_metadata_field(
            model=InstitutionsKeywords,
            cache_key=cache_key,
            schema=InstitutionsKeywords,
            paper_content=paper_content,
            status_callback=status_callback,
            client=client,
        )

    @retry_llm_operation(max_retries=3, delay=1.0)
    async def extract_summary_and_citations(
        self,
        paper_content: str,
        status_callback: Callable[[str], None],
        client: genai.Client | AsyncOpenAI,
        cache_key: Optional[str] = None,
    ) -> SummaryAndCitations:
        return await self._extract_single_metadata_field(
            model=SummaryAndCitations,
            cache_key=cache_key,
            schema=SummaryAndCitations,
            paper_content=paper_content,
            status_callback=status_callback,
            client=client,
        )

    @retry_llm_operation(max_retries=3, delay=1.0)
    async def extract_highlights(
        self,
        paper_content: str,
        status_callback: Callable[[str], None],
        client: genai.Client | AsyncOpenAI,
        cache_key: Optional[str] = None,
    ) -> Highlights:
        return await self._extract_single_metadata_field(
            model=Highlights,
            paper_content=paper_content,
            status_callback=status_callback,
            cache_key=cache_key,
            schema=Highlights,
            client=client,
        )

    async def extract_paper_metadata(
        self,
        paper_content: str,
        job_id: str,
        status_callback: Optional[Callable[[str], None]] = None,
    ) -> PaperMetadataExtraction:
        async with time_it("Extracting paper metadata from LLM", job_id=job_id):
            client = self._create_client()

            try:
                cache_key: Optional[str] = None
                if self.provider_key == LLMProvider.GEMINI.value:
                    try:
                        async with time_it(
                            "Creating cache for paper content", job_id=job_id
                        ):
                            cache_key = await self.create_cache(paper_content, client)
                    except Exception as e:
                        logger.error("Failed to create cache: %s", e, exc_info=True)

                async with time_it(
                    "Running all metadata extraction tasks concurrently", job_id=job_id
                ):
                    tasks = [
                        asyncio.create_task(
                            time_it(
                                "Extracting title, authors, and abstract", job_id=job_id
                            )(self.extract_title_authors_abstract)(
                                paper_content=paper_content,
                                cache_key=cache_key,
                                status_callback=status_callback,
                                client=client,
                            )
                        ),
                        asyncio.create_task(
                            time_it(
                                "Extracting institutions and keywords", job_id=job_id
                            )(self.extract_institutions_keywords)(
                                paper_content=paper_content,
                                cache_key=cache_key,
                                status_callback=status_callback,
                                client=client,
                            )
                        ),
                        asyncio.create_task(
                            time_it(
                                "Extracting summary and citations", job_id=job_id
                            )(self.extract_summary_and_citations)(
                                paper_content=paper_content,
                                cache_key=cache_key,
                                status_callback=status_callback,
                                client=client,
                            )
                        ),
                        asyncio.create_task(
                            time_it("Extracting highlights", job_id=job_id)(
                                self.extract_highlights
                            )(
                                paper_content=paper_content,
                                cache_key=cache_key,
                                status_callback=status_callback,
                                client=client,
                            )
                        ),
                    ]

                    results = await asyncio.gather(
                        *[asyncio.shield(task) for task in tasks],
                        return_exceptions=True,
                    )

                (
                    title_authors_abstract,
                    institutions_keywords,
                    summary_and_citations,
                    highlights,
                ) = results

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
                logger.error("Error extracting metadata: %s", e, exc_info=True)
                if status_callback:
                    status_callback(f"Error during metadata extraction: {e}")
                raise ValueError(f"Failed to extract metadata: {str(e)}")

    async def extract_data_table(
        self,
        columns: List[str],
        file_path: str,
        paper_id: str,
    ) -> DataTableRow:
        client = self._create_client(timeout=self.PDF_TIMEOUT)

        try:
            cols_str = "\n".join(f"- {col}" for col in columns)
            prompt = EXTRACT_COLS_INSTRUCTION.format(
                cols_str=cols_str,
                n_cols=len(columns),
            )

            field_definitions: Dict[str, Any] = {
                col: (
                    DataTableCellValue,
                    Field(description=f"Value and citations for column '{col}'"),
                )
                for col in columns
            }

            ValuesModel = create_model(
                "ValuesModel",
                __config__=ConfigDict(),
                **field_definitions,
            )

            response = await self.generate_content(
                prompt,
                model=self.default_model,
                file_path=file_path,
                schema=ValuesModel,
                client=client,
            )

            response_json = JSONParser.validate_and_extract_json(response)
            values_instance = ValuesModel.model_validate(response_json)
            values_dict: Dict[str, DataTableCellValue] = {
                col: getattr(values_instance, col) for col in columns
            }

            return DataTableRow(paper_id=paper_id, values=values_dict)
        except Exception as e:
            logger.error("Error extracting data table: %s", str(e), exc_info=True)
            raise ValueError(f"Failed to extract DT for paper {paper_id}: {str(e)}")


routing_config = get_llm_routing_config()
provider_config = _get_provider_config(
    routing_config.routing[RoutingTask.METADATA_EXTRACTION].primary
    if RoutingTask.METADATA_EXTRACTION in routing_config.routing
    else routing_config.default_provider
)
fast_provider_config = _get_provider_config(
    routing_config.routing[RoutingTask.DATA_TABLE_EXTRACTION].primary
    if RoutingTask.DATA_TABLE_EXTRACTION in routing_config.routing
    else routing_config.default_provider
)

llm_client = PaperOperations(
    provider_config=provider_config,
    default_model=provider_config.default_model,
)
fast_llm_client = PaperOperations(
    provider_config=fast_provider_config,
    default_model=fast_provider_config.fast_model,
)
