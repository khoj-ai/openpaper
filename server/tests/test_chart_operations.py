"""Chart artifact invariants.

Tests are grouped by the property they defend: that every plotted number traces
to a retrieved passage, that a paper's absence is explained, that identical
evidence yields an identical chart, and that a paper reporting several entities
contributes several independent points.

Most of these exist because the pipeline once violated them and produced
different charts for identical requests. Treat the file as the spec — add a
failing test before changing pipeline behaviour.
"""

import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.helpers.compute_agent import ComputeAgentError
from app.llm.chart_operations import ChartOperations
from app.llm.conversation_operations import DataTableOperations
from app.schemas.chart import ChartCalculation, ChartField, ChartPlan
from app.schemas.responses import DataTableCellValue


class StubChartOperations(ChartOperations):
    """Chart operations with the LLM replaced by canned structured output.

    Records every generate_content call so tests can assert on how the
    extractor is driven (how many calls, how much context per call), not only
    on what comes back.
    """

    def __init__(self, *payloads: str):
        self.payloads = list(payloads)
        self.calls: list[dict] = []

    def generate_content(self, **kwargs):
        self.calls.append(kwargs)
        payload = self.payloads.pop(0) if len(self.payloads) > 1 else self.payloads[0]
        return SimpleNamespace(text=payload)

    @property
    def last_prompt(self) -> str:
        return "".join(part.text for part in self.calls[-1]["contents"])


def simple_plan(
    x_key: str = "benchmark",
    y_key: str = "score",
    calculation: ChartCalculation | None = None,
) -> ChartPlan:
    fields = [ChartField(key=x_key, label=x_key.replace("_", " ").title())]
    if not calculation:
        fields.append(ChartField(key=y_key, label=y_key.replace("_", " ").title()))
    return ChartPlan(
        title="Test chart",
        chart_type="bar",
        x=ChartField(key=x_key, label=x_key.replace("_", " ").title()),
        y=ChartField(key=y_key, label=y_key.replace("_", " ").title()),
        fields=fields,
        calculation=calculation,
    )


def records_json(*records: dict) -> str:
    return json.dumps({"records": list(records)})


def record(paper_id: str, title: str, **values: tuple[str, str]) -> dict:
    return {
        "paper_id": paper_id,
        "paper_title": title,
        "values": {
            key: {"value": value, "quote": quote}
            for key, (value, quote) in values.items()
        },
    }


