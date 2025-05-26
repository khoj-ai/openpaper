import logging
from enum import Enum
from typing import Any, Dict, Optional

from app.database.models import Message
from app.llm.provider import (
    BaseLLMProvider,
    ChatSession,
    GeminiProvider,
    LLMProvider,
    LLMResponse,
    OpenAIProvider,
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

        # Initialize providers lazily to avoid unnecessary API key requirements
        self._initialize_provider(default_provider)

    def get_model_options(self) -> Dict[LLMProvider, Dict[str, str]]:
        """Get available models for each provider"""
        return {
            provider: {
                "default": self._get_model_for_type(ModelType.DEFAULT, provider),
                "fast": self._get_model_for_type(ModelType.FAST, provider),
            }
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

    def create_chat_session(
        self,
        history: list[Message],
        config: Dict[str, Any],
        model_type: ModelType = ModelType.DEFAULT,
        provider: Optional[LLMProvider] = None,
    ) -> ChatSession:
        """Create a chat session for streaming with the specified provider and model type"""
        model = self._get_model_for_type(model_type, provider)
        return self._get_provider(provider).create_chat_session(model, history, config)

    # Convenience properties for backward compatibility
    @property
    def default_model(self) -> str:
        return self._get_model_for_type(ModelType.DEFAULT)

    @property
    def fast_model(self) -> str:
        return self._get_model_for_type(ModelType.FAST)
