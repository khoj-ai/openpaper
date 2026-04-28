import base64
import json
import logging
import os
from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum
from typing import Any, Dict, Iterator, List, Optional, Sequence, Union

import anthropic
import openai
from app.database.models import Message
from app.llm.citation_handler import CitationHandler
from app.schemas.responses import (
    FileContent,
    SupplementaryContent,
    TextContent,
    ToolCall,
    ToolCallResult,
)
from google import genai
from google.genai.types import (
    AutomaticFunctionCallingConfig,
    Content,
    ContentListUnion,
    FunctionCallingConfig,
    FunctionCallingConfigMode,
    FunctionDeclaration,
    GenerateContentConfig,
    GenerateContentResponse,
    Part,
    ThinkingConfig,
    Tool,
    ToolConfig,
)
from openai.types.chat import (
    ChatCompletionAssistantMessageParam,
    ChatCompletionMessageParam,
    ChatCompletionMessageToolCallParam,
    ChatCompletionSystemMessageParam,
    ChatCompletionToolMessageParam,
    ChatCompletionToolParam,
    ChatCompletionUserMessageParam,
)

logger = logging.getLogger(__name__)


class LLMProvider(Enum):
    GEMINI = "gemini"
    OPENAI = "openai"
    GROQ = "groq"
    CEREBRAS = "cerebras"
    ANTHROPIC = "anthropic"


class LLMResponse:
    """Standardized response format across all LLM providers"""

    def __init__(
        self,
        text: str,
        model: str,
        provider: LLMProvider,
        thinking: Optional[str] = None,
        tool_calls: Optional[List[ToolCall]] = None,
    ):
        self.text = text
        self.model = model
        self.provider = provider
        self.thinking = thinking
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
MessageContent = Union[TextContent, FileContent, SupplementaryContent]
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
        tool_call_results: Optional[List[ToolCallResult]] = None,
        enable_thinking: bool = False,
        schema: Optional[Dict] = None,
        **kwargs,
    ) -> LLMResponse:
        """Generate content using the provider's API

        Args:
            model: The model identifier to use
            contents: The message content to send
            system_prompt: Optional system prompt
            history: Optional conversation history
            function_declarations: Optional list of tool/function declarations
            tool_call_results: Optional list of tool call results from previous calls
            enable_thinking: Whether to enable thinking/reasoning mode
            schema: Optional JSON schema dict for structured output. When provided,
                the response will be constrained to match this schema.
            **kwargs: Additional provider-specific arguments
        """
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
        self._default_model = "gemini-3.1-pro-preview"
        self._fast_model = "gemini-3-flash-preview"

    @property
    def client(self) -> genai.Client:
        return self._client

    def generate_content(
        self,
        model: str,
        contents: Union[str, MessageParam],
        system_prompt: Optional[str] = None,
        history: Optional[List[Message]] = None,
        function_declarations: Optional[List[Dict]] = None,
        tool_call_results: Optional[List[ToolCallResult]] = None,
        enable_thinking: bool = False,
        schema: Optional[Dict] = None,
        **kwargs,
    ) -> LLMResponse:
        tool_options: List[FunctionDeclaration] = []

        def get_thought(response: GenerateContentResponse) -> str:
            thoughts = ""
            if response.candidates and response.candidates[0].content:
                for part in response.candidates[0].content.parts or []:
                    if part.thought:
                        thoughts += str(part.text) + "\n"
            return thoughts.strip()

        # Cast function declarations to Gemini's FunctionDeclaration type
        if function_declarations:
            tool_options = [
                FunctionDeclaration(**func) for func in function_declarations
            ]

        tools = Tool(function_declarations=tool_options) if tool_options else None

        config = GenerateContentConfig()

        # Apply structured output schema if provided
        if schema:
            config.response_mime_type = "application/json"
            config.response_schema = schema

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

        if enable_thinking:
            config.thinking_config = ThinkingConfig(
                include_thoughts=True,
            )

        if system_prompt:
            config.system_instruction = system_prompt

        # Build contents list directly without intermediate conversion
        all_contents = self._prepare_gemini_messages(
            history=history or [],
            new_message=contents,
            tool_call_results=tool_call_results,
        )

        response = self.client.models.generate_content(
            model=model, contents=all_contents, config=config, **kwargs
        )

        if not response or (not response.text and not response.function_calls):
            raise ValueError("Empty response from Gemini API")

        # Extract tool calls from Gemini response, generating IDs for tracking
        tool_calls = []
        if response.function_calls:
            import uuid

            for fn in response.function_calls:
                if fn.name and fn.args:
                    tool_calls.append(
                        ToolCall(
                            id=str(uuid.uuid4()),
                            name=fn.name,
                            args=dict(fn.args),
                        )
                    )
                elif fn.name == "STOP":
                    tool_calls.append(
                        ToolCall(id=str(uuid.uuid4()), name="stop", args={})
                    )

        thinking = get_thought(response)

        return LLMResponse(
            text=response.text or "",
            model=model,
            provider=LLMProvider.GEMINI,
            thinking=thinking,
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
        tool_call_results: Optional[List[ToolCallResult]] = None,
    ) -> ContentListUnion:
        """Prepare Gemini messages format including history and new message with front-loading for caching

        For tool calling, the message structure is:
        1. User message (original query)
        2. Model message with function calls (reconstructed from tool_call_results)
        3. User message with function responses
        4. New user message (current query/continuation)
        """
        messages: List[Content] = []

        if file:
            formatted_file = self._convert_message_content([file])
            messages.append(formatted_file)

        # Add history after file
        formatted_history = self._convert_chat_history_to_api_format(history)
        messages.extend(formatted_history)

        # Add tool call results if present (multi-turn function calling)
        if tool_call_results:
            # Create function response parts for each tool result
            function_response_parts = []
            for result in tool_call_results:
                # Serialize result to a format Gemini can handle
                result_value = result.result
                if isinstance(result_value, (dict, list)):
                    import json

                    result_value = json.dumps(result_value)
                elif not isinstance(result_value, str):
                    result_value = str(result_value)

                function_response_parts.append(
                    Part.from_function_response(
                        name=result.name,
                        response={"result": result_value},
                    )
                )

            # Add as a user message containing all function responses
            if function_response_parts:
                messages.append(Content(role="user", parts=function_response_parts))

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
                elif isinstance(item, SupplementaryContent):
                    # Format supplementary content with XML tags to clearly delineate it
                    formatted = f"<{item.label}>\n{item.content}\n</{item.label}>"
                    parts.append(Part.from_text(text=formatted))

            # If we have multiple parts, we need to return them as proper Parts
            # If only one part, return it directly
            if len(parts) == 1:
                return parts[0]
            else:
                return parts

        return content


