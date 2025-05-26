import base64
import logging
import os
from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum
from typing import Any, Dict, Iterator, List, Literal, Optional, Union

import openai
from app.database.models import Message
from google import genai
from google.genai.types import Content, GenerateContentConfig
from openai.types.chat import (
    ChatCompletionAssistantMessageParam,
    ChatCompletionMessageParam,
    ChatCompletionSystemMessageParam,
    ChatCompletionUserMessageParam,
)

logger = logging.getLogger(__name__)


class LLMProvider(Enum):
    GEMINI = "gemini"
    OPENAI = "openai"


class LLMResponse:
    """Standardized response format across all LLM providers"""

    def __init__(self, text: str, model: str, provider: LLMProvider):
        self.text = text
        self.model = model
        self.provider = provider


class StreamChunk:
    """Standardized streaming chunk format across all LLM providers"""

    def __init__(
        self, text: str, model: str, provider: LLMProvider, is_done: bool = False
    ):
        self.text = text
        self.model = model
        self.provider = provider
        self.is_done = is_done


class ChatSession:
    """Abstract chat session wrapper"""

    def __init__(self, provider: "BaseLLMProvider", session: Any, model: str):
        self.provider = provider
        self.session = session
        self.model = model

    def send_message_stream(self, message: Any, **kwargs) -> Iterator[StreamChunk]:
        """Send a message and get streaming response"""
        return self.provider.send_message_stream(
            self.session, self.model, message, **kwargs
        )


@dataclass
class TextContent:
    text: str
    type: Literal["text"] = "text"


@dataclass
class FileContent:
    data: bytes
    mime_type: str
    filename: Optional[str] = None
    type: Literal["file"] = "file"


# Union type for all content types
MessageContent = Union[TextContent, FileContent]
MessageParam = Union[str, List[MessageContent]]


class BaseLLMProvider(ABC):
    """Abstract base class for LLM providers"""

    @property
    @abstractmethod
    def client(self) -> Any:
        """Get the underlying client for this provider"""
        pass

    @abstractmethod
    def generate_content(self, model: str, contents: str, **kwargs) -> LLMResponse:
        """Generate content using the provider's API"""
        pass

    @abstractmethod
    def create_chat_session(
        self, model: str, history: Any, config: Dict[str, Any]
    ) -> ChatSession:
        """Create a chat session for streaming"""
        pass

    @abstractmethod
    def send_message_stream(
        self, session: Any, model: str, message: Any, **kwargs
    ) -> Iterator[StreamChunk]:
        """Send a streaming message"""
        pass

    @abstractmethod
    def get_default_model(self) -> str:
        """Get the default model for this provider"""
        pass

    @abstractmethod
    def get_fast_model(self) -> str:
        """Get the fast model for this provider"""
        pass

    @abstractmethod
    def _convert_message_content(self, content: MessageParam) -> Any:
        """Convert generic message content to provider-specific format"""
        pass


