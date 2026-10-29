import logging
import os
import time
from enum import Enum
from typing import Any, AsyncIterator, Dict, List, Optional, Union

from app.database.models import Message
from app.database.telemetry import track_event
from app.llm.provider import (
    AnthropicProvider,
    BaseLLMProvider,
    FileContent,
    GeminiProvider,
    LLMProvider,
    LLMResponse,
    MessageParam,
    OpenAIProvider,
    StreamChunk,
    ToolCallResult,
    strict_json_schema,
)
from app.llm.utils import is_provider_outage, retry_llm_operation
from langfuse import get_client, observe
from pydantic import BaseModel

logger = logging.getLogger(__name__)


class ModelType(Enum):
    DEFAULT = "default"
    FAST = "fast"


def _fallback_provider_from_env() -> Optional[LLMProvider]:
    """LLM_FALLBACK_PROVIDER names the provider an answer stream is handed to
    when its own provider fails outright. Defaults to OpenAI; set it empty to
    disable the fallback."""
    value = os.getenv("LLM_FALLBACK_PROVIDER", LLMProvider.OPENAI.value).strip()
    return LLMProvider(value.lower()) if value else None


class BaseLLMClient:
    """Unified LLM client that supports multiple providers"""

    def __init__(self, default_provider: LLMProvider = LLMProvider.GEMINI):
        self.default_provider = default_provider
        self.fallback_provider = _fallback_provider_from_env()
        self._providers: Dict[LLMProvider, BaseLLMProvider] = {}

        # Initialize all providers to ensure they are ready for use
        for provider in LLMProvider:
            self._initialize_provider(provider)

    def get_chat_model_options(
        self, exclude: Optional[List[LLMProvider]] = None
    ) -> Dict[LLMProvider, str]:
        def _get_display_name(model_name: str) -> str:
            """Format model name for display"""
            split_by_dash = model_name.split("-")
            if len(split_by_dash) > 1:
                return "-".join([part.lower() for part in split_by_dash[:2]])
            return model_name.lower()

        excluded = set(exclude or [])
        return {
            provider: _get_display_name(
                self._get_model_for_type(ModelType.DEFAULT, provider)
            )
            for provider in self._providers.keys()
            if provider not in excluded
        }

    def _initialize_provider(self, provider: LLMProvider) -> None:
        """Initialize a provider if not already done"""
        if provider not in self._providers:
            if provider == LLMProvider.GEMINI:
                self._providers[provider] = GeminiProvider()
            elif provider == LLMProvider.OPENAI:
                self._providers[provider] = OpenAIProvider()
            elif provider == LLMProvider.ANTHROPIC:
                self._providers[provider] = AnthropicProvider()
            else:
                raise ValueError(f"Unsupported LLM provider: {provider}")

    def _get_provider(self, provider: Optional[LLMProvider] = None) -> BaseLLMProvider:
        """Get the appropriate provider, initializing if necessary"""
        target_provider = provider or self.default_provider

        if target_provider not in self._providers:
            self._initialize_provider(target_provider)

        return self._providers[target_provider]

    def _get_model_for_type(
        self, model_type: ModelType, provider: Optional[LLMProvider] = None
    ) -> str:
        """Get the appropriate model string for the given type and provider"""
        provider_instance = self._get_provider(provider)

        if model_type == ModelType.DEFAULT:
            return provider_instance.get_default_model()
        elif model_type == ModelType.FAST:
            return provider_instance.get_fast_model()
        else:
            raise ValueError(f"Unsupported model type: {model_type}")

    @observe(
        name="generate-content",
        as_type="span",
        capture_input=False,
        capture_output=False,
    )
    def generate_content(
        self,
        contents: Any,
        system_prompt: Optional[str] = None,
        history: Optional[List[Message]] = None,
        function_declarations: Optional[List[Dict]] = None,
        tool_call_results: Optional[List[ToolCallResult]] = None,
        model_type: ModelType = ModelType.DEFAULT,
        provider: Optional[LLMProvider] = None,
        enable_thinking: bool = True,
        schema: Optional[Union[Dict, type[BaseModel]]] = None,
        **kwargs,
    ) -> LLMResponse:
        """Generate content using the specified provider. Automatically retries on transient errors.

        If the provider still fails outright, the same request is handed to
        `fallback_provider`, as send_message_stream does. A failure another
        provider cannot fix is raised as-is (see is_provider_outage).

        Args:
            schema: Optional structured-output schema — a JSON schema dict, or a
                pydantic model class. When provided, the LLM response will be
                constrained to match this schema via the provider's native
                structured output support.
        """

        def generate(target: LLMProvider) -> LLMResponse:
            return self._generate_with(
                target,
                contents,
                system_prompt=system_prompt,
                history=history,
                function_declarations=function_declarations,
                tool_call_results=tool_call_results,
                model_type=model_type,
                enable_thinking=enable_thinking,
                schema=schema,
                **kwargs,
            )

        primary = provider or self.default_provider
        fallback = self.fallback_provider
        try:
            return generate(primary)
        except Exception as e:
            if fallback is None or fallback == primary or not is_provider_outage(e):
                logger.error(
                    f"Error generating content with {primary.value}: {e}",
                    exc_info=True,
                )
                raise
            failure = e

        logger.warning(
            f"{primary.value} generation failed ({type(failure).__name__}: "
            f"{str(failure)[:120]}); generating with {fallback.value} instead"
        )
        track_event(
            "llm_generate_fallback",
            {
                "from_provider": primary.value,
                "to_provider": fallback.value,
                "model_type": model_type.value,
                "error": str(failure)[:200],
            },
        )
        try:
            return generate(fallback)
        except Exception as e:
            logger.error(
                f"Error generating content with {fallback.value}: {e}", exc_info=True
            )
            raise

    @retry_llm_operation(max_retries=3, delay=1.0)
    def _generate_with(
        self,
        target_provider: LLMProvider,
        contents: Any,
        system_prompt: Optional[str],
        history: Optional[List[Message]],
        function_declarations: Optional[List[Dict]],
        tool_call_results: Optional[List[ToolCallResult]],
        model_type: ModelType,
        enable_thinking: bool,
        schema: Optional[Union[Dict, type[BaseModel]]],
        **kwargs,
    ) -> LLMResponse:
        """One provider's attempt at generate_content, retried on transient errors."""
        start_time = time.time()
        model = self._get_model_for_type(model_type, target_provider)

        # Gemini's SDK accepts a pydantic class directly (and handles nested
        # models, which its Schema type can't express as a dict via $refs).
        # The other providers need a JSON schema dict in the strict form their
        # structured outputs require.
        if schema is not None and target_provider != LLMProvider.GEMINI:
            if not isinstance(schema, dict):
                schema = schema.model_json_schema()
            schema = strict_json_schema(schema)
        langfuse = get_client()
        langfuse.update_current_span(
            input={
                "contents": contents,
                "system_prompt": system_prompt,
                "history_length": len(history or []),
                "tool_result_count": len(tool_call_results or []),
            },
            metadata={
                "provider": target_provider.value,
                "model": model,
                "model_type": model_type.value,
            },
        )

        try:
            response = self._get_provider(target_provider).generate_content(
                model,
                contents,
                system_prompt=system_prompt,
                function_declarations=function_declarations,
                tool_call_results=tool_call_results,
                history=history,
                enable_thinking=enable_thinking,
                schema=schema,
                **kwargs,
            )

            end_time = time.time()
            duration_ms = (end_time - start_time) * 1000

            # Track the event with model and timing information
            track_event(
                "llm_generate_content",
                {
                    "model": model,
                    "provider": target_provider.value,
                    "model_type": model_type.value,
                    "duration_ms": duration_ms,
                    "has_function_declarations": function_declarations is not None,
                    "enable_thinking": enable_thinking,
                },
            )

            logger.info(
                f"Generated content using {target_provider.value}/{model} in {duration_ms:.2f}ms"
            )

            langfuse.update_current_span(
                output={
                    "text": response.text,
                    "tool_call_count": len(response.tool_calls),
                }
            )

            return response
        except Exception as e:
            end_time = time.time()
            duration_ms = (end_time - start_time) * 1000

            # Track failures too
            track_event(
                "llm_generate_content_error",
                {
                    "model": model,
                    "provider": target_provider.value,
                    "model_type": model_type.value,
                    "duration_ms": duration_ms,
                    "error": str(e),
                },
            )
            raise

    async def send_message_stream(
        self,
        message: MessageParam,
        history: List[Message],
        system_prompt: str,
        file: FileContent | None = None,
        model_type: ModelType = ModelType.DEFAULT,
        provider: Optional[LLMProvider] = None,
        **kwargs,
    ) -> AsyncIterator[StreamChunk]:
        """Send a message and stream the response.

        Iterate with `async for`. A chunk with `is_restart` set means the
        answer streamed so far has been abandoned and a complete replacement
        follows: either the provider re-sent a dropped request, or it failed
        outright and the same request was handed to `fallback_provider`. A
        failure another provider cannot fix — a stable content block, a
        malformed request, a bug — is raised as-is (see is_provider_outage).
        """
        target = provider or self.default_provider
        fallback = self.fallback_provider
        emitted = False
        failure: Exception
        try:
            async for chunk in self._stream(
                target, message, history, system_prompt, file, model_type, **kwargs
            ):
                emitted = True
                yield chunk
            return
        except Exception as e:
            if fallback is None or fallback == target or not is_provider_outage(e):
                raise
            failure = e

        logger.warning(
            f"{target.value} answer stream failed ({type(failure).__name__}: "
            f"{str(failure)[:120]}); answering with {fallback.value} instead"
        )
        track_event(
            "llm_stream_fallback",
            {
                "from_provider": target.value,
                "to_provider": fallback.value,
                "model_type": model_type.value,
                "error": str(failure)[:200],
                "had_emitted": emitted,
            },
        )
        if emitted:
            yield StreamChunk(
                text="",
                model=self._get_model_for_type(model_type, fallback),
                provider=fallback,
                is_restart=True,
            )
        async for chunk in self._stream(
            fallback, message, history, system_prompt, file, model_type, **kwargs
        ):
            yield chunk

    def _stream(
        self,
        provider: LLMProvider,
        message: MessageParam,
        history: List[Message],
        system_prompt: str,
        file: FileContent | None,
        model_type: ModelType,
        **kwargs,
    ) -> AsyncIterator[StreamChunk]:
        model = self._get_model_for_type(model_type, provider)
        return self._get_provider(provider).send_message_stream(
            model, message, history, system_prompt, file, **kwargs
        )

    # Convenience properties for backward compatibility
    @property
    def default_model(self) -> str:
        return self._get_model_for_type(ModelType.DEFAULT)

    @property
    def fast_model(self) -> str:
        return self._get_model_for_type(ModelType.FAST)