class TestChartGrounding(unittest.TestCase):
    """Every plotted number must trace to a passage we actually retrieved."""

    def test_fabricated_quote_is_excluded(self):
        artifact = StubChartOperations(
            records_json(
                record(
                    "one",
                    "?",
                    benchmark=("A", "accuracy was 91%"),
                    score=("91", "accuracy was 91%"),
                ),
                record(
                    "two",
                    "?",
                    benchmark=("B", "invented sentence"),
                    score=("80", "invented sentence"),
                ),
            )
        ).build_chart_artifact(
            prompt="chart scores",
            plan=simple_plan(),
            evidence={"one": ["12: accuracy was 91%"], "two": ["accuracy was 80%"]},
            papers=[
                ("one", "Paper one"),
                ("two", "Paper two"),
                ("three", "Paper three"),
            ],
        )

        assert artifact is not None
        self.assertEqual(artifact.coverage.included_paper_ids, ["one"])
        self.assertIn("two", artifact.coverage.excluded)
        self.assertIn("three", artifact.coverage.excluded)
        self.assertEqual(artifact.records[0].paper_title, "Paper one")

    def test_paper_never_returned_by_the_extractor_is_still_reported(self):
        artifact = StubChartOperations(records_json()).build_chart_artifact(
            prompt="chart scores",
            plan=simple_plan(),
            evidence={},
            papers=[("one", "Paper one"), ("two", "Paper two")],
        )

        assert artifact is not None
        self.assertEqual(artifact.coverage.searched_paper_ids, ["one", "two"])
        self.assertEqual(artifact.coverage.included_paper_ids, [])
        self.assertEqual(set(artifact.coverage.excluded), {"one", "two"})

    def test_record_for_a_paper_outside_the_roster_is_dropped(self):
        artifact = StubChartOperations(
            records_json(
                record(
                    "hallucinated",
                    "?",
                    benchmark=("A", "accuracy was 91%"),
                    score=("91", "accuracy was 91%"),
                ),
            )
        ).build_chart_artifact(
            prompt="chart scores",
            plan=simple_plan(),
            evidence={"one": ["12: accuracy was 91%"]},
            papers=[("one", "Paper one")],
        )

        assert artifact is not None
        self.assertEqual([r.paper_id for r in artifact.records], ["one"])
        self.assertEqual(artifact.coverage.included_paper_ids, [])

    def test_one_paper_can_contribute_several_named_entities(self):
        artifact = StubChartOperations(
            records_json(
                record(
                    "paper-1",
                    "CoT",
                    benchmark=("AssistantBench", "AssistantBench contains 33 tasks"),
                    score=("33", "AssistantBench contains 33 tasks"),
                ),
                record(
                    "paper-1",
                    "CoT",
                    benchmark=("TAU-bench", "TAU-bench Airline contains 50 tasks"),
                    score=("50", "TAU-bench Airline contains 50 tasks"),
                ),
            )
        ).build_chart_artifact(
            prompt="Chart benchmark size",
            plan=simple_plan(),
            evidence={
                "paper-1": [
                    "AssistantBench contains 33 tasks",
                    "TAU-bench Airline contains 50 tasks",
                ]
            },
            papers=[("paper-1", "Chain of Thought")],
        )

        assert artifact is not None
        self.assertTrue(StubChartOperations.is_chart_ready(artifact))
        self.assertEqual(
            [r.values["score"].value for r in artifact.records], ["33", "50"]
        )


class TestAbsenceIsExplained(unittest.TestCase):
    """A chart implies completeness, so every gap needs a specific reason."""

    def test_exclusion_names_the_field_that_was_not_quotable(self):
        artifact = StubChartOperations(
            records_json(
                record(
                    "one",
                    "?",
                    benchmark=("A", "accuracy was 91%"),
                    score=("91", "invented sentence"),
                ),
            )
        ).build_chart_artifact(
            prompt="chart scores",
            plan=simple_plan(),
            evidence={"one": ["12: accuracy was 91%"]},
            papers=[("one", "Paper one")],
        )

        assert artifact is not None
        self.assertIn("Score", artifact.coverage.excluded["one"])
        self.assertNotIn("Benchmark", artifact.coverage.excluded["one"])

    def test_searched_and_empty_reads_differently_from_never_retrieved(self):
        artifact = StubChartOperations(records_json()).build_chart_artifact(
            prompt="chart scores",
            plan=simple_plan(),
            evidence={"one": ["12: this paper discusses something else entirely"]},
            papers=[("one", "Paper one"), ("two", "Paper two")],
        )

        assert artifact is not None
        self.assertIn("We searched this paper", artifact.coverage.excluded["one"])
        self.assertIn("could be retrieved", artifact.coverage.excluded["two"])

    def test_extraction_for_one_paper_cannot_speak_for_another(self):
        """Each call sees one paper. A record naming a different paper is not
        evidence about that paper — it is the model reusing its context."""
        artifact = StubChartOperations(
            records_json(
                record(
                    "two",
                    "?",
                    benchmark=("B", "accuracy was 80%"),
                    score=("80", "accuracy was 80%"),
                ),
            )
        ).build_chart_artifact(
            prompt="chart scores",
            plan=simple_plan(),
            evidence={"one": ["12: accuracy was 80%"]},
            papers=[("one", "Paper one"), ("two", "Paper two")],
        )

        assert artifact is not None
        self.assertEqual(artifact.coverage.included_paper_ids, [])


