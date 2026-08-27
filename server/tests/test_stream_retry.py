"""What happens when the model's connection dies mid-answer.

The upstream closes with bytes still owed — httpx calls it "incomplete chunked
read" — and there is no way to resume: the answer so far is half a sentence, and
asking again produces different words, not a continuation. So the whole request
is re-sent and the abandoned attempt is thrown away.

Thrown away is the part worth pinning. A restart that merely appends leaves the
user reading one answer glued onto the truncated start of another, and saves
that to the database. These tests hold the seam: everything from the dead
attempt is dropped, everything from the phase before it survives, and failures
that a retry cannot fix still surface as errors.
"""

import asyncio
import json
import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import httpx
from app.api.message_api import _stream_chat_chunks
from app.llm.provider import GeminiProvider
from app.llm.utils import STREAM_RESTART, stream_with_retry


def dropped_connection() -> httpx.RemoteProtocolError:
    return httpx.RemoteProtocolError(
        "peer closed connection without sending complete message body "
        "(incomplete chunked read)"
    )


async def collect(agen) -> list:
    return [item async for item in agen]


class StreamWithRetryTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.attempts = 0

    def opener(self, script):
        """Build an open_stream whose Nth call runs script(N)."""

        async def open_stream():
            self.attempts += 1
            attempt = self.attempts

            async def gen():
                async for item in script(attempt):
                    yield item

            return gen()

        return open_stream

    async def test_clean_stream_opens_one_request_and_signals_no_restart(self):
        async def script(attempt):
            yield "a"
            yield "b"

        out = await collect(stream_with_retry(self.opener(script), delay=0))

        self.assertEqual(out, ["a", "b"])
        self.assertEqual(self.attempts, 1)

    async def test_drop_mid_answer_resends_and_marks_the_seam(self):
        async def script(attempt):
            yield "partial"
            if attempt == 1:
                raise dropped_connection()
            yield " complete"

        out = await collect(stream_with_retry(self.opener(script), delay=0))

        self.assertEqual(self.attempts, 2)
        # The marker sits between the abandoned attempt and its replacement so a
        # consumer can tell which side of the drop each chunk came from.
        self.assertEqual(out, ["partial", STREAM_RESTART, "partial", " complete"])

    async def test_drop_before_any_chunk_retries_without_a_restart_marker(self):
        """Nothing reached the caller, so there is nothing to discard."""

        async def script(attempt):
            if attempt == 1:
                raise dropped_connection()
            yield "answer"

        out = await collect(stream_with_retry(self.opener(script), delay=0))

        self.assertEqual(self.attempts, 2)
        self.assertEqual(out, ["answer"])

    async def test_failure_to_open_the_stream_is_retried(self):
        """The connection can die before the response body ever starts."""
        attempts = 0

        async def open_stream():
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                raise httpx.ConnectError("connection reset by peer")

            async def gen():
                yield "answer"

            return gen()

        out = await collect(stream_with_retry(open_stream, delay=0))

        self.assertEqual(out, ["answer"])
        self.assertEqual(attempts, 2)

    async def test_persistent_drops_surface_the_underlying_error(self):
        async def script(attempt):
            raise dropped_connection()
            yield  # pragma: no cover - unreachable; makes this a generator

        with self.assertRaises(httpx.RemoteProtocolError):
            await collect(
                stream_with_retry(self.opener(script), max_retries=2, delay=0)
            )

        self.assertEqual(self.attempts, 3)  # first attempt plus two retries

    async def test_model_errors_are_not_retried(self):
        """Only transport failures get re-sent; a refusal would just repeat."""

        async def script(attempt):
            yield "x"
            raise ValueError("Gemini declined to answer")

        with self.assertRaises(ValueError):
            await collect(stream_with_retry(self.opener(script), delay=0))

        self.assertEqual(self.attempts, 1)

    async def test_retry_waits_between_attempts(self):
        """Re-sending instantly just hammers an upstream that is already unwell."""

        async def script(attempt):
            if attempt == 1:
                raise dropped_connection()
            yield "answer"

        slept = []

        real_sleep = asyncio.sleep

        async def fake_sleep(seconds):
            slept.append(seconds)
            await real_sleep(0)

        asyncio.sleep = fake_sleep
        try:
            await collect(stream_with_retry(self.opener(script), delay=1.0))
        finally:
            asyncio.sleep = real_sleep

        self.assertEqual(len(slept), 1)
        self.assertGreater(slept[0], 0)


