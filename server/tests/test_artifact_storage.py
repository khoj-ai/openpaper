"""What an artifact is on the wire must survive being stored as columns.

Storage is now a table per kind, and the API still promises the payload it
always sent. That promise is only kept if writing a payload out to rows and
reading it back reproduces it exactly, so that is what these assert — with no
database, because building the ORM objects and reading them back is where the
translation happens.
"""

import unittest
import uuid

from app.database.crud.artifact_crud import _build
from app.database.models import ChartFieldRole
from app.schemas.artifact import CitationArtifactPayload, artifact_payload_adapter
from app.schemas.chart import ChartArtifactPayload

PAPER_A = str(uuid.uuid4())
PAPER_B = str(uuid.uuid4())
PAPER_C = str(uuid.uuid4())


def chart_payload(**overrides) -> dict:
    """A chart using every part of the shape: a series, a derived y, a point
    that could not be plotted, and a paper that supplied nothing."""
    payload = {
        "kind": "chart",
        "plan": {
            "title": "Accuracy by benchmark",
            "chart_type": "bar",
            "x": {"key": "benchmark", "label": "Benchmark", "unit": None},
            "y": {"key": "accuracy", "label": "Accuracy", "unit": "%"},
            "series": {"key": "model", "label": "Model", "unit": None},
            "fields": [
                {"key": "correct", "label": "Correct", "unit": None},
                {"key": "total", "label": "Total", "unit": None},
            ],
            "calculation": {
                "label": "Accuracy",
                "spec": "correct / total * 100",
                "inputs": ["correct", "total"],
            },
        },
        "records": [
            {
                "record_id": "rec-1",
                "paper_id": PAPER_A,
                "paper_title": "A study",
                "values": {
                    "benchmark": {
                        "value": "GSM8K",
                        "quote": "on GSM8K",
                        "line_number": "12",
                        "unit": None,
                        "conversion": "",
                        "conversion_note": None,
                        "number": None,
                    },
                    "accuracy": {
                        "value": "0.653",
                        "quote": "GPT-4o | 0.653",
                        "line_number": "Table 1",
                        "unit": None,
                        "conversion": "lambda v: v * 100",
                        "conversion_note": None,
                        "number": 65.3,
                    },
                },
                "exclusion_reason": None,
            },
            {
                "record_id": "rec-2",
                "paper_id": PAPER_B,
                "paper_title": "Another study",
                "values": {
                    "accuracy": {
                        "value": "8.4",
                        "quote": "8.4 mg/dL",
                        "line_number": None,
                        "unit": "mg/dl",
                        "conversion": "",
                        "conversion_note": "mg/dL cannot be expressed as a percentage",
                        "number": 8.4,
                    }
                },
                "exclusion_reason": "Reported Accuracy in mg/dL, which could not be expressed in %",
            },
        ],
        "coverage": {
            "searched_paper_ids": [PAPER_A, PAPER_B, PAPER_C],
            "included_paper_ids": [PAPER_A],
            "excluded": {
                PAPER_C: "We read this paper and found no directly quoted Accuracy"
            },
        },
        "series_by_paper": True,
        "computation": {"script": "print(1)", "stdout": "1"},
        "conversions": {"version": 1, "harness": "…", "results": {}},
        "warnings": ["2 values were converted from an unnamed unit to %"],
        "extraction_steps": ["Read 'A study'"],
        "investigation_trace": {"status_messages": ["Searched every paper"]},
    }
    payload.update(overrides)
    return payload


def citation_payload(**overrides) -> dict:
    payload = {
        "kind": "citation",
        "paper_id": PAPER_A,
        "preferred_style": "APA",
        "style_display": "APA 7th Edition",
        "method": "cached",
        "confidence": None,
        "missing_fields": ["publisher"],
        "data": {
            "paper_id": PAPER_A,
            "title": "Alignment Faking in Large Language Models",
            "authors": ["Ryan Greenblatt", "Carson Denison"],
            "publish_date": "2024-12-18T00:00:00",
            "journal": "arXiv (Cornell University)",
            "publisher": None,
            "doi": "10.48550/arxiv.2412.14093",
        },
    }
    payload.update(overrides)
    return payload


