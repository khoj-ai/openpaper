"""What happens when the answer model streams no answer.

A Gemini stream can run to completion and hand the caller nothing a reader can
see. The model emits a function call the request never offered it and the
candidate is cut short as MALFORMED_FUNCTION_CALL; it spends its whole output
budget thinking; a continuation wanders into memorized text and trips
RECITATION. In every case `chunk.text` skips the parts that are there, the
stream ends normally, and — before these tests — that was indistinguishable
from a model that chose to answer with silence.

The user saw a blank message. No error was raised, so nothing retried; no error
chunk reached the client; and the blank turn was saved, which then replayed an
empty model part into the history of every later turn in the conversation.

These tests hold three seams: an empty stream raises rather than returning
quietly, the reasons that a fresh draw can clear are re-sampled while the ones
it cannot are not, and a turn that still ends with no text tells the user so
instead of persisting a blank.
"""

import asyncio
import json
import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.api.message_api import _stream_chat_chunks
from app.llm.provider import GeminiProvider
from app.llm.utils import (
    STREAM_RESTART,
    EmptyStreamError,
    LLMBlockedError,
    stream_with_retry,
)
from google.genai.types import FinishReason


def chunk(text=None, finish_reason=None):
    """A stream chunk shaped like the SDK's.

    `text` is None for a chunk carrying only a thought or a function call —
    the case the whole bug turns on.
    """
    return SimpleNamespace(
        text=text,
        usage_metadata=None,
        candidates=[SimpleNamespace(finish_reason=finish_reason)],
    )


class EmptyGeminiStreamTest(unittest.IsolatedAsyncioTestCase):
    def make_provider(self, script):
        with patch.dict(os.environ, {"GEMINI_API_KEY": "test-key"}):
            provider = GeminiProvider()

        attempts = {"n": 0}

        async def generate_content_stream(**kwargs):
            attempts["n"] += 1
            n = attempts["n"]

            async def gen():
                for item in script(n):
                    yield item

            return gen()

        provider._client = SimpleNamespace(
            aio=SimpleNamespace(
                models=SimpleNamespace(generate_content_stream=generate_content_stream)
            )
        )
        return provider, attempts

    async def stream(self, provider):
        return [
            c
            async for c in provider.send_message_stream(
                model="gemini-3.6-flash",
                message="q",
                history=[],
                system_prompt="s",
            )
        ]

    async def test_malformed_function_call_is_resampled(self):
        """The reproduced failure: a stray function call on a request with no
        tools. Nothing refused the request, so a fresh draw answers it."""

        def script(attempt):
            if attempt == 1:
                return [chunk(finish_reason=FinishReason.MALFORMED_FUNCTION_CALL)]
            return [chunk(text="the answer", finish_reason=FinishReason.STOP)]

        provider, attempts = self.make_provider(script)
        chunks = await self.stream(provider)

        self.assertEqual(attempts["n"], 2)
        self.assertEqual([c.text for c in chunks if c.text], ["the answer"])

    async def test_recitation_is_resampled(self):
        def script(attempt):
            if attempt == 1:
                return [chunk(finish_reason=FinishReason.RECITATION)]
            return [chunk(text="the answer", finish_reason=FinishReason.STOP)]

        provider, attempts = self.make_provider(script)
        chunks = await self.stream(provider)

        self.assertEqual(attempts["n"], 2)
        self.assertEqual([c.text for c in chunks if c.text], ["the answer"])

    async def test_safety_block_is_not_resampled(self):
        """A safety verdict is stable. Re-sampling only burns time and tokens,
        so it surfaces on the first attempt."""

        def script(attempt):
            return [chunk(finish_reason=FinishReason.SAFETY)]

        provider, attempts = self.make_provider(script)
        with self.assertRaises(LLMBlockedError) as caught:
            await self.stream(provider)

        self.assertEqual(attempts["n"], 1)
        self.assertEqual(caught.exception.reason, "SAFETY")

    async def test_thought_only_stream_raises_after_retries(self):
        """Budget spent before the first visible token. Nothing refused, so it
        is retried — but a stream that never produces text must not be
        reported as a successful empty answer."""

        def script(attempt):
            return [chunk(), chunk(finish_reason=FinishReason.MAX_TOKENS)]

        provider, attempts = self.make_provider(script)
        with self.assertRaises(EmptyStreamError):
            await self.stream(provider)

        self.assertEqual(attempts["n"], 3)

    async def test_text_stream_is_left_alone(self):
        def script(attempt):
            return [chunk(text="the answer", finish_reason=FinishReason.STOP)]

        provider, attempts = self.make_provider(script)
        chunks = await self.stream(provider)

        self.assertEqual(attempts["n"], 1)
        self.assertEqual([c.text for c in chunks], ["the answer"])


class StreamWithRetryOnCompleteTest(unittest.IsolatedAsyncioTestCase):
    """The contract every provider now leans on.

    Gemini classifies its finish reason, OpenAI and Anthropic just check
    whether any text arrived — but all three report an empty stream by raising
    from `on_complete`, and rely on this to turn that into a fresh request.
    """

    async def run_stream(self, script, on_complete):
        attempts = {"n": 0}

        async def open_stream():
            attempts["n"] += 1
            n = attempts["n"]

            async def gen():
                for item in script(n):
                    yield item

            return gen()

        collected = [
            item
            async for item in stream_with_retry(
                open_stream,
                delay=0.0,
                description="test",
                on_complete=lambda: on_complete(attempts["n"]),
            )
        ]
        return collected, attempts["n"]

    async def test_on_complete_runs_after_a_clean_stream(self):
        calls = []

        collected, attempts = await self.run_stream(
            lambda n: ["a", "b"], lambda n: calls.append(n)
        )

        self.assertEqual(collected, ["a", "b"])
        self.assertEqual(attempts, 1)
        self.assertEqual(calls, [1])

    async def test_raising_from_on_complete_re_issues_the_request(self):
        def on_complete(attempt):
            if attempt == 1:
                raise EmptyStreamError("nothing to show")

        collected, attempts = await self.run_stream(lambda n: ["a"], on_complete)

        self.assertEqual(attempts, 2)
        # The first attempt emitted a chunk before turning out to be empty, so
        # the caller is told to discard it rather than append to it.
        self.assertIn(STREAM_RESTART, collected)


class ErrorChunkReachesTheClientTest(unittest.IsolatedAsyncioTestCase):
    """chat_with_papers reports a failed answer stream as an error chunk.

    _stream_chat_chunks used to have no branch for it, so the one signal that
    something went wrong was dropped between the generator and the client.
    """

    async def test_error_chunk_is_forwarded(self):
        async def generator():
            yield {"type": "status", "content": "Reading papers..."}
            yield {"type": "error", "content": "Sorry, an error occurred."}

        content_chunks: list = []
        emitted = [
            event
            async for event in _stream_chat_chunks(
                chunk_generator=generator(),
                content_chunks=content_chunks,
                evidence_container={"evidence": None},
            )
        ]

        types = [json.loads(e.split("END_OF_STREAM")[0])["type"] for e in emitted]
        self.assertEqual(types, ["status", "error"])
        self.assertEqual(content_chunks, [])


if __name__ == "__main__":
    unittest.main()
