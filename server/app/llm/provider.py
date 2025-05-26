import base64
import logging
import os
from abc import ABC, abstractmethod
from enum import Enum
from typing import Any, Dict, Iterator

import openai
from google import genai
from google.genai.types import GenerateContentConfig
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


class BaseLLMProvider(ABC):
    """Abstract base class for LLM providers"""

    @property
    @abstractmethod
    def client(self) -> Any:
        """Get the underlying client for this provider"""
        pass

    @abstractmethod
    def generate_content(self, model: str, contents: Any, **kwargs) -> LLMResponse:
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

    def generate_content(self, model: str, contents: Any, **kwargs) -> LLMResponse:
        response = self.client.models.generate_content(
            model=model, contents=contents, **kwargs
        )

        if not response or not response.text:
            raise ValueError("Empty response from Gemini API")

        return LLMResponse(text=response.text, model=model, provider=LLMProvider.GEMINI)

    def create_chat_session(
        self, model: str, history: Any, config: GenerateContentConfig
    ) -> ChatSession:
        """Create Gemini chat session"""
        session = self.client.chats.create(
            model=model,
            history=history,
            config=config,
        )
        return ChatSession(self, session, model)

    def send_message_stream(
        self, session: Any, model: str, message: Any, **kwargs
    ) -> Iterator[StreamChunk]:
        """Send streaming message to Gemini"""
        for chunk in session.send_message_stream(message=message, **kwargs):
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


class OpenAIProvider(BaseLLMProvider):
    """OpenAI LLM provider implementation"""

    def __init__(self):
        self.api_key = os.getenv("OPENAI_API_KEY")
        if not self.api_key:
            raise ValueError("OPENAI_API_KEY environment variable is required")

        self._client = openai.OpenAI(api_key=self.api_key)
        self._default_model = "gpt-4o"
        self._fast_model = "gpt-4o-mini"

    @property
    def client(self) -> openai.OpenAI:
        return self._client

    def generate_content(self, model: str, contents: Any, **kwargs) -> LLMResponse:
        # Convert Gemini-style contents to OpenAI format if needed
        messages = self._convert_contents_to_messages(contents)

        response = self.client.chat.completions.create(
            model=model, messages=messages, **kwargs
        )

        if not response.choices or not response.choices[0].message.content:
            raise ValueError("Empty response from OpenAI API")

        return LLMResponse(
            text=response.choices[0].message.content,
            model=model,
            provider=LLMProvider.OPENAI,
        )

    def create_chat_session(
        self, model: str, history: Any, config: Dict[str, Any]
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

    def _prepare_openai_messages(
        self, session: Any, new_message: Any
    ) -> list[ChatCompletionMessageParam]:
        """Prepare OpenAI messages format including history and new message"""
        messages: list[ChatCompletionMessageParam] = []

        # Add history
        if session.get("history"):
            for hist_msg in session["history"]:
                if hasattr(hist_msg, "role") and hasattr(hist_msg, "parts"):
                    # Convert from Gemini format
                    role = hist_msg.role
                    content = hist_msg.parts[0]["text"] if hist_msg.parts else ""

                    if role == "user":
                        user_msg: ChatCompletionUserMessageParam = {
                            "role": "user",
                            "content": content,
                        }
                        messages.append(user_msg)
                    else:  # assistant/model role
                        assistant_msg: ChatCompletionAssistantMessageParam = {
                            "role": "assistant",
                            "content": content,
                        }
                        messages.append(assistant_msg)

        # Handle new message - could be text or multimodal
        if isinstance(new_message, str):
            user_msg: ChatCompletionUserMessageParam = {
                "role": "user",
                "content": new_message,
            }
            messages.append(user_msg)
        elif isinstance(new_message, list):
            # Handle multimodal content (text + files)
            content_parts = []
            for part in new_message:
                if isinstance(part, str):
                    content_parts.append({"type": "text", "text": part})
                elif hasattr(part, "mime_type") and part.mime_type == "application/pdf":
                    # Handle file content (e.g., PDF)
                    file_data = part.data  # Assuming part.data contains the file bytes
                    generic_file_name = "file.pdf"  # Default name, can be customized
                    # OpenAI accepts files as attachments. Encode the data in base64 format
                    content_parts.append(
                        {
                            "type": "file",
                            "file": {
                                "filename": generic_file_name,
                                "file_data": base64.b64encode(file_data).decode(
                                    "utf-8"
                                ),
                            },
                        }
                    )

            if content_parts:
                user_msg: ChatCompletionUserMessageParam = {
                    "role": "user",
                    "content": content_parts,
                }
                messages.append(user_msg)

        return messages

    def _convert_contents_to_messages(
        self, contents: Any
    ) -> list[ChatCompletionMessageParam]:
        """Convert Gemini-style contents to OpenAI messages format"""
        messages: list[ChatCompletionMessageParam] = []

        if isinstance(contents, list) and all(hasattr(c, "role") for c in contents):
            # Already in message format (from chat history)
            for content in contents:
                role = content.role
                text_content = content.parts[0]["text"] if content.parts else ""

                if role == "user":
                    user_msg: ChatCompletionUserMessageParam = {
                        "role": "user",
                        "content": text_content,
                    }
                    messages.append(user_msg)
                else:  # assistant/model role
                    assistant_msg: ChatCompletionAssistantMessageParam = {
                        "role": "assistant",
                        "content": text_content,
                    }
                    messages.append(assistant_msg)
        elif isinstance(contents, str):
            # Simple string prompt
            user_msg: ChatCompletionUserMessageParam = {
                "role": "user",
                "content": contents,
            }
            messages.append(user_msg)
        else:
            # Handle other formats as needed
            user_msg: ChatCompletionUserMessageParam = {
                "role": "user",
                "content": str(contents),
            }
            messages.append(user_msg)

        return messages

    def get_default_model(self) -> str:
        return self._default_model

    def get_fast_model(self) -> str:
        return self._fast_model