class TestChartFailureReporting(unittest.TestCase):
    """A chart that cannot be built must say so, and say why."""

    def test_fewer_than_two_points_is_not_chart_ready(self):
        artifact = StubChartOperations(
            records_json(
                record(
                    "one",
                    "?",
                    benchmark=("A", "accuracy was 91%"),
                    score=("91", "accuracy was 91%"),
                ),
            )
        ).build_chart_artifact(
            prompt="chart scores",
            plan=simple_plan(),
            evidence={"one": ["12: accuracy was 91%"]},
            papers=[("one", "Paper one"), ("two", "Paper two")],
        )

        assert artifact is not None
        self.assertFalse(StubChartOperations.is_chart_ready(artifact))
        message = StubChartOperations.chart_failure_message(artifact)
        self.assertIn("Score", message)
        self.assertIn("1 of 2 papers", message)

    def test_compute_failure_excludes_every_point_and_warns(self):
        plan = simple_plan(
            y_key="ratio",
            calculation=ChartCalculation(
                label="ratio", spec="hits / total", inputs=["hits", "total"]
            ),
        )
        with patch(
            "app.llm.chart_operations.run_computed_columns",
            side_effect=ComputeAgentError("sandbox unavailable"),
        ):
            artifact = StubChartOperations(
                records_json(
                    record(
                        "one",
                        "?",
                        benchmark=("A", "12 of 20 hits"),
                        hits=("12", "12 of 20 hits"),
                        total=("20", "12 of 20 hits"),
                    ),
                )
            ).build_chart_artifact(
                prompt="chart hit ratio",
                plan=plan,
                evidence={"one": ["12 of 20 hits"]},
                papers=[("one", "Paper one")],
            )

        assert artifact is not None
        self.assertEqual(artifact.coverage.included_paper_ids, [])
        self.assertIn("sandbox unavailable", artifact.warnings)


class TestChartPlanHygiene(unittest.TestCase):
    """The plan is the contract handed to the investigator and the extractor."""

    def test_axis_fields_are_backfilled_and_multi_series_is_suppressed(self):
        plan = StubChartOperations(
            json.dumps(
                {
                    "title": "Score by benchmark",
                    "chart_type": "bar",
                    "x": {"key": "benchmark", "label": "Benchmark"},
                    "y": {"key": "score", "label": "Score"},
                    "series": {"key": "model", "label": "Model"},
                    "fields": [],
                }
            )
        ).propose_chart_plan("chart scores", [("one", "Paper one")])

        assert plan is not None
        self.assertIsNone(plan.series)
        self.assertEqual({f.key for f in plan.fields}, {"benchmark", "score", "model"})

    def test_derived_y_is_bound_to_the_y_field_key(self):
        plan = StubChartOperations(
            json.dumps(
                {
                    "title": "Hit ratio",
                    "chart_type": "bar",
                    "x": {"key": "benchmark", "label": "Benchmark"},
                    "y": {"key": "hit_ratio", "label": "Hit ratio"},
                    "fields": [
                        {"key": "hits", "label": "Hits"},
                        {"key": "total", "label": "Total"},
                    ],
                    "calculation": {
                        "label": "whatever",
                        "spec": "hits / total",
                        "inputs": ["hits", "total"],
                    },
                }
            )
        ).propose_chart_plan("chart hit ratio", [("one", "Paper one")])

        assert plan is not None
        assert plan.calculation is not None
        self.assertEqual(plan.calculation.label, plan.y.key)

    def test_unparseable_plan_returns_none(self):
        self.assertIsNone(
            StubChartOperations("not json at all").propose_chart_plan(
                "chart it", [("one", "P")]
            )
        )

    def test_calculation_inputs_are_declared_as_extractable_fields(self):
        """The investigator is handed plan.fields as its search
        target. If a calculation reads primitives that never appear there, the
        investigator has no instruction to look for them, so whether they land
        in evidence depends on which synonyms the agent happened to try."""
        plan = StubChartOperations(
            json.dumps(
                {
                    "title": "Effect size by sample size",
                    "chart_type": "scatter",
                    "x": {"key": "n_total", "label": "Sample size"},
                    "y": {"key": "cohens_d", "label": "Cohen's d"},
                    "fields": [{"key": "n_total", "label": "Sample size"}],
                    "calculation": {
                        "label": "cohens_d",
                        "spec": "standardised mean difference",
                        "inputs": ["mean_t", "sd_t", "n_t", "mean_c", "sd_c", "n_c"],
                    },
                }
            )
        ).propose_chart_plan("chart effect size against sample size", [("one", "P")])

        assert plan is not None
        assert plan.calculation is not None
        self.assertLessEqual(set(plan.calculation.inputs), {f.key for f in plan.fields})


