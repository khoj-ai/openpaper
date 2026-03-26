import logging
import os
import time
from enum import Enum
from typing import Any, Dict, Iterator, List, Optional

from app.database.models import Message
from app.database.telemetry import track_event
from app.llm.provider import (
    BaseLLMProvider,
    FileContent,
    GeminiProvider,
    LLMProvider,
    LLMResponse,
    MessageParam,
    OpenAIProvider,
    StreamChunk,
    ToolCallResult,
)
from app.llm.routing_config import RoutingTask, get_llm_routing_config
from app.llm.utils import retry_llm_operation

logger = logging.getLogger(__name__)


class ModelType(Enum):
    DEFAULT = "default"
    FAST = "fast"


class BaseLLMClient:
    """Unified LLM client that supports multiple providers"""

    def __init__(self, default_provider: Optional[LLMProvider] = None):
        self._providers: Dict[str, BaseLLMProvider] = {}
        self._routing_config = get_llm_routing_config()
        self._configured_provider_keys = self._discover_configured_provider_keys()
        explicit_provider_key = default_provider.value if default_provider else None
        self.default_provider_key = self._resolve_default_provider_key(explicit_provider_key)
        self.default_provider = self._parse_builtin_provider_name(self.default_provider_key)

    def _discover_configured_provider_keys(self) -> list[str]:
        configured: list[str] = []
        for provider_key, provider_config in self._routing_config.providers.items():
            if not provider_config.enabled:
                continue
            if provider_config.provider_type == "builtin":
                if provider_config.api_key_env and os.getenv(provider_config.api_key_env):
                    configured.append(provider_key)
            elif provider_config.provider_type == "openai_compatible":
                if provider_config.api_key_env and os.getenv(provider_config.api_key_env):
                    configured.append(provider_key)
        return configured

    def _parse_builtin_provider_name(
        self, provider_name: Optional[str]
    ) -> Optional[LLMProvider]:
        if not provider_name:
            return None

        normalized_name = provider_name.strip().lower()
        for provider in LLMProvider:
            if provider.value == normalized_name:
                return provider

        return None

    def _resolve_default_provider_key(self, explicit_provider_key: Optional[str]) -> str:
        if explicit_provider_key is not None:
            return explicit_provider_key

        env_provider = os.getenv("LLM_DEFAULT_PROVIDER")
        if env_provider:
            return env_provider.strip().lower()

        if self._configured_provider_keys:
            return self._configured_provider_keys[0]

        return self._routing_config.default_provider

    def get_chat_model_options(self) -> Dict[str, str]:
        def _get_display_name(model_name: str) -> str:
            """Format model name for display"""
            split_by_dash = model_name.split("-")
            if len(split_by_dash) > 1:
                return "-".join([part.lower() for part in split_by_dash[:2]])
            return model_name.lower()

        available_models: Dict[str, str] = {}
        for provider_key in self.get_available_provider_keys():
            if self._parse_builtin_provider_name(provider_key) is None:
                continue
            try:
                available_models[provider_key] = _get_display_name(
                    self._get_model_for_type(ModelType.DEFAULT, provider_key=provider_key)
                )
            except Exception as exc:
                logger.warning(
                    "Skipping unavailable LLM provider %s while building model options: %s",
                    provider_key,
                    exc,
                )

        return available_models

    def get_available_provider_keys(self) -> list[str]:
        if self._configured_provider_keys:
            return list(self._configured_provider_keys)
        return [self.default_provider_key]

    def _initialize_provider(self, provider_key: str) -> None:
        """Initialize a provider if not already done"""
        if provider_key in self._providers:
            return

        provider_config = self._routing_config.providers.get(provider_key)
        if provider_config is None:
            raise ValueError(f"Unsupported LLM provider: {provider_key}")

        builtin_provider = self._parse_builtin_provider_name(provider_key)
        if builtin_provider == LLMProvider.GEMINI:
            self._providers[provider_key] = GeminiProvider()
            return

        if provider_config.provider_type not in {"builtin", "openai_compatible"}:
            raise ValueError(
                f"Unsupported provider type '{provider_config.provider_type}' for provider '{provider_key}'"
            )

        api_key = os.getenv(provider_config.api_key_env or "")
        if not api_key:
            raise ValueError(
                f"Provider '{provider_key}' is not configured. Missing env var '{provider_config.api_key_env}'."
            )

        self._providers[provider_key] = OpenAIProvider(
            api_key=api_key,
            base_url=provider_config.base_url,
            default_model=provider_config.default_model,
            fast_model=provider_config.fast_model,
            provider_type=provider_config.provider_type,
        )

    def _get_provider(
        self,
        provider: Optional[LLMProvider] = None,
        provider_key: Optional[str] = None,
    ) -> BaseLLMProvider:
        target_provider_key = provider_key or (
            provider.value if provider else self.default_provider_key
        )

        if (
            self._configured_provider_keys
            and target_provider_key not in self._configured_provider_keys
        ):
            configured = ", ".join(self._configured_provider_keys)
            raise ValueError(
                f"LLM provider '{target_provider_key}' is not configured. "
                f"Configured providers: {configured}"
            )

        if target_provider_key not in self._providers:
            self._initialize_provider(target_provider_key)

        return self._providers[target_provider_key]

    def _get_model_for_type(
        self,
        model_type: ModelType,
        provider: Optional[LLMProvider] = None,
        provider_key: Optional[str] = None,
    ) -> str:
        provider_instance = self._get_provider(provider, provider_key)

        if model_type == ModelType.DEFAULT:
            return provider_instance.get_default_model()
        elif model_type == ModelType.FAST:
            return provider_instance.get_fast_model()
        else:
            raise ValueError(f"Unsupported model type: {model_type}")

    @retry_llm_operation(max_retries=3, delay=1.0)
    def generate_content(
        self,
        contents: Any,
        system_prompt: Optional[str] = None,
        history: Optional[List[Message]] = None,
        function_declarations: Optional[List[Dict]] = None,
        tool_call_results: Optional[List[ToolCallResult]] = None,
        model_type: ModelType = ModelType.DEFAULT,
        provider: Optional[LLMProvider] = None,
        provider_key: Optional[str] = None,
        enable_thinking: bool = True,
        schema: Optional[Dict] = None,
        **kwargs,
    ) -> LLMResponse:
        """Generate content using the specified provider. Automatically retries on transient errors.

        Args:
            schema: Optional JSON schema dict for structured output. When provided,
                the LLM response will be constrained to match this schema via
                the provider's native structured output support.
        """
        start_time = time.time()
        resolved_provider_key = provider_key or (
            provider.value if provider else self.default_provider_key
        )
        model = self._get_model_for_type(
            model_type,
            provider=provider,
            provider_key=provider_key,
        )

        try:
            response = self._get_provider(
                provider=provider, provider_key=provider_key
            ).generate_content(
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
                    "provider": resolved_provider_key,
                    "model_type": model_type.value,
                    "duration_ms": duration_ms,
                    "has_function_declarations": function_declarations is not None,
                    "enable_thinking": enable_thinking,
                },
            )

            logger.info(
                f"Generated content using {resolved_provider_key}/{model} in {duration_ms:.2f}ms"
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
                    "provider": resolved_provider_key,
                    "model_type": model_type.value,
                    "duration_ms": duration_ms,
                    "error": str(e),
                },
            )

            logger.error(
                f"Error generating content with {resolved_provider_key}/{model}: {e}"
            )
            raise

    def send_message_stream(
        self,
        message: MessageParam,
        history: List[Message],
        system_prompt: str,
        file: FileContent | None = None,
        model_type: ModelType = ModelType.DEFAULT,
        provider: Optional[LLMProvider] = None,
        provider_key: Optional[str] = None,
        **kwargs,
    ) -> Iterator[StreamChunk]:
        """Send a message and stream the response"""
        model = self._get_model_for_type(
            model_type, provider=provider, provider_key=provider_key
        )
        return self._get_provider(
            provider=provider, provider_key=provider_key
        ).send_message_stream(
            model, message, history, system_prompt, file, **kwargs
        )

    # Convenience properties for backward compatibility
    @property
    def default_model(self) -> str:
        return self._get_model_for_type(ModelType.DEFAULT, provider_key=self.default_provider_key)

    @property
    def fast_model(self) -> str:
        return self._get_model_for_type(ModelType.FAST, provider_key=self.default_provider_key)

    def get_route_provider_key(
        self,
        task: RoutingTask,
        manual_provider: Optional[LLMProvider] = None,
    ) -> str:
        if (
            manual_provider is not None
            and self._routing_config.allow_manual_override
        ):
            return manual_provider.value

        route = self._routing_config.routing.get(task)
        if route and route.primary in self.get_available_provider_keys():
            return route.primary

        if self.default_provider_key in self.get_available_provider_keys():
            return self.default_provider_key

        available = self.get_available_provider_keys()
        if available:
            return available[0]

        return self.default_provider_key
