"""What happens when the provider behind an answer stream fails outright.

Gemini's own retries cover a blip: the SDK re-issues a 503, a dropped connection
is re-sent, a recitation or stray function call is re-sampled. When those run
out the failure used to reach the user as a dead turn, even though two other
providers were configured and idle. These tests hold the seam where the request
is handed to one of them instead: the fallback answers when the primary is
overloaded, rate-limited, or keeps landing on a verdict a fresh draw could
clear; whatever the primary already streamed is discarded first; and a failure
a different provider cannot fix is raised as-is.
"""

import os
import unittest
from unittest.mock import patch

import anthropic
import httpx
import openai
from app.llm.base import BaseLLMClient, _fallback_provider_from_env
from app.llm.provider import LLMProvider, StreamChunk
from app.llm.utils import EmptyStreamError, LLMBlockedError, is_provider_outage
from google.genai import errors as genai_errors


def gemini_status(code: int, status: str) -> genai_errors.APIError:
    payload = {"error": {"code": code, "status": status, "message": status}}
    cls = genai_errors.ServerError if code >= 500 else genai_errors.ClientError
    return cls(code, payload)


def sdk_status(cls, code: int):
    """An openai/anthropic APIStatusError carrying the given HTTP status."""
    response = httpx.Response(code, request=httpx.Request("POST", "https://api"))
    return cls("upstream", response=response, body=None)


class FakeProvider:
    """A provider whose stream plays back a script: text to yield, or an
    exception to raise at that point."""

    def __init__(self, provider: LLMProvider, script):
        self.provider = provider
        self.script = list(script)
        self.calls = 0

    def get_default_model(self) -> str:
        return f"{self.provider.value}-default"

    def get_fast_model(self) -> str:
        return f"{self.provider.value}-fast"

    async def send_message_stream(
        self, model, message, history, system_prompt, file=None, **kwargs
    ):
        self.calls += 1
        for item in self.script:
            if isinstance(item, BaseException):
                raise item
            yield StreamChunk(text=item, model=model, provider=self.provider)


