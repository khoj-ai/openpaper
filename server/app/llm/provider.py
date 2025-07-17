import base64
import json
import logging
import os
from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum
from typing import Any, Dict, Iterator, List, Literal, Optional, Sequence, Union

import openai
from app.database.models import Message
from app.llm.citation_handler import CitationHandler
from app.schemas.responses import FileContent, TextContent, ToolCall
from google import genai
from google.genai.types import (
    AutomaticFunctionCallingConfig,
    Content,
    ContentListUnion,
    FunctionCallingConfig,
    FunctionCallingConfigMode,
    FunctionDeclaration,
    GenerateContentConfig,
    Tool,
    ToolConfig,
)
from openai.types.chat import (
    ChatCompletionAssistantMessageParam,
    ChatCompletionMessageParam,
    ChatCompletionSystemMessageParam,
    ChatCompletionToolParam,
    ChatCompletionUserMessageParam,
)

logger = logging.getLogger(__name__)


class LLMProvider(Enum):
    GEMINI = "gemini"
    OPENAI = "openai"


class LLMResponse:
    """Standardized response format across all LLM providers"""

    def __init__(
        self,
        text: str,
        model: str,
        provider: LLMProvider,
        tool_calls: Optional[List[ToolCall]] = None,
    ):
        self.text = text
        self.model = model
        self.provider = provider
        self.tool_calls = tool_calls or []


class StreamChunk:
    """Standardized streaming chunk format across all LLM providers"""

    def __init__(
        self, text: str, model: str, provider: LLMProvider, is_done: bool = False
    ):
        self.text = text
        self.model = model
        self.provider = provider
        self.is_done = is_done


# Union type for all content types
MessageContent = Union[TextContent, FileContent]
MessageParam = Union[str, Sequence[MessageContent]]


