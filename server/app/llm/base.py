import logging
from enum import Enum
from typing import Any, Dict, Iterator, List, Optional

from app.database.models import Message
from app.llm.provider import (
    BaseLLMProvider,
    FileContent,
    GeminiProvider,
    LLMProvider,
    LLMResponse,
    MessageParam,
    OpenAIProvider,
    StreamChunk,
)

logger = logging.getLogger(__name__)


class ModelType(Enum):
    DEFAULT = "default"
    FAST = "fast"


class BaseLLMClient:
    """Unified LLM client that supports multiple providers"""

    def __init__(self, default_provider: LLMProvider = LLMProvider.GEMINI):
        self.default_provider = default_provider
        self._providers: Dict[LLMProvider, BaseLLMProvider] = {}

        # Initialize all providers to ensure they are ready for use
        for provider in LLMProvider:
            self._initialize_provider(provider)

    def get_chat_model_options(self) -> Dict[LLMProvider, str]:
        def _get_display_name(model_name: str) -> str:
            """Format model name for display"""
            split_by_dash = model_name.split("-")
            if len(split_by_dash) > 1:
                return "-".join([part.lower() for part in split_by_dash[:2]])
            return model_name.lower()

        """Get available models for each provider"""
        return {
            provider: _get_display_name(
                self._get_model_for_type(ModelType.DEFAULT, provider)
            )
            for provider in self._providers.keys()
        }

    def _initialize_provider(self, provider: LLMProvider) -> None:
        """Initialize a provider if not already done"""
        if provider not in self._providers:
            if provider == LLMProvider.GEMINI:
                self._providers[provider] = GeminiProvider()
            elif provider == LLMProvider.OPENAI:
                self._providers[provider] = OpenAIProvider()
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

    def generate_content(
        self,
        contents: Any,
        model_type: ModelType = ModelType.DEFAULT,
        provider: Optional[LLMProvider] = None,
        **kwargs,
    ) -> LLMResponse:
        """Generate content using the specified provider"""
        model = self._get_model_for_type(model_type, provider)
        return self._get_provider(provider).generate_content(model, contents, **kwargs)

    def send_message_stream(
        self,
        message: MessageParam,
        history: List[Message],
        system_prompt: str,
        file: FileContent | None = None,
        model_type: ModelType = ModelType.DEFAULT,
        provider: Optional[LLMProvider] = None,
        **kwargs,
    ) -> Iterator[StreamChunk]:
        """Send a message and stream the response"""
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