class TestQuoteGroundingIsRobust(unittest.TestCase):
    """Grounding compares text, not byte-identical strings.

    Evidence lines carry `"<lineno>: "` prefixes from search_all_files/
    search_file, PDF text keeps its original wrapping and typography, and the
    extractor reflows what it quotes. So a correct extraction is rejected
    whenever the quote crosses a line, normalises whitespace, or straightens a
    dash — and whether that happens differs run to run. This is the most
    likely single cause of two identical requests producing different bars.
    """

    def _artifact(self, quote: str, evidence_lines: list[str]):
        return StubChartOperations(
            records_json(
                record("one", "?", benchmark=("Arm A", quote), score=("4.8", quote)),
            )
        ).build_chart_artifact(
            prompt="chart mean change",
            plan=simple_plan(),
            evidence={"one": evidence_lines},
            papers=[("one", "Paper one")],
        )

    def test_quote_spanning_two_retrieved_lines_is_grounded(self):
        artifact = self._artifact(
            "a mean reduction of 4.8 points on the HAM-D",
            [
                "412: a mean reduction of 4.8 points",
                "413: on the HAM-D versus 1.2 in placebo",
            ],
        )
        assert artifact is not None
        self.assertEqual(artifact.coverage.included_paper_ids, ["one"])

    def test_quote_with_collapsed_whitespace_is_grounded(self):
        artifact = self._artifact(
            "a mean reduction of 4.8 points",
            ["412: a mean  reduction of 4.8   points"],
        )
        assert artifact is not None
        self.assertEqual(artifact.coverage.included_paper_ids, ["one"])

    def test_quote_with_straightened_typography_is_grounded(self):
        artifact = self._artifact(
            'the "active" arm fell 4.8 points - a large effect',
            ["412: the “active” arm fell 4.8 points – a large effect"],
        )
        assert artifact is not None
        self.assertEqual(artifact.coverage.included_paper_ids, ["one"])

    def test_paraphrase_that_is_not_in_the_source_is_still_rejected(self):
        """The guard rail the tests above must not loosen."""
        artifact = self._artifact(
            "the treatment arm improved substantially over placebo",
            ["412: a mean reduction of 4.8 points"],
        )
        assert artifact is not None
        self.assertEqual(artifact.coverage.included_paper_ids, [])