class ResetChunkTest(unittest.IsolatedAsyncioTestCase):
    """The reset signal has to reach the accumulator that feeds the database."""

    async def test_reset_discards_the_abandoned_answer_before_it_is_persisted(self):
        async def chunks():
            yield {"type": "artifact", "content": {"id": "a1"}}
            yield {"type": "status", "content": "Reading papers..."}
            yield {"type": "content", "content": "partial ans"}
            yield {"type": "references", "content": {"citations": ["stale"]}}
            yield {"type": "reset", "content": ""}
            yield {"type": "content", "content": "full answer"}
            yield {"type": "references", "content": {"citations": ["fresh"]}}

        content_chunks: list = []
        evidence_container: dict = {"evidence": None}
        artifacts: list = []
        status_messages: list = []

        emitted = await collect(
            _stream_chat_chunks(
                chunk_generator=chunks(),
                content_chunks=content_chunks,
                evidence_container=evidence_container,
                artifacts=artifacts,
                status_messages=status_messages,
            )
        )

        # What gets saved is the replacement answer alone, not both attempts.
        self.assertEqual("".join(content_chunks), "full answer")
        self.assertEqual(evidence_container["evidence"], {"citations": ["fresh"]})

        # Artifacts and status come from the evidence phase that ran before the
        # answer stream opened; restarting the answer must not drop them.
        self.assertEqual(artifacts, [{"id": "a1"}])
        self.assertEqual(status_messages, ["Reading papers..."])

        # And the client is told to clear what it already rendered.
        types = [json.loads(e.split("END_OF_STREAM")[0])["type"] for e in emitted]
        self.assertEqual(
            types,
            [
                "artifact",
                "status",
                "content",
                "references",
                "reset",
                "content",
                "references",
            ],
        )


class GeminiProviderStreamTest(unittest.IsolatedAsyncioTestCase):
    """The provider has to turn a dropped connection into a restart chunk.

    Pinned at the provider because that is the only layer that knows the
    request was re-sent; everything downstream just sees StreamChunks.
    """

    def make_provider(self, script):
        with patch.dict(os.environ, {"GEMINI_API_KEY": "test-key"}):
            provider = GeminiProvider()

        attempts = {"n": 0}

        async def generate_content_stream(**kwargs):
            attempts["n"] += 1
            attempt = attempts["n"]

            async def gen():
                async for text in script(attempt):
                    yield SimpleNamespace(text=text, usage_metadata=None)

            return gen()

        provider._client = SimpleNamespace(
            aio=SimpleNamespace(
                models=SimpleNamespace(generate_content_stream=generate_content_stream)
            )
        )
        return provider, attempts

    async def stream(self, provider):
        return [
            chunk
            async for chunk in provider.send_message_stream(
                model="gemini-3.6-flash",
                message="q",
                history=[],
                system_prompt="s",
            )
        ]

    async def test_dropped_stream_is_resent_and_flagged_as_a_restart(self):
        async def script(attempt):
            yield "half an ans"
            if attempt == 1:
                raise dropped_connection()
            yield "wer"

        provider, attempts = self.make_provider(script)
        chunks = await self.stream(provider)

        self.assertEqual(attempts["n"], 2)
        self.assertEqual(
            [(c.text, c.is_restart) for c in chunks],
            [
                ("half an ans", False),
                ("", True),
                ("half an ans", False),
                ("wer", False),
            ],
        )

    async def test_clean_stream_flags_no_restart(self):
        async def script(attempt):
            yield "the answer"

        provider, attempts = self.make_provider(script)
        chunks = await self.stream(provider)

        self.assertEqual(attempts["n"], 1)
        self.assertEqual(
            [(c.text, c.is_restart) for c in chunks], [("the answer", False)]
        )


if __name__ == "__main__":
    unittest.main()
