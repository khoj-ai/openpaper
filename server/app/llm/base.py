import logging
from typing import Any, Dict

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


class BaseLLMClient:
    """Unified LLM client that supports multiple providers"""

    def __init__(self, provider: LLMProvider = LLMProvider.GEMINI):
        self.provider_type = provider
        self.provider: BaseLLMProvider = self._create_provider(provider)

    def _create_provider(self, provider: LLMProvider) -> BaseLLMProvider:
        """Factory method to create the appropriate provider"""
        if provider == LLMProvider.GEMINI:
            return GeminiProvider()
        elif provider == LLMProvider.OPENAI:
            return OpenAIProvider()
        else:
            raise ValueError(f"Unsupported LLM provider: {provider}")

    @property
    def default_model(self) -> str:
        return self.provider.get_default_model()

    @property
    def fast_model(self) -> str:
        return self.provider.get_fast_model()

    def generate_content(self, model: str, contents: Any, **kwargs) -> LLMResponse:
        """Generate content using the configured provider"""
        return self.provider.generate_content(model, contents, **kwargs)

    def create_chat_session(
        self, model: str, history: list[Message], config: Dict[str, Any]
    ) -> ChatSession:
        """Create a chat session for streaming"""
        return self.provider.create_chat_session(model, history, config)