class TestRecordIdentity(unittest.TestCase):
    """A chart point is one named entity, not one paper.

    A paper reporting three benchmarks yields three points sharing one
    paper_id. Everything downstream — the compute agent's output map, the
    coverage dicts, the client's React keys — assumes paper_id identifies a
    point, so multi-entity papers get collapsed or double-counted.
    """

    def test_partly_grounded_paper_is_not_both_included_and_excluded(self):
        artifact = StubChartOperations(
            records_json(
                record(
                    "paper-1",
                    "CoT",
                    benchmark=("AssistantBench", "AssistantBench contains 33 tasks"),
                    score=("33", "AssistantBench contains 33 tasks"),
                ),
                record(
                    "paper-1",
                    "CoT",
                    benchmark=("MMLU", "invented sentence"),
                    score=("57", "invented sentence"),
                ),
            )
        ).build_chart_artifact(
            prompt="chart benchmark size",
            plan=simple_plan(),
            evidence={"paper-1": ["AssistantBench contains 33 tasks"]},
            papers=[("paper-1", "Chain of Thought")],
        )

        assert artifact is not None
        self.assertFalse(
            set(artifact.coverage.included_paper_ids) & set(artifact.coverage.excluded),
            "a paper reported as included must not also be reported as excluded",
        )

    def test_the_same_entity_extracted_twice_yields_one_point(self):
        artifact = StubChartOperations(
            records_json(
                record(
                    "paper-1",
                    "CoT",
                    benchmark=("AssistantBench", "AssistantBench contains 33 tasks"),
                    score=("33", "AssistantBench contains 33 tasks"),
                ),
                record(
                    "paper-1",
                    "CoT",
                    benchmark=("AssistantBench", "AssistantBench contains 33 tasks"),
                    score=("33", "AssistantBench contains 33 tasks"),
                ),
            )
        ).build_chart_artifact(
            prompt="chart benchmark size",
            plan=simple_plan(),
            evidence={"paper-1": ["AssistantBench contains 33 tasks"]},
            papers=[("paper-1", "Chain of Thought")],
        )

        assert artifact is not None
        plotted = [r for r in artifact.records if not r.exclusion_reason]
        self.assertEqual(len(plotted), 1)

    def test_point_order_does_not_depend_on_model_emission_order(self):
        forward = record(
            "paper-1",
            "CoT",
            benchmark=("AssistantBench", "AssistantBench contains 33 tasks"),
            score=("33", "AssistantBench contains 33 tasks"),
        )
        backward = record(
            "paper-1",
            "CoT",
            benchmark=("TAU-bench", "TAU-bench Airline contains 50 tasks"),
            score=("50", "TAU-bench Airline contains 50 tasks"),
        )
        evidence = {
            "paper-1": [
                "AssistantBench contains 33 tasks",
                "TAU-bench Airline contains 50 tasks",
            ]
        }

        def build(*emitted):
            artifact = StubChartOperations(records_json(*emitted)).build_chart_artifact(
                prompt="chart benchmark size",
                plan=simple_plan(),
                evidence=evidence,
                papers=[("paper-1", "Chain of Thought")],
            )
            assert artifact is not None
            return [
                r.values["benchmark"].value
                for r in artifact.records
                if not r.exclusion_reason
            ]

        self.assertEqual(build(forward, backward), build(backward, forward))

    def test_each_entity_from_one_paper_gets_its_own_derived_value(self):
        plan = simple_plan(
            y_key="hit_ratio",
            calculation=ChartCalculation(
                label="hit_ratio", spec="hits / total", inputs=["hits", "total"]
            ),
        )
        seen_rows = []

        def fake_compute(rows, specs, paper_titles):
            seen_rows.extend(rows)
            for row in rows:
                ratio = float(row.values["hits"].value) / float(
                    row.values["total"].value
                )
                row.values[specs[0].label] = DataTableCellValue(
                    value=f"{ratio:.2f}", citations=[]
                )
            return {"version": 1, "script": "…", "warnings": []}

        with patch("app.llm.chart_operations.run_computed_columns", fake_compute):
            artifact = StubChartOperations(
                records_json(
                    record(
                        "paper-1",
                        "CoT",
                        benchmark=("AssistantBench", "AssistantBench: 12 of 33"),
                        hits=("12", "AssistantBench: 12 of 33"),
                        total=("33", "AssistantBench: 12 of 33"),
                    ),
                    record(
                        "paper-1",
                        "CoT",
                        benchmark=("TAU-bench", "TAU-bench: 25 of 50"),
                        hits=("25", "TAU-bench: 25 of 50"),
                        total=("50", "TAU-bench: 25 of 50"),
                    ),
                )
            ).build_chart_artifact(
                prompt="chart hit ratio by benchmark",
                plan=plan,
                evidence={
                    "paper-1": ["AssistantBench: 12 of 33", "TAU-bench: 25 of 50"]
                },
                papers=[("paper-1", "Chain of Thought")],
            )

        assert artifact is not None
        self.assertEqual(
            len({row.paper_id for row in seen_rows}),
            len(seen_rows),
            "rows handed to the compute agent must be uniquely keyed; its output "
            "map is paper_id -> value, so same-paper rows overwrite each other",
        )
        self.assertEqual(
            sorted(
                r.values["hit_ratio"].value
                for r in artifact.records
                if not r.exclusion_reason
            ),
            ["0.36", "0.50"],
        )

    def test_compute_agent_warnings_reach_the_chart(self):
        """A silently imputed input is exactly what the scratchpad exists to
        surface; provenance keeps it but the artifact never shows it."""
        plan = simple_plan(
            y_key="hit_ratio",
            calculation=ChartCalculation(
                label="hit_ratio", spec="hits / total", inputs=["hits", "total"]
            ),
        )

        def fake_compute(rows, specs, paper_titles):
            for row in rows:
                row.values[specs[0].label] = DataTableCellValue(
                    value="0.36", citations=[]
                )
            return {
                "version": 1,
                "script": "…",
                "warnings": ["paper-1: total imputed from reported SE"],
            }

        with patch("app.llm.chart_operations.run_computed_columns", fake_compute):
            artifact = StubChartOperations(
                records_json(
                    record(
                        "paper-1",
                        "CoT",
                        benchmark=("AssistantBench", "AssistantBench: 12 of 33"),
                        hits=("12", "AssistantBench: 12 of 33"),
                        total=("33", "AssistantBench: 12 of 33"),
                    ),
                )
            ).build_chart_artifact(
                prompt="chart hit ratio",
                plan=plan,
                evidence={"paper-1": ["AssistantBench: 12 of 33"]},
                papers=[("paper-1", "Chain of Thought")],
            )

        assert artifact is not None
        self.assertIn("paper-1: total imputed from reported SE", artifact.warnings)


