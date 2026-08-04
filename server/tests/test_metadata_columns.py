import unittest
from datetime import datetime
from types import SimpleNamespace

from app.helpers.metadata_columns import (
    fill_metadata_cells,
    match_metadata_field,
    metadata_cell_value,
)
from app.schemas.responses import DataTableCellValue, DataTableRow, ResponseCitation


def make_paper(**overrides) -> SimpleNamespace:
    defaults = dict(
        authors=["Ada Lovelace", "Charles Babbage"],
        publish_date=datetime(2017, 4, 1),
        institutions=["Analytical Engine Institute"],
        journal="Journal of Computing",
        doi="10.1000/xyz123",
        title="On Computable Numbers",
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


class TestMatchMetadataField(unittest.TestCase):
    def test_label_variants_match(self):
        for label, field in [
            ("Author(s)", "authors"),
            ("authors", "authors"),
            ("Author Names", "authors"),
            ("Year", "year"),
            ("Publication Year", "year"),
            ("Publication Date", "publish_date"),
            ("Institution(s)", "institutions"),
            ("Affiliations", "institutions"),
            ("Journal", "journal"),
            ("DOI", "doi"),
            ("Paper Title", "title"),
        ]:
            self.assertEqual(match_metadata_field(label), field, label)

    def test_containing_a_keyword_is_not_a_match(self):
        for label in [
            "Authorship bias",
            "Yearly growth",
            "Sample Size (n)",
            "Key Findings",
            "Journal impact factor",
            "Contribution to Understanding PPCT Model",
        ]:
            self.assertIsNone(match_metadata_field(label), label)


class TestMetadataCellValue(unittest.TestCase):
    def test_formats_each_field(self):
        paper = make_paper()
        self.assertEqual(
            metadata_cell_value(paper, "authors"), "Ada Lovelace, Charles Babbage"
        )
        self.assertEqual(metadata_cell_value(paper, "year"), "2017")
        self.assertEqual(metadata_cell_value(paper, "publish_date"), "2017-04-01")
        self.assertEqual(
            metadata_cell_value(paper, "institutions"), "Analytical Engine Institute"
        )
        self.assertEqual(metadata_cell_value(paper, "journal"), "Journal of Computing")
        self.assertEqual(metadata_cell_value(paper, "doi"), "10.1000/xyz123")
        self.assertEqual(metadata_cell_value(paper, "title"), "On Computable Numbers")

    def test_missing_values_return_none(self):
        paper = make_paper(
            authors=None, publish_date=None, institutions=[], journal="", doi=None
        )
        for field in [
            "authors",
            "year",
            "publish_date",
            "institutions",
            "journal",
            "doi",
        ]:
            self.assertIsNone(metadata_cell_value(paper, field), field)
        self.assertIsNone(metadata_cell_value(None, "authors"))


class TestFillMetadataCells(unittest.TestCase):
    def make_row(self, paper_id: str, values: dict[str, str]) -> DataTableRow:
        return DataTableRow(
            paper_id=paper_id,
            values={
                col: DataTableCellValue(
                    value=val,
                    citations=[ResponseCitation(text=f"quote for {col}", index=1)],
                )
                for col, val in values.items()
            },
        )

    def test_stored_values_overwrite_and_fill(self):
        # "Author(s)" was never extracted (stripped); "Year" was extracted as N/A
        row = self.make_row("p1", {"Year": "N/A", "Sample Size (n)": "612"})
        entries = [
            {
                "label": "Author(s)",
                "kind": "metadata",
                "field": "authors",
                "extract": False,
            },
            {"label": "Year", "kind": "metadata", "field": "year", "extract": True},
        ]
        fill_metadata_cells([row], entries, {"p1": make_paper()})
        self.assertEqual(row.values["Author(s)"].value, "Ada Lovelace, Charles Babbage")
        self.assertEqual(row.values["Author(s)"].citations, [])
        self.assertEqual(row.values["Year"].value, "2017")
        self.assertEqual(row.values["Sample Size (n)"].value, "612")

    def test_extracted_value_kept_when_paper_lacks_metadata(self):
        row = self.make_row("p1", {"Year": "2019"})
        entries = [
            {"label": "Year", "kind": "metadata", "field": "year", "extract": True}
        ]
        fill_metadata_cells([row], entries, {"p1": make_paper(publish_date=None)})
        self.assertEqual(row.values["Year"].value, "2019")
        self.assertEqual(len(row.values["Year"].citations), 1)

    def test_missing_paper_and_malformed_entries_are_safe(self):
        row = self.make_row("p1", {"Year": "N/A"})
        entries = [
            {"label": "Year", "kind": "metadata", "field": "year"},
            {"kind": "metadata", "field": "authors"},
            {"label": "Authors", "kind": "metadata"},
        ]
        fill_metadata_cells([row], entries, {})
        self.assertEqual(row.values["Year"].value, "N/A")


if __name__ == "__main__":
    unittest.main()
