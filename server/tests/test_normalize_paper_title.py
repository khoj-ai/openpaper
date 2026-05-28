import unittest

from app.helpers.paper_search import (
    MIN_NORMALIZED_TITLE_LENGTH,
    normalize_paper_title,
)


class TestNormalizePaperTitle(unittest.TestCase):
    def test_case_insensitive(self) -> None:
        self.assertEqual(
            normalize_paper_title("Attention Is All You Need"),
            normalize_paper_title("attention is all you need"),
        )

    def test_whitespace_and_punctuation(self) -> None:
        self.assertEqual(
            normalize_paper_title("  Attention   Is All You Need.  "),
            normalize_paper_title("Attention Is All You Need"),
        )

    def test_empty(self) -> None:
        self.assertIsNone(normalize_paper_title(None))
        self.assertIsNone(normalize_paper_title(""))
        self.assertIsNone(normalize_paper_title("   "))

    def test_short_title_rejected(self) -> None:
        short = "a" * (MIN_NORMALIZED_TITLE_LENGTH - 1)
        self.assertIsNone(normalize_paper_title(short))
        long_enough = "a" * MIN_NORMALIZED_TITLE_LENGTH
        self.assertEqual(normalize_paper_title(long_enough), long_enough)


if __name__ == "__main__":
    unittest.main()
