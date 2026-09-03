"""The answering model gets a request that declares no tools.

`describe_actions()` is the one place the gathering loop's activity crosses into
that request, so it is the one place a tool name could leak in. When it did, and
the evidence came back empty, Gemini answered the apparent offer with a function
call, terminated the candidate as MALFORMED_FUNCTION_CALL, and the user got a
blank turn. Measured side by side on gemini-3.6-flash: 10/20 blank with the tool
name in the block, 0/20 without it.
"""

import unittest

from app.llm.tools.file_tools import (
    read_abstract_function,
    read_file_function,
    search_all_files_function,
    search_file_function,
    view_file_function,
)
from app.schemas.message import EvidenceCollection
from app.schemas.responses import ToolCall

GATHERING_TOOL_NAMES = [
    tool["name"]
    for tool in (
        read_abstract_function,
        read_file_function,
        search_all_files_function,
        search_file_function,
        view_file_function,
    )
]


def _collection(*tool_names: str, evidence: bool = False) -> EvidenceCollection:
    collection = EvidenceCollection()
    for name in tool_names:
        collection.previous_tool_calls.append(ToolCall(name=name, args={"query": "q"}))
    if evidence:
        collection.add_evidence("paper-1", ["Section 4.2 describes the setup."])
    return collection


class ActionsBlockHidesToolNamesTest(unittest.TestCase):
    def test_no_tool_name_reaches_the_answering_model(self):
        for name in GATHERING_TOOL_NAMES:
            for has_evidence in (False, True):
                with self.subTest(tool=name, evidence=has_evidence):
                    actions = _collection(
                        name, evidence=has_evidence
                    ).describe_actions()
                    self.assertIsNotNone(actions)
                    self.assertNotIn(name, str(actions))

    def test_the_search_count_still_gets_through(self):
        actions = _collection(
            "search_all_files", "search_file", "read_abstract", evidence=True
        ).describe_actions()
        assert actions is not None
        self.assertIn("3", actions["evidence_gathering"])

    def test_an_empty_search_says_so(self):
        empty = _collection("search_all_files").describe_actions()
        found = _collection("search_all_files", evidence=True).describe_actions()
        assert empty is not None and found is not None
        self.assertIn("Nothing matched", empty["evidence_gathering"])
        self.assertNotIn("Nothing matched", found["evidence_gathering"])


if __name__ == "__main__":
    unittest.main()