class TestExtractionIsPerPaper(unittest.TestCase):
    """Extraction runs one call per paper, over that paper's own evidence.

    Nothing obliges the model to emit a record per paper, the evidence blob is
    unbounded, and one truncated or lazy response loses the whole chart. The
    Data Table path already fans out per paper for exactly this reason
    (jobs/src/data_table_processor.py).
    """

    def _big_corpus(self, papers=12, lines=200):
        roster = [(f"paper-{i}", f"Paper {i}") for i in range(papers)]
        evidence = {
            paper_id: [
                f"{n}: benchmark B{n} reports {n} examples in the held-out split for evaluation"
                for n in range(lines)
            ]
            for paper_id, _ in roster
        }
        return roster, evidence

    def test_every_paper_with_evidence_gets_its_own_extraction_call(self):
        roster, evidence = self._big_corpus()
        stub = StubChartOperations(records_json())
        stub.build_chart_artifact(
            prompt="chart examples per benchmark",
            plan=simple_plan(),
            evidence=evidence,
            papers=roster,
        )
        self.assertEqual(len(stub.calls), len(roster))

    def test_one_papers_failure_does_not_lose_the_chart(self):
        good = records_json(
            record(
                "one",
                "?",
                benchmark=("A", "accuracy was 91%"),
                score=("91", "accuracy was 91%"),
            ),
            record(
                "three",
                "?",
                benchmark=("C", "accuracy was 72%"),
                score=("72", "accuracy was 72%"),
            ),
        )

        class FlakyExtractor(StubChartOperations):
            def generate_content(self, **kwargs):
                if 'paper_id": "two"' in "".join(p.text for p in kwargs["contents"]):
                    raise RuntimeError("provider exploded")
                return super().generate_content(**kwargs)

        artifact = FlakyExtractor(good).build_chart_artifact(
            prompt="chart scores",
            plan=simple_plan(),
            evidence={
                "one": ["12: accuracy was 91%"],
                "two": ["12: accuracy was 80%"],
                "three": ["12: accuracy was 72%"],
            },
            papers=[
                ("one", "Paper one"),
                ("two", "Paper two"),
                ("three", "Paper three"),
            ],
        )

        assert artifact is not None
        self.assertEqual(artifact.coverage.included_paper_ids, ["one", "three"])
        self.assertIn("two", artifact.coverage.excluded)
        self.assertTrue(StubChartOperations.is_chart_ready(artifact))

    def test_no_single_extraction_call_carries_the_whole_corpus(self):
        roster, evidence = self._big_corpus()
        stub = StubChartOperations(records_json())
        stub.build_chart_artifact(
            prompt="chart examples per benchmark",
            plan=simple_plan(),
            evidence=evidence,
            papers=roster,
        )
        largest = max(
            len("".join(part.text for part in call["contents"])) for call in stub.calls
        )
        self.assertLess(largest, 60_000, "extraction context must be bounded per call")


