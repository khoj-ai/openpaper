"""What the chat endpoint puts on the wire while the model is thinking.

A hard question spends 50-110s inside the model before its first token, and
the stream carried nothing during that window. nginx closes an idle response
at 60s, Cloudflare at 100s, so the browser saw the body fail, dropped the
answer it had drawn, and reported an error for a turn that was still being
written — reproducibly, for whichever action was slowest.

These tests hold the seams that fix introduced: a quiet stream still puts
bytes on the wire; those bytes reach neither the client's decoder nor what is
persisted; a failure raised on the drain task still surfaces; and an abandoned
stream does not leave that task reading the model.
"""

import asyncio
import json
import unittest
from unittest.mock import patch

from app.api import message_api
from app.api.message_api import END_DELIMITER, _stream_chat_chunks


def parse_client_side(frames: list[str]) -> tuple[list[dict], str]:
    """Decode a stream the way every chat client in the web app does.

    A transcription of the loop in SidePanelContent.tsx, and of the identical
    one on the project and understand pages: accumulate, split on the
    delimiter, hold the trailing part back as incomplete, skip blank events,
    parse the rest. Returns what the client would render and whatever is left
    in its buffer — which has to be empty, or a keep-alive has run into the
    frame behind it.
    """
    events: list[dict] = []
    buffer = ""
    for frame in frames:
        buffer += frame
        parts = buffer.split(END_DELIMITER)
        buffer = parts.pop() or ""
        for event in parts:
            if not event.strip():
                continue
            events.append(json.loads(event.strip()))
    return events, buffer


class KeepAliveTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        patcher = patch.object(message_api, "KEEPALIVE_INTERVAL_SECONDS", 0.02)
        patcher.start()
        self.addCleanup(patcher.stop)

    async def stream(self, chunk_generator):
        """Run a turn, returning its wire frames and what the caller recorded."""
        content_chunks: list[str] = []
        evidence_container: dict = {"evidence": None}
        frames = [
            frame
            async for frame in _stream_chat_chunks(
                chunk_generator=chunk_generator,
                content_chunks=content_chunks,
                evidence_container=evidence_container,
            )
        ]
        return frames, content_chunks, evidence_container

    async def test_a_thinking_model_still_puts_bytes_on_the_wire(self):
        """The failure this fixes: a gap longer than the proxy will wait."""

        async def thinks_then_answers():
            await asyncio.sleep(0.12)
            yield {"type": "content", "content": "the answer"}

        frames, _, _ = await self.stream(thinks_then_answers())

        # Several ticks fit in the gap, each one its own write.
        self.assertGreaterEqual(len(frames), 3)
        self.assertEqual(frames[0], END_DELIMITER)

    async def test_a_keepalive_reaches_neither_the_client_nor_the_database(self):
        """Why no client change and no data change were needed. A client that
        has never heard of a keep-alive decodes exactly the events the turn
        produced, and what gets persisted is untouched — an implementation
        that ticked with, say, an empty content chunk would pass neither."""

        async def thinks_then_answers():
            await asyncio.sleep(0.07)
            yield {"type": "content", "content": "part one"}
            await asyncio.sleep(0.07)
            yield {"type": "content", "content": " and two"}
            yield {"type": "references", "content": {"citations": [{"key": 1}]}}

        frames, content_chunks, evidence = await self.stream(thinks_then_answers())
        rendered, leftover = parse_client_side(frames)

        self.assertGreater(len(frames), 3)  # ticks did fire
        self.assertEqual(
            rendered,
            [
                {"type": "content", "content": "part one"},
                {"type": "content", "content": " and two"},
                {"type": "references", "content": {"citations": [{"key": 1}]}},
            ],
        )
        self.assertEqual(leftover, "")
        self.assertEqual(content_chunks, ["part one", " and two"])
        self.assertEqual(evidence["evidence"], {"citations": [{"key": 1}]})

    async def test_a_failure_during_the_gap_still_surfaces(self):
        """Draining the source on another task routes its exception through a
        queue. Losing it there would turn every failed turn into a clean empty
        one, which is saved and reported quite differently."""

        async def thinks_then_fails():
            await asyncio.sleep(0.07)
            raise RuntimeError("upstream gave up")
            yield  # pragma: no cover - makes this an async generator

        with self.assertRaises(RuntimeError) as caught:
            await self.stream(thinks_then_fails())

        self.assertEqual(str(caught.exception), "upstream gave up")

    async def test_the_drain_stops_when_the_client_goes_away(self):
        """Users abandon slow turns, and the task behind one is holding the
        provider's response open until it is cancelled.

        The wait below is not incidental: closing this generator releases the
        drain through async-generator finalization, which takes a few loop
        turns to chain. Without the cancellation it never happens at all, and
        the task sits there reading the model for the rest of the turn.
        """

        async def never_ends():
            yield {"type": "content", "content": "first"}
            await asyncio.sleep(30)
            yield {"type": "content", "content": "second"}  # pragma: no cover

        def still_running():
            return [t for t in asyncio.all_tasks() if t is not asyncio.current_task()]

        stream = _stream_chat_chunks(
            chunk_generator=never_ends(),
            content_chunks=[],
            evidence_container={"evidence": None},
        )
        self.assertIn("first", await stream.__anext__())
        await stream.aclose()

        for _ in range(50):
            if not still_running():
                break
            await asyncio.sleep(0.01)
        self.assertEqual(still_running(), [])