def round_trip(payload: dict) -> dict:
    artifact = _build(artifact_payload_adapter.validate_python(payload))
    assert artifact is not None
    return artifact.to_payload()


class TestAPayloadSurvivesStorage(unittest.TestCase):
    def test_a_chart_comes_back_as_it_went_in(self):
        payload = chart_payload()
        self.assertEqual(round_trip(payload), payload)

    def test_a_citation_comes_back_as_it_went_in(self):
        payload = citation_payload()
        self.assertEqual(round_trip(payload), payload)

    def test_a_chart_without_a_series_or_calculation_round_trips(self):
        payload = chart_payload()
        payload["plan"]["series"] = None
        payload["plan"]["calculation"] = None
        payload["series_by_paper"] = False
        self.assertEqual(round_trip(payload), payload)

    def test_the_order_of_points_is_the_order_the_chart_was_built_in(self):
        # The figure sorts, but the stored order is the extraction's own and a
        # set of rows has none of its own accord.
        payload = chart_payload()
        returned = round_trip(payload)
        self.assertEqual(
            [record["record_id"] for record in returned["records"]],
            ["rec-1", "rec-2"],
        )


class TestTheKindSelectsTheShape(unittest.TestCase):
    def test_a_payload_is_parsed_as_the_kind_it_declares(self):
        chart = artifact_payload_adapter.validate_python(chart_payload())
        citation = artifact_payload_adapter.validate_python(citation_payload())
        self.assertIsInstance(chart, ChartArtifactPayload)
        self.assertIsInstance(citation, CitationArtifactPayload)

    def test_a_citation_that_does_not_match_its_kind_is_refused(self):
        # The whole point of the discriminated union: a malformed artifact
        # fails at the boundary rather than being stored unreadable.
        broken = citation_payload()
        del broken["preferred_style"]
        with self.assertRaises(Exception):
            artifact_payload_adapter.validate_python(broken)


class TestWhatCannotBeStored(unittest.TestCase):
    def test_a_record_naming_something_that_is_not_a_paper_is_dropped(self):
        payload = chart_payload()
        payload["records"][1]["paper_id"] = "not-a-uuid"
        returned = round_trip(payload)
        self.assertEqual([r["record_id"] for r in returned["records"]], ["rec-1"])

    def test_a_citation_naming_something_that_is_not_a_paper_is_not_stored(self):
        payload = citation_payload(paper_id="not-a-uuid")
        self.assertIsNone(_build(artifact_payload_adapter.validate_python(payload)))

    def test_null_characters_are_stripped_from_a_quote(self):
        # Postgres cannot store NUL, and quotes lifted out of a PDF carry one
        # often enough that it used to be handled for the whole JSON blob.
        payload = chart_payload()
        payload["records"][0]["values"]["accuracy"]["quote"] = "GPT-4o\x00 | 0.653"
        returned = round_trip(payload)
        self.assertEqual(
            returned["records"][0]["values"]["accuracy"]["quote"], "GPT-4o | 0.653"
        )


class TestThePlansFieldsBecomeRows(unittest.TestCase):
    def test_each_field_carries_the_position_it_holds_in_the_plan(self):
        artifact = _build(artifact_payload_adapter.validate_python(chart_payload()))
        assert artifact is not None
        roles = {field.key: field.role for field in artifact.fields}
        self.assertEqual(roles["benchmark"], ChartFieldRole.X.value)
        self.assertEqual(roles["accuracy"], ChartFieldRole.Y.value)
        self.assertEqual(roles["model"], ChartFieldRole.SERIES.value)
        self.assertEqual(roles["correct"], ChartFieldRole.PRIMITIVE.value)

    def test_a_primitive_listed_twice_is_stored_once(self):
        # A plan often repeats a field in `fields`; one key is one row, and a
        # duplicate would collide on the table's own uniqueness.
        payload = chart_payload()
        payload["plan"]["fields"].append(
            {"key": "correct", "label": "Correct", "unit": None}
        )
        artifact = _build(artifact_payload_adapter.validate_python(payload))
        assert artifact is not None
        keys = [field.key for field in artifact.fields]
        self.assertEqual(keys.count("correct"), 1)


if __name__ == "__main__":
    unittest.main()