class OpenAIProvider(BaseLLMProvider):
    """OpenAI LLM provider implementation"""

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        default_model: Optional[str] = None,
        fast_model: Optional[str] = None,
        supports_pdf_input: bool = True,
    ):

        # Allow explicit api_key/base_url overrides while keeping env-based defaults.
        self.api_key = api_key or os.getenv("OPENAI_API_KEY")

        if not self.api_key:
            raise ValueError("OPENAI_API_KEY environment variable is required")

        # For standard OpenAI, base_url should be None. For OpenAI-compatible
        # providers, pass a custom base_url when constructing this provider.
        self._client = openai.OpenAI(api_key=self.api_key, base_url=base_url)
        self._default_model = default_model or "gpt-5.4"
        self._fast_model = fast_model or "gpt-4.1"
        # Some OpenAI-compatible endpoints (Cerebras, Groq) reject `file` content
        # blocks. When False, FileContent for PDFs is text-extracted inline.
        self.supports_pdf_input = supports_pdf_input

    @property
    def client(self) -> openai.OpenAI:
        return self._client

    def generate_content(
        self,
        model: str,
        contents: Union[str, MessageParam],
        system_prompt: Optional[str] = None,
        history: Optional[List[Message]] = None,
        function_declarations: Optional[List[Dict]] = None,
        tool_call_results: Optional[List[ToolCallResult]] = None,
        enable_thinking: bool = True,
        schema: Optional[Dict] = None,
        **kwargs,
    ) -> LLMResponse:
        # Convert to OpenAI format
        all_messages = self._prepare_openai_messages(
            history=history or [],
            new_message=contents,
            system_prompt=system_prompt or "",
            tool_call_results=tool_call_results,
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

        # Apply structured output schema if provided
        if schema:
            kwargs["response_format"] = {
                "type": "json_schema",
                "json_schema": {
                    "name": "structured_response",
                    "strict": True,
                    "schema": schema,
                },
            }

        if enable_thinking:
            logger.debug(
                "Thinking requested, but reasoning models not yet enabled for OpenAI provider"
            )

        response = self.client.chat.completions.create(
            model=model, messages=all_messages, **kwargs
        )

        if not response.choices or not response.choices[0].message:
            raise ValueError("Empty response from OpenAI API")

        message = response.choices[0].message

        # Extract tool calls from OpenAI response (preserving the ID)
        tool_calls = []
        if message.tool_calls:
            for tool_call in message.tool_calls:
                tool_calls.append(
                    ToolCall(
                        id=tool_call.id,
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
                    if item.mime_type == "application/pdf":
                        if self.supports_pdf_input:
                            base64_data = base64.b64encode(item.data).decode("utf-8")
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
                        else:
                            # Text-only OpenAI-compatible provider (e.g. Cerebras,
                            # Groq). The caller must supply a pre-extracted text
                            # alternative on FileContent.text_fallback.
                            if item.text_fallback is None:
                                raise ValueError(
                                    "FileContent.text_fallback is required when "
                                    "sending a PDF to a provider that does not "
                                    "support native file input. Pass the paper's "
                                    "raw_content as text_fallback."
                                )
                            filename = item.filename or "document.pdf"
                            wrapped = (
                                f'<document filename="{filename}">\n'
                                f"{item.text_fallback}\n"
                                f"</document>"
                            )
                            content_parts.append({"type": "text", "text": wrapped})
                elif isinstance(item, SupplementaryContent):
                    # Format supplementary content with XML tags to clearly delineate it
                    formatted = f"<{item.label}>\n{item.content}\n</{item.label}>"
                    content_parts.append({"type": "text", "text": formatted})
            return content_parts

        return content

    def _prepare_openai_messages(
        self,
        history: List[Message],
        new_message: MessageParam,
        system_prompt: str = "",
        file: FileContent | None = None,
        tool_call_results: Optional[List[ToolCallResult]] = None,
    ) -> list[ChatCompletionMessageParam]:
        """Prepare OpenAI messages format including history and new message with front-loading for caching

        For tool calling, the message structure is:
        1. Previous messages (system, history)
        2. Assistant message with tool_calls (reconstructed from tool_call_results)
        3. Tool messages for each result
        4. New user message
        """
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

        # Add tool call results if present (multi-turn function calling)
        if tool_call_results:
            # First, add an assistant message with the tool calls
            # This reconstructs what the model "said" when it made the tool calls
            tool_calls_for_assistant: List[ChatCompletionMessageToolCallParam] = []
            for result in tool_call_results:
                tool_calls_for_assistant.append(
                    {
                        "id": result.id or "",
                        "type": "function",
                        "function": {
                            "name": result.name,
                            "arguments": json.dumps(result.args),
                        },
                    }
                )

            assistant_with_tools: ChatCompletionAssistantMessageParam = {
                "role": "assistant",
                "content": None,
                "tool_calls": tool_calls_for_assistant,
            }
            messages.append(assistant_with_tools)

            # Then add tool messages with the results
            for result in tool_call_results:
                # Serialize result to string for OpenAI
                result_value = result.result
                if isinstance(result_value, (dict, list)):
                    result_str = json.dumps(result_value)
                elif not isinstance(result_value, str):
                    result_str = str(result_value)
                else:
                    result_str = result_value

                tool_msg: ChatCompletionToolMessageParam = {
                    "role": "tool",
                    "tool_call_id": result.id or "",
                    "content": result_str,
                }
                messages.append(tool_msg)

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


class AnthropicProvider(BaseLLMProvider):
    """Anthropic (Claude) LLM provider implementation.

    Uses the first-party Anthropic Messages API — not the OpenAI-compat endpoint
    — so we get tool use, PDF input, extended thinking, structured outputs, and
    prompt caching.
    """

    # Default max_tokens sized for the SDK HTTP timeout: non-streaming stays
    # under the 10-minute limit; streaming can go much higher.
    DEFAULT_MAX_TOKENS_NONSTREAM = 16000
    DEFAULT_MAX_TOKENS_STREAM = 64000

    def __init__(
        self,
        api_key: Optional[str] = None,
        default_model: Optional[str] = None,
        fast_model: Optional[str] = None,
    ):
        self.api_key = api_key or os.getenv("ANTHROPIC_API_KEY")
        if not self.api_key:
            raise ValueError("ANTHROPIC_API_KEY environment variable is required")

        self._client = anthropic.Anthropic(api_key=self.api_key)
        self._default_model = default_model or "claude-opus-4-7"
        self._fast_model = fast_model or "claude-haiku-4-5"

    @property
    def client(self) -> anthropic.Anthropic:
        return self._client

    def generate_content(
        self,
        model: str,
        contents: Union[str, MessageParam],
        system_prompt: Optional[str] = None,
        history: Optional[List[Message]] = None,
        function_declarations: Optional[List[Dict]] = None,
        tool_call_results: Optional[List[ToolCallResult]] = None,
        enable_thinking: bool = False,
        schema: Optional[Dict] = None,
        **kwargs,
    ) -> LLMResponse:
        params: Dict[str, Any] = {
            "model": model,
            "max_tokens": kwargs.pop("max_tokens", self.DEFAULT_MAX_TOKENS_NONSTREAM),
        }

        # System prompt as a cacheable text block. Marker on the last system
        # block caches tools + system together.
        if system_prompt:
            params["system"] = [
                {
                    "type": "text",
                    "text": system_prompt,
                    "cache_control": {"type": "ephemeral"},
                }
            ]

        params["messages"] = self._prepare_anthropic_messages(
            history=history or [],
            new_message=contents,
            tool_call_results=tool_call_results,
        )

        # Adaptive thinking is the only on-mode for Opus 4.7; "summarized"
        # makes the thinking text visible (default is "omitted" on 4.7).
        if enable_thinking:
            params["thinking"] = {"type": "adaptive", "display": "summarized"}

        if function_declarations:
            params["tools"] = [
                self._convert_tool_declaration(fd) for fd in function_declarations
            ]
            # Match Gemini's behavior: force at least one tool call when tools
            # are provided and no structured-output schema. Callers that want
            # auto selection can override via kwargs.
            if not schema:
                params.setdefault("tool_choice", {"type": "any"})

        if schema:
            params["output_config"] = {
                "format": {"type": "json_schema", "schema": schema}
            }

        params.update(kwargs)

        response = self._client.messages.create(**params)

        text_parts: List[str] = []
        thinking_parts: List[str] = []
        tool_calls: List[ToolCall] = []

        for block in response.content:
            btype = getattr(block, "type", None)
            if btype == "text":
                text_parts.append(block.text)
            elif btype == "thinking":
                thinking_text = getattr(block, "thinking", "") or ""
                if thinking_text:
                    thinking_parts.append(thinking_text)
            elif btype == "tool_use":
                tool_calls.append(
                    ToolCall(
                        id=block.id,
                        name=block.name,
                        args=dict(block.input) if block.input else {},
                    )
                )

        if not text_parts and not tool_calls:
            raise ValueError("Empty response from Anthropic API")

        return LLMResponse(
            text="".join(text_parts),
            model=model,
            provider=LLMProvider.ANTHROPIC,
            thinking="\n".join(thinking_parts) if thinking_parts else None,
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
        params: Dict[str, Any] = {
            "model": model,
            "max_tokens": kwargs.pop("max_tokens", self.DEFAULT_MAX_TOKENS_STREAM),
        }

        if system_prompt:
            params["system"] = [
                {
                    "type": "text",
                    "text": system_prompt,
                    "cache_control": {"type": "ephemeral"},
                }
            ]

        params["messages"] = self._prepare_anthropic_messages(
            history=history,
            new_message=message,
            file=file,
        )

        params.update(kwargs)

        with self._client.messages.stream(**params) as stream:
            for text in stream.text_stream:
                yield StreamChunk(
                    text=text,
                    model=model,
                    provider=LLMProvider.ANTHROPIC,
                    is_done=False,
                )
            # Surface usage after the stream completes; helpful for verifying
            # cache hits via cache_read_input_tokens.
            final = stream.get_final_message()
            if final.usage:
                logger.debug(f"Anthropic usage stats: {final.usage}")

    def get_default_model(self) -> str:
        return self._default_model

    def get_fast_model(self) -> str:
        return self._fast_model

    def _convert_tool_declaration(self, func_decl: Dict[str, Any]) -> Dict[str, Any]:
        """Convert the generic tool-declaration shape to Anthropic's.

        The generic shape uses OpenAI/Gemini's `parameters` key for the JSON
        schema; Anthropic calls it `input_schema`.
        """
        return {
            "name": func_decl["name"],
            "description": func_decl.get("description", ""),
            "input_schema": func_decl.get(
                "parameters", {"type": "object", "properties": {}}
            ),
        }

    def _convert_message_content(self, content: MessageParam) -> Any:
        """Convert generic message content to Anthropic content blocks."""
        if isinstance(content, str):
            return content

        if isinstance(content, list):
            blocks: List[Dict[str, Any]] = []
            for item in content:
                if isinstance(item, TextContent):
                    blocks.append({"type": "text", "text": item.text})
                elif isinstance(item, FileContent):
                    blocks.append(self._file_content_to_block(item))
                elif isinstance(item, SupplementaryContent):
                    formatted = f"<{item.label}>\n{item.content}\n</{item.label}>"
                    blocks.append({"type": "text", "text": formatted})
            return blocks

        return content

    def _file_content_to_block(self, file: FileContent) -> Dict[str, Any]:
        """Wrap FileContent as an Anthropic document or image content block.

        Paper PDFs dominate the prefix and repeat across turns, so caching
        them is the highest-leverage win for this app.
        """
        base64_data = base64.b64encode(file.data).decode("utf-8")
        source = {
            "type": "base64",
            "media_type": file.mime_type,
            "data": base64_data,
        }
        outer_type = "document" if file.mime_type == "application/pdf" else "image"
        return {
            "type": outer_type,
            "source": source,
            "cache_control": {"type": "ephemeral"},
        }

    def _convert_chat_history_to_api_format(
        self, messages: List[Message]
    ) -> List[Dict[str, Any]]:
        """Convert our DB Message rows to Anthropic message dicts."""
        api_format: List[Dict[str, Any]] = []
        for message in messages:
            references = (
                CitationHandler.format_citations(message.references["citations"])  # type: ignore
                if message.references
                else None
            )
            content_text = (
                f"{message.content}\n\n{references}" if references else message.content
            )
            api_format.append(
                {
                    "role": "user" if message.role == "user" else "assistant",
                    "content": str(content_text),
                }
            )
        return api_format

    def _prepare_anthropic_messages(
        self,
        history: List[Message],
        new_message: MessageParam,
        file: FileContent | None = None,
        tool_call_results: Optional[List[ToolCallResult]] = None,
    ) -> List[Dict[str, Any]]:
        """Assemble the messages array.

        Anthropic requires strict user/assistant alternation. To keep the file
        block stable across turns (for prompt caching), we inject it at the
        front of the first user message — either the first history message or,
        if history is empty, the new user message — rather than adding a
        standalone file message + synthetic assistant ack.

        For tool-call round-trips, the assistant's tool_use turn is reconstructed
        from `tool_call_results`, followed by a user turn containing the
        matching tool_result blocks.
        """
        messages: List[Dict[str, Any]] = []

        history_msgs = self._convert_chat_history_to_api_format(history)

        file_block = self._file_content_to_block(file) if file else None

        if file_block and history_msgs and history_msgs[0]["role"] == "user":
            first = history_msgs[0]
            messages.append(
                {
                    "role": "user",
                    "content": [
                        file_block,
                        {"type": "text", "text": str(first["content"])},
                    ],
                }
            )
            messages.extend(history_msgs[1:])
            file_block = None  # consumed
        else:
            messages.extend(history_msgs)

        if tool_call_results:
            assistant_tool_blocks: List[Dict[str, Any]] = []
            for result in tool_call_results:
                assistant_tool_blocks.append(
                    {
                        "type": "tool_use",
                        "id": result.id or "",
                        "name": result.name,
                        "input": result.args,
                    }
                )
            messages.append({"role": "assistant", "content": assistant_tool_blocks})

            tool_result_blocks: List[Dict[str, Any]] = []
            for result in tool_call_results:
                value = result.result
                if isinstance(value, (dict, list)):
                    value = json.dumps(value)
                elif not isinstance(value, str):
                    value = str(value)
                tool_result_blocks.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": result.id or "",
                        "content": value,
                    }
                )
            messages.append({"role": "user", "content": tool_result_blocks})

        converted = self._convert_message_content(new_message)
        if file_block is not None:
            if isinstance(converted, str):
                new_content: List[Dict[str, Any]] = [
                    file_block,
                    {"type": "text", "text": converted},
                ]
            elif isinstance(converted, list):
                new_content = [file_block, *converted]
            else:
                new_content = [file_block]
            messages.append({"role": "user", "content": new_content})
        else:
            messages.append({"role": "user", "content": converted})

        return messages