class GeminiProvider(BaseLLMProvider):
    """Gemini LLM provider implementation"""

    def __init__(self):
        self.api_key = os.getenv("GEMINI_API_KEY")
        if not self.api_key:
            raise ValueError("GEMINI_API_KEY environment variable is required")

        self._client = genai.Client(api_key=self.api_key)
        self._default_model = "gemini-2.5-pro-preview-03-25"
        self._fast_model = "gemini-2.5-flash-preview-04-17"

    @property
    def client(self) -> genai.Client:
        return self._client

    def generate_content(self, model: str, contents: str, **kwargs) -> LLMResponse:
        response = self.client.models.generate_content(
            model=model, contents=contents, **kwargs
        )

        if not response or not response.text:
            raise ValueError("Empty response from Gemini API")

        return LLMResponse(text=response.text, model=model, provider=LLMProvider.GEMINI)

    def create_chat_session(
        self, model: str, history: List[Message], config: GenerateContentConfig
    ) -> ChatSession:
        """Create Gemini chat session"""
        session = self.client.chats.create(
            model=model,
            history=self._convert_chat_history_to_api_format(history),
            config=config,
        )
        return ChatSession(self, session, model)

    def send_message_stream(
        self, session: Any, model: str, message: MessageParam, **kwargs
    ) -> Iterator[StreamChunk]:
        """Send streaming message to Gemini"""
        converted_message = self._convert_message_content(message)

        for chunk in session.send_message_stream(message=converted_message, **kwargs):
            yield StreamChunk(
                text=chunk.text if chunk.text else "",
                model=model,
                provider=LLMProvider.GEMINI,
                is_done=False,
            )

    def get_default_model(self) -> str:
        return self._default_model

    def get_fast_model(self) -> str:
        return self._fast_model

    def _convert_chat_history_to_api_format(
        self,
        messages: List[Message],
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

    def _convert_message_content(self, content: MessageParam) -> Any:
        """Convert generic message content to Gemini Part format"""
        from google.genai.types import Part

        if isinstance(content, str):
            return content

        if isinstance(content, list):
            parts = []
            for item in content:
                if isinstance(item, TextContent):
                    parts.append(Part.from_text(text=item.text))
                elif isinstance(item, FileContent):
                    parts.append(
                        Part.from_bytes(data=item.data, mime_type=item.mime_type)
                    )

            # If we have multiple parts, we need to return them as proper Parts
            # If only one part, return it directly
            if len(parts) == 1:
                return parts[0]
            else:
                return parts

        return content


class OpenAIProvider(BaseLLMProvider):
    """OpenAI LLM provider implementation"""

    def __init__(self):

        self.api_key = os.getenv("OPENAI_API_KEY")
        # self.api_key = os.getenv("AZURE_OPENAI_API_KEY")
        endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
        version = os.getenv("AZURE_OPENAI_VERSION", "2025-04-01-preview")

        if not self.api_key:
            raise ValueError("OPENAI_API_KEY environment variable is required")
        if not endpoint:
            raise ValueError("AZURE_OPENAI_ENDPOINT environment variable is required")

        # self._client = openai.AzureOpenAI(api_key=self.api_key, azure_endpoint=endpoint, api_version=version)
        self._client = openai.OpenAI(api_key=self.api_key)
        self._default_model = "gpt-4.1"
        self._fast_model = "gpt-4.1"

    @property
    def client(self) -> openai.OpenAI:
        return self._client

    def generate_content(self, model: str, contents: str, **kwargs) -> LLMResponse:
        # Convert Gemini-style contents to OpenAI format if needed
        user_msg: ChatCompletionUserMessageParam = {
            "role": "user",
            "content": contents,
        }

        response = self.client.chat.completions.create(
            model=model, messages=[user_msg], **kwargs
        )

        if not response.choices or not response.choices[0].message.content:
            raise ValueError("Empty response from OpenAI API")

        return LLMResponse(
            text=response.choices[0].message.content,
            model=model,
            provider=LLMProvider.OPENAI,
        )

    def create_chat_session(
        self, model: str, history: List[Message], config: Dict[str, Any]
    ) -> ChatSession:
        """Create OpenAI chat session (stores history and config for later use)"""
        session_data = {"history": history, "config": config, "model": model}
        return ChatSession(self, session_data, model)

    def send_message_stream(
        self, session: Any, model: str, message: Any, **kwargs
    ) -> Iterator[StreamChunk]:
        """Send streaming message to OpenAI"""
        # Convert message format and merge with history
        messages = self._prepare_openai_messages(session, message)

        # Extract system instruction from config if present
        openai_kwargs = kwargs.copy()
        if session.get("config", {}).get("system_instruction"):
            # Add system message to the beginning
            system_msg: ChatCompletionSystemMessageParam = {
                "role": "system",
                "content": session["config"]["system_instruction"],
            }
            messages = [system_msg] + messages

        stream = self.client.chat.completions.create(
            model=model, messages=messages, stream=True, **openai_kwargs
        )

        for chunk in stream:
            if chunk.choices and chunk.choices[0].delta.content:
                yield StreamChunk(
                    text=chunk.choices[0].delta.content,
                    model=model,
                    provider=LLMProvider.OPENAI,
                    is_done=chunk.choices[0].finish_reason is not None,
                )

    def _convert_message_content(self, content: MessageParam) -> Any:
        """Convert generic message content to OpenAI format"""
        if isinstance(content, str):
            return content

        if isinstance(content, list):
            content_parts = []
            for item in content:
                if isinstance(item, TextContent):
                    content_parts.append({"type": "text", "text": item.text})
                elif isinstance(item, FileContent):
                    base64_data = base64.b64encode(item.data).decode("utf-8")
                    if item.mime_type == "application/pdf":
                        # OpenAI file handling - matches reference format
                        content_parts.append(
                            {
                                "type": "file",
                                "file": {
                                    "filename": item.filename or "file.pdf",
                                    "file_data": f"data:application/pdf;base64,{base64_data}",
                                },
                            }
                        )
            return content_parts

        return content

    def _prepare_openai_messages(
        self, session: Any, new_message: MessageParam
    ) -> list[ChatCompletionMessageParam]:
        """Prepare OpenAI messages format including history and new message"""
        messages: list[ChatCompletionMessageParam] = []

        # Add history
        if session.get("history"):
            for hist_msg in session["history"]:
                if hist_msg.role == "user":
                    user_msg: ChatCompletionUserMessageParam = {
                        "role": "user",
                        "content": hist_msg.content,
                    }
                    messages.append(user_msg)
                elif hist_msg.role == "assistant":
                    assistant_msg: ChatCompletionAssistantMessageParam = {
                        "role": "assistant",
                        "content": hist_msg.content,
                    }
                    messages.append(assistant_msg)

        # Handle new message using the generic converter
        converted_content = self._convert_message_content(new_message)

        user_msg: ChatCompletionUserMessageParam = {
            "role": "user",
            "content": converted_content,
        }
        messages.append(user_msg)

        return messages

    def get_default_model(self) -> str:
        return self._default_model

    def get_fast_model(self) -> str:
        return self._fast_model
