import os
import re
import tempfile
import wave
from typing import List, Literal, Tuple

import openai
from app.helpers.s3 import s3_service

# Maximum characters per chunk for TTS generation
MAX_CHUNK_SIZE = 10000


def chunk_text(text: str, max_chunk_size: int = MAX_CHUNK_SIZE) -> List[str]:
    """
    Split long text into smaller chunks at natural boundaries (paragraphs, sentences).

    Args:
        text: The text to split into chunks.
        max_chunk_size: Maximum number of characters per chunk.

    Returns:
        List of text chunks.
    """
    if len(text) <= max_chunk_size:
        return [text]

    chunks = []
    remaining_text = text

    while remaining_text:
        if len(remaining_text) <= max_chunk_size:
            chunks.append(remaining_text)
            break

        # Try to find a good break point within the max chunk size
        chunk = remaining_text[:max_chunk_size]

        # Priority 1: Break at paragraph boundaries (double newline)
        paragraph_break = chunk.rfind("\n\n")
        if paragraph_break > max_chunk_size // 2:
            chunks.append(remaining_text[:paragraph_break].strip())
            remaining_text = remaining_text[paragraph_break:].strip()
            continue

        # Priority 2: Break at single newline
        newline_break = chunk.rfind("\n")
        if newline_break > max_chunk_size // 2:
            chunks.append(remaining_text[:newline_break].strip())
            remaining_text = remaining_text[newline_break:].strip()
            continue

        # Priority 3: Break at sentence boundaries (. ! ?)
        # Look for sentence endings followed by space or end of chunk
        sentence_pattern = r"[.!?][\s]"
        matches = list(re.finditer(sentence_pattern, chunk))
        if matches:
            # Find the last sentence break that's past the halfway point
            for match in reversed(matches):
                if match.end() > max_chunk_size // 2:
                    break_point = match.end()
                    chunks.append(remaining_text[:break_point].strip())
                    remaining_text = remaining_text[break_point:].strip()
                    break
            else:
                # Use the last match if none are past halfway
                break_point = matches[-1].end()
                chunks.append(remaining_text[:break_point].strip())
                remaining_text = remaining_text[break_point:].strip()
            continue

        # Priority 4: Break at comma or semicolon
        comma_break = max(chunk.rfind(", "), chunk.rfind("; "))
        if comma_break > max_chunk_size // 2:
            chunks.append(remaining_text[: comma_break + 1].strip())
            remaining_text = remaining_text[comma_break + 1 :].strip()
            continue

        # Priority 5: Break at space (word boundary)
        space_break = chunk.rfind(" ")
        if space_break > 0:
            chunks.append(remaining_text[:space_break].strip())
            remaining_text = remaining_text[space_break:].strip()
            continue

        # Fallback: Hard break at max_chunk_size
        chunks.append(remaining_text[:max_chunk_size])
        remaining_text = remaining_text[max_chunk_size:]

    return [chunk for chunk in chunks if chunk]  # Filter out empty chunks


def concatenate_wav_files(wav_files: List[str], output_path: str) -> None:
    """
    Concatenate multiple WAV files into a single WAV file.

    Args:
        wav_files: List of paths to WAV files to concatenate.
        output_path: Path for the output concatenated WAV file.
    """
    if not wav_files:
        raise ValueError("No WAV files to concatenate")

    if len(wav_files) == 1:
        # Just copy the single file
        with open(wav_files[0], "rb") as src, open(output_path, "wb") as dst:
            dst.write(src.read())
        return

    # Read parameters from the first file
    with wave.open(wav_files[0], "rb") as first_wav:
        params = first_wav.getparams()

    # Write concatenated audio
    with wave.open(output_path, "wb") as output_wav:
        output_wav.setparams(params)

        for wav_file in wav_files:
            with wave.open(wav_file, "rb") as input_wav:
                # Verify compatible parameters
                if input_wav.getnchannels() != params.nchannels:
                    raise ValueError(f"Channel mismatch in {wav_file}")
                if input_wav.getsampwidth() != params.sampwidth:
                    raise ValueError(f"Sample width mismatch in {wav_file}")
                if input_wav.getframerate() != params.framerate:
                    raise ValueError(f"Frame rate mismatch in {wav_file}")

                # Write frames
                output_wav.writeframes(input_wav.readframes(input_wav.getnframes()))


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
            api_key=self.api_key,
            azure_endpoint=endpoint,
            api_version=version,
            timeout=300.0,
        )
        self.model = "gpt-4o-mini-tts"

    def _generate_single_chunk(
        self,
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
        output_path: str,
    ) -> None:
        """
        Generate speech audio for a single text chunk.

        Args:
            text: The text to convert to speech.
            voice: The voice to use for speech synthesis.
            output_path: Path to save the generated audio file.
        """
        with self.client.audio.speech.with_streaming_response.create(
            model=self.model,
            voice=voice,
            response_format="wav",
            input=text,
            instructions="Speak in a cheerful and positive tone.",
        ) as response:
            response.stream_to_file(output_path)

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
        For long texts (>10000 characters), the text is split into chunks,
        audio is generated for each chunk, and the results are concatenated.

        Args:
            text (str): The text to convert to speech.
            voice (str): The voice to use for speech synthesis.

        Returns:
            Tuple[str, str]: The object key and URL to the generated speech audio in s3 storage.
        """
        # Split text into chunks if necessary
        chunks = chunk_text(text)

        temp_files: List[str] = []
        final_output_path: str | None = None
        try:
            # Generate audio for each chunk
            for i, chunk in enumerate(chunks):
                temp_file = tempfile.NamedTemporaryFile(
                    delete=False, suffix=f"_chunk_{i}.wav"
                )
                temp_files.append(temp_file.name)
                temp_file.close()

                self._generate_single_chunk(chunk, voice, temp_file.name)

                # Verify the chunk file has content
                if os.path.getsize(temp_file.name) == 0:
                    raise ValueError(
                        f"Generated audio chunk {i} is empty. Please check the input text and try again."
                    )

            # Create the final output file
            with tempfile.NamedTemporaryFile(
                delete=False, suffix=".wav"
            ) as speech_file_path:
                final_output_path = speech_file_path.name

            # Concatenate all chunks if multiple, or use single chunk directly
            concatenate_wav_files(temp_files, final_output_path)

            # Check if the final file has content
            if os.path.getsize(final_output_path) == 0:
                raise ValueError(
                    "Generated audio file is empty. Please check the input text and try again."
                )

            title = title or "speech_output"
            title = title.replace(" ", "_").replace("/", "_")
            # Upload the generated audio file to S3
            object_key, file_url = s3_service.upload_any_file(
                file_path=final_output_path,
                original_filename=title,
                content_type="audio/wav",
            )

            return object_key, file_url
        finally:
            # Clean up temporary chunk files
            for temp_file in temp_files:
                try:
                    if os.path.exists(temp_file):
                        os.unlink(temp_file)
                except OSError:
                    pass
            # Clean up final output file if it exists
            try:
                if final_output_path and os.path.exists(final_output_path):
                    os.unlink(final_output_path)
            except OSError:
                pass


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
