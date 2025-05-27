import asyncio
import base64
import os
import tempfile
from typing import Literal, Tuple

import openai
from app.helpers.s3 import s3_service
from openai.types.chat import ChatCompletionAudioParam


class OpenAISpeaker:
    """OpenAI LLM provider implementation"""

    def __init__(self):

        # the azure openai endpoint isn't accepting the `file` type in the content list, so disable it for now
        self.api_key = os.getenv("AZURE_OPENAI_API_KEY")
        endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
        version = os.getenv("AZURE_OPENAI_VERSION", "2025-04-01-preview")

        if not self.api_key:
            raise ValueError("AZURE_OPENAI_API_KEY environment variable is required")
        if not endpoint:
            raise ValueError("AZURE_OPENAI_ENDPOINT environment variable is required")

        self.client = openai.AzureOpenAI(
            api_key=self.api_key, azure_endpoint=endpoint, api_version=version
        )
        self.model = "gpt-4o-mini-tts"

    def generate_speech_from_text(
        self,
        title: str,
        text: str,
        voice: Literal[
            "alloy",
            "ash",
            "ballad",
            "coral",
            "echo",
            "fable",
            "onyx",
            "nova",
            "sage",
            "shimmer",
            "verse",
        ],
    ) -> Tuple[str, str]:
        """
        Generate speech audio from text using a text-to-speech model.

        Args:
            text (str): The text to convert to speech.
            voice (str): The voice to use for speech synthesis.
            output_format (str): The audio format for the output (e.g., "mp3", "wav").

        Returns:
            Tuple[str, str]: The object key and URL to the generated speech audio in s3 storage.
        """

        with tempfile.NamedTemporaryFile(
            delete=False, suffix=".wav"
        ) as speech_file_path:
            with self.client.audio.speech.with_streaming_response.create(
                model=self.model,
                voice=voice,
                response_format="wav",
                input=text,
                instructions="Speak in a cheerful and positive tone.",
            ) as response:
                response.stream_to_file(speech_file_path.name)

            # Ensure the file is written and synced to disk
            speech_file_path.flush()
            os.fsync(speech_file_path.fileno())

            # Check if the file has some content
            if os.path.getsize(speech_file_path.name) == 0:
                raise ValueError(
                    "Generated audio file is empty. Please check the input text and try again."
                )

            title = title or "speech_output"
            title = title.replace(" ", "_").replace("/", "_")
            # Upload the generated audio file to S3
            object_key, file_url = s3_service.upload_any_file(
                file_path=speech_file_path.name,
                original_filename=title,
                content_type="audio/wav",
            )

            return object_key, file_url


speaker = OpenAISpeaker()


""""
Code sample

from pathlib import Path
from openai import OpenAI

client = OpenAI()
speech_file_path = Path(__file__).parent / "speech.mp3"

with client.audio.speech.with_streaming_response.create(
    model="gpt-4o-mini-tts",
    voice="coral",
    input="Today is a wonderful day to build something people love!",
    instructions="Speak in a cheerful and positive tone.",
) as response:
    response.stream_to_file(speech_file_path)
"""