class TestTraceIsSpecific(unittest.TestCase):
    """The trace is how a reader audits an absence, so it has to say what was
    actually searched and found — not name the phases it went through."""

    def test_investigation_steps_name_the_query_and_the_hit_count(self):
        class Harness(DataTableOperations):
            def __init__(self):
                self.responses = [
                    SimpleNamespace(
                        tool_calls=[
                            SimpleNamespace(
                                name="search_all_files",
                                args={"query": "benchmark|examples"},
                                id="call-1",
                                thought_signature=None,
                            )
                        ],
                        text="",
                    ),
                    SimpleNamespace(tool_calls=[], text="Reported per benchmark."),
                ]

            def generate_content(self, **_kwargs):
                return self.responses.pop(0)

        with patch(
            "app.llm.conversation_operations.search_all_files",
            return_value={
                "paper-1": ["7: Benchmark A uses 100 examples", "9: and 200 more"]
            },
        ):
            investigation = Harness().investigate_fields(
                prompt="chart examples by benchmark",
                papers=[("paper-1", "Paper one"), ("paper-2", "Paper two")],
                current_user=SimpleNamespace(),
                db=SimpleNamespace(),
                project_id="project-1",
                system_prompt="round {n_round}/{max_rounds}",
                user_message="Investigate chart fields",
            )

        steps = investigation.trace["status_messages"]
        self.assertTrue(any("benchmark|examples" in step for step in steps))
        self.assertTrue(any("2 matching lines in 1 paper" in step for step in steps))
        self.assertTrue(
            any("Gathered passages from 1 of 2 papers" in step for step in steps)
        )

    def test_extraction_steps_report_points_per_paper(self):
        artifact = StubChartOperations(
            records_json(
                record(
                    "one",
                    "?",
                    benchmark=("A", "accuracy was 91%"),
                    score=("91", "accuracy was 91%"),
                ),
            )
        ).build_chart_artifact(
            prompt="chart scores",
            plan=simple_plan(),
            evidence={
                "one": ["12: accuracy was 91%"],
                "two": ["12: nothing relevant here"],
            },
            papers=[("one", "Paper one"), ("two", "Paper two")],
        )

        assert artifact is not None
        steps = artifact.extraction_steps
        self.assertTrue(any("2 papers with evidence" in step for step in steps))
        self.assertTrue(any('"Paper one" — 1 point' in step for step in steps))
        self.assertTrue(
            any("1 searched paper reported no usable value" in step for step in steps)
        )


