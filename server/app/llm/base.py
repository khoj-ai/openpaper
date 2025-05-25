import logging
import os
from typing import Optional

from app.database.models import Message
from google import genai
from google.genai.types import Content

logger = logging.getLogger(__name__)


class BaseLLMClient:
    """Base class for LLM operations with common configuration"""

    def __init__(self):
        self.api_key = os.getenv("GEMINI_API_KEY")
        if not self.api_key:
            raise ValueError("GEMINI_API_KEY environment variable is required")

        self.client = genai.Client(api_key=self.api_key)
        self.default_model = "gemini-2.5-pro-preview-03-25"
        self.fast_model = "gemini-2.5-flash-preview-04-17"

    def convert_chat_history_to_api_format(
        self,
        messages: list[Message],
    ) -> list[Content]:
        """
        Convert chat history to Chat API format
        """
        api_format = []
        for message in messages:
            references = self.format_citations(message.references["citations"]) if message.references else None  # type: ignore

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
