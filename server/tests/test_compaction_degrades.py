"""Compaction is an optimization, not a step the turn depends on.

Both compaction passes already degrade when the model's reply cannot be used:
tool results are kept as they were, evidence is truncated. But the model call
itself sat outside that guard, so a provider outage at that one moment failed
the whole turn — after all the evidence had already been gathered. These tests
hold that the call sits inside the same guard as its parsing.
"""

import unittest
from types import SimpleNamespace

from app.llm.evidence_operations import EvidenceOperations
from app.schemas.message import EvidenceCollection
from app.schemas.responses import ToolCall
from google.genai import errors as genai_errors


def overloaded(**kwargs):
    raise genai_errors.ServerError(
        503, {"error": {"code": 503, "status": "UNAVAILABLE", "message": "busy"}}
    )


class CompactionDegradesTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.operations = EvidenceOperations.__new__(EvidenceOperations)
        self.operations.generate_content = overloaded
        self.user = SimpleNamespace(id="user-1")

    async def test_tool_results_are_kept_when_the_compaction_model_is_down(self):
        collection = EvidenceCollection()
        call = ToolCall(id="c1", name="read_file", args={"paper_id": "p1"})
        collection.add_tool_call(call)
        collection.add_tool_call_result(call, "the whole paper " * 100)
        before = collection.get_tool_results_size()

        await self.operations.compact_tool_call_results(collection, "q", self.user)

        self.assertEqual(collection.get_tool_results_size(), before)

    async def test_evidence_is_truncated_when_the_compaction_model_is_down(self):
        collection = EvidenceCollection()
        collection.add_evidence("p1", ["a long passage " * 100])

        async for _ in self.operations.compact_evidence(collection, "q", self.user):
            pass

        self.assertTrue(collection.is_compacted)
        (summary,) = collection.get_evidence_dict()["p1"]
        self.assertTrue(summary.startswith("(summarized)"))


if __name__ == "__main__":
    unittest.main()