class TestInvestigationHarness(unittest.TestCase):
    def test_investigation_retains_per_paper_source_passages(self):
        class Harness(DataTableOperations):
            def __init__(self):
                self.responses = [
                    SimpleNamespace(
                        tool_calls=[
                            SimpleNamespace(
                                name="search_all_files",
                                args={"query": "benchmark|examples"},
                                id="call-1",
                                thought_signature=None,
                            )
                        ],
                        text="",
                    ),
                    SimpleNamespace(
                        tool_calls=[], text="The paper reports examples per benchmark."
                    ),
                ]

            def generate_content(self, **_kwargs):
                return self.responses.pop(0)

        with patch(
            "app.llm.conversation_operations.search_all_files",
            return_value={"paper-1": ["7: Benchmark A uses 100 examples"]},
        ):
            investigation = Harness().investigate_fields(
                prompt="chart examples by benchmark",
                papers=[("paper-1", "Paper")],
                current_user=SimpleNamespace(),
                db=SimpleNamespace(),
                project_id="project-1",
                system_prompt="round {n_round}/{max_rounds}",
                user_message="Investigate chart fields",
            )

        self.assertEqual(
            investigation.evidence["paper-1"], ["7: Benchmark A uses 100 examples"]
        )
        self.assertIn("reports examples", investigation.findings)

    def test_confirmed_plan_gathers_evidence_for_every_selected_paper(self):
        """Agent search alone is a side effect of whichever terms it tried, so
        a paper it never hit would contribute nothing and then be reported as
        'no chart-ready value found' — indistinguishable from a paper we
        searched and came up empty. The plan-driven sweep is the floor."""

        class Harness(ChartOperations, DataTableOperations):
            def __init__(self):
                self.responses = [
                    SimpleNamespace(
                        tool_calls=[
                            SimpleNamespace(
                                name="search_all_files",
                                args={"query": "examples"},
                                id="call-1",
                                thought_signature=None,
                            )
                        ],
                        text="",
                    ),
                    SimpleNamespace(
                        tool_calls=[], text="Only paper-1 reports examples."
                    ),
                ]

            def generate_content(self, **_kwargs):
                return self.responses.pop(0)

        with patch(
            "app.llm.conversation_operations.search_all_files",
            return_value={"paper-1": ["7: Benchmark A uses 100 examples"]},
        ), patch(
            "app.llm.chart_operations.search_file",
            return_value=["18: benchmark C reports 12 examples"],
        ):
            investigation = Harness().investigate_chart_fields(
                prompt="chart examples by benchmark",
                papers=[("paper-1", "Paper one"), ("paper-2", "Paper two")],
                current_user=SimpleNamespace(),
                db=SimpleNamespace(),
                project_id="project-1",
                plan=simple_plan(),
            )

        self.assertEqual(set(investigation.evidence), {"paper-1", "paper-2"})

    def test_sweep_falls_back_to_the_abstract_so_absence_is_evidenced(self):
        with patch("app.llm.chart_operations.search_file", return_value=[]), patch(
            "app.llm.chart_operations.read_abstract",
            return_value="Abstract:\n\nWe study retrieval.",
        ):
            evidence, _ = ChartOperations.sweep_plan_evidence(
                plan=simple_plan(),
                papers=[("paper-1", "Paper one")],
                evidence={},
                current_user=SimpleNamespace(),
                db=SimpleNamespace(),
                project_id="project-1",
            )

        self.assertIn("We study retrieval.", evidence["paper-1"][0])

    def test_sweep_does_not_duplicate_passages_the_agent_already_found(self):
        with patch(
            "app.llm.chart_operations.search_file",
            return_value=["7: Benchmark A uses 100 examples"],
        ):
            evidence, _ = ChartOperations.sweep_plan_evidence(
                plan=simple_plan(),
                papers=[("paper-1", "Paper one")],
                evidence={"paper-1": ["7: Benchmark A uses 100 examples"]},
                current_user=SimpleNamespace(),
                db=SimpleNamespace(),
                project_id="project-1",
            )

        self.assertEqual(len(evidence["paper-1"]), 1)


if __name__ == "__main__":
    unittest.main()
