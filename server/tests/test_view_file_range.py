import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.llm.tools.file_tools import _normalize_line_range, view_file

PAPER_LINES = [f"line {i}" for i in range(1, 11)]


def make_paper():
    return SimpleNamespace(raw_content="\n".join(PAPER_LINES))


def call_view_file(range_start, range_end):
    with patch("app.llm.tools.file_tools.paper_crud.get", return_value=make_paper()):
        return view_file(
            paper_id="paper-1",
            range_start=range_start,
            range_end=range_end,
            current_user=SimpleNamespace(id="user-1"),
            db=None,
        )


class TestNormalizeLineRange(unittest.TestCase):
    def test_range_within_file_is_untouched(self):
        self.assertEqual(_normalize_line_range(3, 7, 10), (3, 7))

    def test_end_past_last_line_is_clamped(self):
        self.assertEqual(_normalize_line_range(8, 60, 10), (8, 10))

    def test_start_below_one_is_clamped(self):
        self.assertEqual(_normalize_line_range(0, 5, 10), (1, 5))

    def test_reversed_range_is_swapped(self):
        self.assertEqual(_normalize_line_range(9, 4, 10), (4, 9))

    def test_single_line_range_is_valid(self):
        self.assertEqual(_normalize_line_range(5, 5, 10), (5, 5))

    def test_non_integer_bounds_fall_back_to_whole_file(self):
        self.assertEqual(_normalize_line_range(None, "abc", 10), (1, 10))

    def test_numeric_strings_are_accepted(self):
        self.assertEqual(_normalize_line_range("2", "4", 10), (2, 4))


class TestViewFileRanges(unittest.TestCase):
    def test_line_numbers_are_one_based_and_inclusive(self):
        result = call_view_file(2, 4)
        self.assertIn("File content from lines 2 to 4 (of 10 total):", result)
        self.assertIn("line 2", result)
        self.assertIn("line 4", result)
        self.assertNotIn("line 5", result)

    def test_overshooting_the_end_returns_the_tail_instead_of_raising(self):
        result = call_view_file(8, 200)
        self.assertIn("File content from lines 8 to 10 (of 10 total):", result)
        self.assertIn("line 10", result)

    def test_start_past_end_of_file_reports_the_length(self):
        result = call_view_file(400, 440)
        self.assertIn("10 lines long", result)
        self.assertIn("lines 1 to 10", result)

    def test_reversed_range_still_returns_content(self):
        result = call_view_file(6, 3)
        self.assertIn("File content from lines 3 to 6 (of 10 total):", result)

    def test_missing_content_still_raises(self):
        with patch(
            "app.llm.tools.file_tools.paper_crud.get",
            return_value=SimpleNamespace(raw_content=""),
        ):
            with self.assertRaises(ValueError):
                view_file(
                    paper_id="paper-1",
                    range_start=1,
                    range_end=5,
                    current_user=SimpleNamespace(id="user-1"),
                    db=None,
                )

    def test_scope_fence_still_raises(self):
        with self.assertRaises(ValueError):
            view_file(
                paper_id="paper-1",
                range_start=1,
                range_end=5,
                current_user=SimpleNamespace(id="user-1"),
                db=None,
                restrict_to_paper_ids=["paper-2"],
            )


if __name__ == "__main__":
    unittest.main()
