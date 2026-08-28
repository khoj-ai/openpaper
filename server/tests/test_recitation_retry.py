"""What happens when Gemini refuses to narrate a paper it has memorized.

Narrating a whole paper is the longest single generation this app asks for, and
it runs against a published PDF — the exact conditions under which Gemini's
recitation filter kills the candidate and returns nothing at all.

Recitation is the one block reason that is not a property of the request. Safety
and blocklist verdicts are stable: the same prompt earns the same refusal, and
re-asking only burns tokens. Recitation depends on the continuation that got
sampled, so a second draw usually lands somewhere else and succeeds. These tests
hold that distinction — recitation is resampled exactly once, everything else
still surfaces immediately.
"""

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.llm.paper_operations import PaperOperations
from app.llm.provider import GeminiProvider
from app.llm.utils import LLMBlockedError
from google.genai.types import FinishReason

SUMMARY_JSON = '{"summary": "A paper, narrated.", "citations": [], "title": "Overview"}'


def blocked_response(finish_reason) -> SimpleNamespace:
    """A candidate the filter emptied: a finish reason and no parts."""
    return SimpleNamespace(
        prompt_feedback=None,
        candidates=[
            SimpleNamespace(
                finish_reason=finish_reason,
                content=SimpleNamespace(parts=[]),
            )
        ],
    )


class BlockReasonTaggingTest(unittest.TestCase):
    def raise_for(self, finish_reason) -> LLMBlockedError:
        with self.assertRaises(LLMBlockedError) as caught:
            GeminiProvider._raise_for_empty_response(
                blocked_response(finish_reason), "gemini-3.6-flash"
            )
        return caught.exception

    def test_recitation_is_tagged_so_callers_can_single_it_out(self):
        error = self.raise_for(FinishReason.RECITATION)

        self.assertEqual(error.reason, "RECITATION")
        self.assertTrue(error.is_recitation)

    def test_safety_is_tagged_but_is_not_recitation(self):
        error = self.raise_for(FinishReason.SAFETY)

        self.assertEqual(error.reason, "SAFETY")
        self.assertFalse(error.is_recitation)


class NarrativeSummaryRecitationTest(unittest.TestCase):
    """Drive create_narrative_summary with everything but the model stubbed out."""

    def setUp(self):
        # __init__ builds live provider clients from API keys; the seam under
        # test is below that, so skip it.
        self.operations = PaperOperations.__new__(PaperOperations)
        self.calls = 0

        paper = SimpleNamespace(
            id="paper-1",
            title="A Paper",
            s3_object_key="key",
            raw_content=None,
        )
        patches = [
            patch(
                "app.llm.paper_operations.paper_crud",
                SimpleNamespace(get=lambda *a, **k: paper),
            ),
            patch(
                "app.llm.paper_operations.s3_service",
                SimpleNamespace(get_cached_presigned_url=lambda *a, **k: "https://pdf"),
            ),
            patch(
                "app.llm.paper_operations.httpx.get",
                lambda *a, **k: SimpleNamespace(content=b"%PDF-1.4"),
            ),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def summarize(self):
        return self.operations.create_narrative_summary(
            paper_id="paper-1", user=SimpleNamespace(id="user-1"), db=SimpleNamespace()
        )

    def script(self, first: LLMBlockedError):
        """A generate_content that raises `first`, then answers."""

        def generate_content(**kwargs):
            self.calls += 1
            if self.calls == 1:
                raise first
            return SimpleNamespace(text=SUMMARY_JSON)

        return generate_content

    def test_recitation_is_resampled_once_and_the_second_draft_is_returned(self):
        self.operations.generate_content = self.script(
            LLMBlockedError("recited", reason="RECITATION")
        )

        summary = self.summarize()

        self.assertEqual(self.calls, 2)
        self.assertEqual(summary.summary, "A paper, narrated.")

    def test_a_stable_block_is_not_resampled(self):
        self.operations.generate_content = self.script(
            LLMBlockedError("unsafe", reason="SAFETY")
        )

        with self.assertRaises(LLMBlockedError):
            self.summarize()

        self.assertEqual(self.calls, 1)

    def test_a_second_recitation_gives_up_rather_than_looping(self):
        def always_recites(**kwargs):
            self.calls += 1
            raise LLMBlockedError("recited", reason="RECITATION")

        self.operations.generate_content = always_recites

        with self.assertRaises(LLMBlockedError):
            self.summarize()

        self.assertEqual(self.calls, 2)


if __name__ == "__main__":
    unittest.main()