class AnswerStreamFallbackTest(unittest.IsolatedAsyncioTestCase):
    def make_client(
        self,
        primary_script,
        fallback_script=("a fallback answer",),
        fallback=LLMProvider.OPENAI,
    ) -> BaseLLMClient:
        # __init__ builds live provider clients from API keys; the seam under
        # test sits above that.
        client = BaseLLMClient.__new__(BaseLLMClient)
        client.default_provider = LLMProvider.GEMINI
        client.fallback_provider = fallback
        self.primary = FakeProvider(LLMProvider.GEMINI, primary_script)
        self.secondary = FakeProvider(LLMProvider.OPENAI, fallback_script)
        client._providers = {
            LLMProvider.GEMINI: self.primary,
            LLMProvider.OPENAI: self.secondary,
        }
        return client

    async def stream(self, client, **kwargs):
        return [
            chunk
            async for chunk in client.send_message_stream(
                message="q", history=[], system_prompt="s", **kwargs
            )
        ]

    async def test_overloaded_primary_is_answered_by_the_fallback(self):
        client = self.make_client([gemini_status(503, "UNAVAILABLE")])

        with patch("app.llm.base.track_event") as track_event:
            chunks = await self.stream(client)

        self.assertEqual(
            [(c.text, c.provider, c.is_restart) for c in chunks],
            [("a fallback answer", LLMProvider.OPENAI, False)],
        )
        self.assertEqual((self.primary.calls, self.secondary.calls), (1, 1))
        event, props = track_event.call_args.args
        self.assertEqual(event, "llm_stream_fallback")
        self.assertEqual(
            (props["from_provider"], props["to_provider"]), ("gemini", "openai")
        )

    async def test_partial_answer_is_discarded_before_the_fallback_answers(self):
        """The primary streamed half an answer, then kept emitting a stray
        function call until its re-samples ran out. Another model cannot
        continue that half, so the consumer is told to drop it first."""
        client = self.make_client(
            [
                "half an ans",
                LLMBlockedError("declined", reason="MALFORMED_FUNCTION_CALL"),
            ]
        )

        chunks = await self.stream(client)

        self.assertEqual(
            [(c.text, c.is_restart) for c in chunks],
            [("half an ans", False), ("", True), ("a fallback answer", False)],
        )
        self.assertEqual(chunks[1].provider, LLMProvider.OPENAI)

    async def test_stable_block_is_not_handed_to_another_provider(self):
        client = self.make_client([LLMBlockedError("unsafe", reason="SAFETY")])

        with self.assertRaises(LLMBlockedError):
            await self.stream(client)

        self.assertEqual(self.secondary.calls, 0)

    async def test_our_own_bugs_are_not_handed_to_another_provider(self):
        client = self.make_client([ValueError("paper not found")])

        with self.assertRaises(ValueError):
            await self.stream(client)

        self.assertEqual(self.secondary.calls, 0)

    async def test_without_a_fallback_the_failure_surfaces(self):
        client = self.make_client([gemini_status(503, "UNAVAILABLE")], fallback=None)

        with self.assertRaises(genai_errors.ServerError):
            await self.stream(client)

    async def test_the_fallback_provider_is_not_retried_on_itself(self):
        """The user picked the fallback provider explicitly and it is down.
        There is nowhere else to go, and re-sending to the same provider would
        only fail the same way."""
        client = self.make_client(
            [], fallback_script=[sdk_status(openai.APIStatusError, 503)]
        )

        with self.assertRaises(openai.APIStatusError):
            await self.stream(client, provider=LLMProvider.OPENAI)

        self.assertEqual((self.primary.calls, self.secondary.calls), (0, 1))

    async def test_a_failing_fallback_surfaces_its_own_error(self):
        client = self.make_client(
            [gemini_status(503, "UNAVAILABLE")],
            fallback_script=[sdk_status(openai.APIStatusError, 502)],
        )

        with self.assertRaises(openai.APIStatusError):
            await self.stream(client)

        self.assertEqual((self.primary.calls, self.secondary.calls), (1, 1))


class ProviderOutageClassificationTest(unittest.TestCase):
    def test_what_another_provider_can_and_cannot_fix(self):
        cases = [
            (gemini_status(503, "UNAVAILABLE"), True),
            (gemini_status(429, "RESOURCE_EXHAUSTED"), True),
            (gemini_status(400, "INVALID_ARGUMENT"), False),
            (sdk_status(openai.APIStatusError, 502), True),
            (sdk_status(openai.APIStatusError, 401), False),
            (sdk_status(anthropic.APIStatusError, 529), True),
            (httpx.RemoteProtocolError("incomplete chunked read"), True),
            (EmptyStreamError("no answer text"), True),
            (LLMBlockedError("recited", reason="RECITATION"), True),
            (LLMBlockedError("unsafe", reason="SAFETY"), False),
            (ValueError("bug"), False),
        ]
        for exc, expected in cases:
            with self.subTest(exc=exc):
                self.assertIs(is_provider_outage(exc), expected)


class FallbackProviderConfigTest(unittest.TestCase):
    def test_defaults_to_openai_and_can_be_switched_off(self):
        with patch.dict(os.environ):
            os.environ.pop("LLM_FALLBACK_PROVIDER", None)
            self.assertEqual(_fallback_provider_from_env(), LLMProvider.OPENAI)
        with patch.dict(os.environ, {"LLM_FALLBACK_PROVIDER": "anthropic"}):
            self.assertEqual(_fallback_provider_from_env(), LLMProvider.ANTHROPIC)
        with patch.dict(os.environ, {"LLM_FALLBACK_PROVIDER": ""}):
            self.assertIsNone(_fallback_provider_from_env())


if __name__ == "__main__":
    unittest.main()
