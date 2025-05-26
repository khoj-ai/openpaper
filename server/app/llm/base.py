import logging
from typing import Any, Dict

from app.database.models import Message
from app.llm.citation_handler import CitationHandler
from app.llm.provider import (
    BaseLLMProvider,
    ChatSession,
    GeminiProvider,
    LLMProvider,
    LLMResponse,
    OpenAIProvider,
)
from google.genai.types import Content

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
        self, model: str, history: Any, config: Dict[str, Any]
    ) -> ChatSession:
        """Create a chat session for streaming"""
        return self.provider.create_chat_session(model, history, config)

    # Keep existing methods for backward compatibility
    @property
    def client(self):
        """Backward compatibility - access to underlying client"""
        if self.provider_type == LLMProvider.GEMINI:
            return self.provider.client
        else:
            # For OpenAI, create a wrapper that mimics Gemini API
            return self._create_gemini_compatible_wrapper()

    def _create_gemini_compatible_wrapper(self):
        """Create a wrapper that provides Gemini-like API for other providers"""

        class CompatibilityWrapper:
            def __init__(self, provider):
                self.provider = provider

            @property
            def chats(self):
                return self

            def create(self, model: str, history: Any, config: Dict[str, Any]):
                return self.provider.create_chat_session(model, history, config)

        return CompatibilityWrapper(self.provider)

    def convert_chat_history_to_api_format(
        self,
        messages: list[Message],
    ) -> list[Content]:
        """
        Convert chat history to Chat API format
        """
        api_format = []
        for message in messages:
            references = CitationHandler.format_citations(message.references["citations"]) if message.references else None  # type: ignore

            f_message = (
                f"{message.content}\n\n{references}" if references else message.content
            )

            api_format.append(
                Content(
                    role="user" if message.role == "user" else "model",
                    parts=[{"text": f_message}],  # type: ignore
                )
            )
        return api_format