class BaseLLMProvider(ABC):
    """Abstract base class for LLM providers"""

    @property
    @abstractmethod
    def client(self) -> Any:
        """Get the underlying client for this provider"""
        pass

    @abstractmethod
    def generate_content(
        self,
        model: str,
        contents: Union[str, MessageParam],
        system_prompt: Optional[str] = None,
        history: Optional[List[Message]] = None,
        function_declarations: Optional[List[Dict]] = None,
        **kwargs,
    ) -> LLMResponse:
        """Generate content using the provider's API"""
        pass

    @abstractmethod
    def send_message_stream(
        self,
        model: str,
        message: MessageParam,
        history: List[Message],
        system_prompt: str,
        file: FileContent | None = None,
        **kwargs,
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

    def generate_content(
        self,
        model: str,
        contents: Union[str, MessageParam],
        history: Optional[List[Message]] = None,
        system_prompt: str = "",
        function_declarations: Optional[List[Dict]] = None,
        **kwargs,
    ) -> LLMResponse:
        tool_options: List[FunctionDeclaration] = []
        # Cast function declarations to Gemini's FunctionDeclaration type
        if function_declarations:
            tool_options = [
                FunctionDeclaration(**func) for func in function_declarations
            ]

        tools = Tool(function_declarations=tool_options) if tool_options else None

        config = GenerateContentConfig()
        if tools:
            config.tools = [tools]
            config.tool_config = ToolConfig(
                function_calling_config=FunctionCallingConfig(
                    mode=FunctionCallingConfigMode.ANY
                )
            )
            config.automatic_function_calling = AutomaticFunctionCallingConfig(
                disable=True  # Disable automatic function calling
            )

        if system_prompt:
            config.system_instruction = system_prompt

        # Build contents list directly without intermediate conversion
        all_contents = self._prepare_gemini_messages(
            history=history or [],
            new_message=contents,
        )

        response = self.client.models.generate_content(
            model=model, contents=all_contents, config=config, **kwargs
        )

        if not response or (not response.text and not response.function_calls):
            raise ValueError("Empty response from Gemini API")

        # Extract tool calls from Gemini response
        tool_calls = []
        if response.function_calls:
            for fn in response.function_calls:
                if fn.name and fn.args:
                    tool_calls.append(ToolCall(name=fn.name, args=dict(fn.args)))
                elif fn.name == "STOP":
                    tool_calls.append(ToolCall(name="stop", args={}))

        return LLMResponse(
            text=response.text or "",
            model=model,
            provider=LLMProvider.GEMINI,
            tool_calls=tool_calls,
        )

    def send_message_stream(
        self,
        model: str,
        message: MessageParam,
        history: List[Message],
        system_prompt: str,
        file: FileContent | None = None,
        **kwargs,
    ) -> Iterator[StreamChunk]:
        """Send streaming message to Gemini"""

        config = GenerateContentConfig(
            system_instruction=system_prompt,
        )

        # Start with file content for caching if present
        contents = self._prepare_gemini_messages(
            history=history, new_message=message, file=file
        )

        response_stream = self.client.models.generate_content_stream(
            model=model,
            contents=contents,
            config=config,
            **kwargs,
        )

        for chunk in response_stream:
            yield StreamChunk(
                text=chunk.text if chunk.text else "",
                model=model,
                provider=LLMProvider.GEMINI,
                is_done=False,
            )
            if chunk.usage_metadata:
                logger.debug(f"Gemini usage stats: {chunk.usage_metadata}")

    def _prepare_gemini_messages(
        self,
        history: List[Message],
        new_message: MessageParam,
        file: FileContent | None = None,
    ) -> ContentListUnion:
        """Prepare Gemini messages format including history and new message with front-loading for caching"""
        messages: List[Content] = []

        if file:
            formatted_file = self._convert_message_content([file])
            messages.append(formatted_file)

        # Add history after file
        formatted_history = self._convert_chat_history_to_api_format(history)
        messages.extend(formatted_history)

        # Add the new message last
        converted_message = self._convert_message_content(new_message)
        messages.append(converted_message)

        return messages  # type: ignore

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
        # the azure openai endpoint isn't accepting the `file` type in the content list, so disable it for now
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

    def generate_content(
        self,
        model: str,
        contents: Union[str, MessageParam],
        history: Optional[List[Message]] = None,
        function_declarations: Optional[List[Dict]] = None,
        system_prompt: Optional[str] = None,
        **kwargs,
    ) -> LLMResponse:
        # Convert to OpenAI format
        if isinstance(contents, str):
            content = contents
        else:
            content = self._convert_message_content(
                contents, system_instructions=system_prompt
            )

        all_messages = self._prepare_openai_messages(
            history=history or [],
            new_message=content,
            system_prompt=system_prompt or "",
        )

        tools = (
            [
                self._cast_tool_declaration(func_decl)
                for func_decl in function_declarations
            ]
            if function_declarations
            else None
        )

        if tools:
            kwargs["tools"] = tools

        response = self.client.chat.completions.create(
            model=model, messages=all_messages, **kwargs
        )

        if not response.choices or not response.choices[0].message.content:
            raise ValueError("Empty response from OpenAI API")

        message = response.choices[0].message

        # Extract tool calls from OpenAI response
        tool_calls = []
        if message.tool_calls:
            for tool_call in message.tool_calls:
                tool_calls.append(
                    ToolCall(
                        name=tool_call.function.name,
                        args=json.loads(tool_call.function.arguments),
                    )
                )

        return LLMResponse(
            text=message.content or "",
            model=model,
            provider=LLMProvider.OPENAI,
            tool_calls=tool_calls,
        )

    def send_message_stream(
        self,
        model: str,
        message: MessageParam,
        history: List[Message],
        system_prompt: str,
        file: FileContent | None = None,
        **kwargs,
    ) -> Iterator[StreamChunk]:
        """Send streaming message to OpenAI"""
        messages = self._prepare_openai_messages(history, message, system_prompt, file)
        stream = self.client.chat.completions.create(
            model=model,
            messages=messages,
            stream=True,
            stream_options={"include_usage": True},
            **kwargs,
        )

        for chunk in stream:
            if chunk.choices and chunk.choices[0].delta.content:
                yield StreamChunk(
                    text=chunk.choices[0].delta.content,
                    model=model,
                    provider=LLMProvider.OPENAI,
                    is_done=chunk.choices[0].finish_reason is not None,
                )
            elif chunk.usage:
                logger.debug(f"OpenAI usage stats: {chunk.usage}")

    def _convert_message_content(
        self, content: MessageParam, system_instructions: Optional[str] = None
    ) -> Any:
        """Convert generic message content to OpenAI format"""
        if isinstance(content, str):
            return content

        if isinstance(content, list):
            content_parts = []

            if system_instructions:
                content_parts.append({"type": "system", "text": system_instructions})

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
        self,
        history: List[Message],
        new_message: MessageParam,
        system_prompt: str = "",
        file: FileContent | None = None,
    ) -> list[ChatCompletionMessageParam]:
        """Prepare OpenAI messages format including history and new message with front-loading for caching"""
        messages: list[ChatCompletionMessageParam] = []

        # Follow with system prompt for caching
        if system_prompt:
            system_msg: ChatCompletionSystemMessageParam = {
                "role": "system",
                "content": system_prompt,
            }
            messages.append(system_msg)

        # Add file content early for caching if present
        if file:
            file_content = self._convert_message_content([file])
            file_msg: ChatCompletionUserMessageParam = {
                "role": "user",
                "content": file_content,
            }
            messages.append(file_msg)

        # Add history
        for hist_msg in history:
            if hist_msg.role == "user":
                user_msg: ChatCompletionUserMessageParam = {
                    "role": "user",
                    "content": str(hist_msg.content),
                }
                messages.append(user_msg)
            elif hist_msg.role == "assistant":
                assistant_msg: ChatCompletionAssistantMessageParam = {
                    "role": "assistant",
                    "content": str(hist_msg.content),
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

    def _cast_tool_declaration(
        self, func_decl: Dict[str, Any]
    ) -> ChatCompletionToolParam:
        return {
            "type": "function",
            "function": {
                "name": func_decl["name"],
                "description": func_decl.get("description", ""),
                "parameters": func_decl.get("parameters", {}),
            },
        }

    def get_default_model(self) -> str:
        return self._default_model

    def get_fast_model(self) -> str:
        return self._fast_model
