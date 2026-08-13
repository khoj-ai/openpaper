"""Chart artifact invariants.

Tests are grouped by the property they defend: that a paper's absence is
explained, that identical evidence yields an identical chart, that the evidence
retrieved actually reaches the extractor, and that a paper reporting several
entities contributes several independent points.

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
from app.llm.chart_operations import _plan_screen as _real_plan_screen
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
        return prompt_text(self.calls[-1])


def prompt_text(call: dict) -> str:
    """The text a call carried, ignoring the attached document."""
    return "".join(
        part.text for part in call["contents"] if getattr(part, "type", "") != "file"
    )


def documents(call: dict) -> list:
    return [part for part in call["contents"] if getattr(part, "type", "") == "file"]


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


# build_chart_artifact reaches the database for each paper's stored PDF; the
# stub below stands in for that, so tests exercise extraction rather than S3.
DB = {"current_user": SimpleNamespace(), "db": SimpleNamespace(), "project_id": None}

_patches = []


def setUpModule():
    _patches.append(
        patch(
            "app.llm.chart_operations._paper_pdf",
            side_effect=lambda paper_id, *_a, **_k: (b"%PDF-1.4", f"{paper_id}.pdf"),
        )
    )
    # The screen decides which papers are worth opening, and it is tested on
    # its own terms in TestTheScreenDecidesWhatIsOpened. Everywhere else the
    # fixtures are about what happens to a paper once it IS opened, so any
    # paper with gathered evidence is treated as worth opening.
    _patches.append(patch("app.llm.chart_operations._plan_screen", return_value=len))
    for started in _patches:
        started.start()


def tearDownModule():
    for started in _patches:
        started.stop()


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


class TestChartRecords(unittest.TestCase):
    """What the extractor returns becomes the chart; the pipeline decides
    which papers those records may speak for, and reports the rest."""

    def test_every_returned_record_is_plotted_and_the_rest_reported(self):
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
            **DB,
        )

        assert artifact is not None
        self.assertEqual(artifact.coverage.included_paper_ids, ["one", "two"])
        # Only the paper the extractor said nothing about is reported as a gap.
        self.assertEqual(set(artifact.coverage.excluded), {"three"})

    def test_paper_never_returned_by_the_extractor_is_still_reported(self):
        artifact = StubChartOperations(records_json()).build_chart_artifact(
            prompt="chart scores",
            plan=simple_plan(),
            evidence={},
            papers=[("one", "Paper one"), ("two", "Paper two")],
            **DB,
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
            **DB,
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
            **DB,
        )

        assert artifact is not None
        self.assertTrue(StubChartOperations.is_chart_ready(artifact))
        self.assertEqual(
            [r.values["score"].value for r in artifact.records], ["33", "50"]
        )


class TestAbsenceIsExplained(unittest.TestCase):
    """A chart implies completeness, so every gap needs a specific reason."""

    def test_searched_and_empty_reads_differently_from_never_retrieved(self):
        artifact = StubChartOperations(records_json()).build_chart_artifact(
            prompt="chart scores",
            plan=simple_plan(),
            evidence={"one": ["12: this paper discusses something else entirely"]},
            papers=[("one", "Paper one"), ("two", "Paper two")],
            **DB,
        )

        assert artifact is not None
        self.assertIn("We read this paper", artifact.coverage.excluded["one"])
        self.assertIn("does not mention", artifact.coverage.excluded["two"])

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
            **DB,
        )

        assert artifact is not None
        self.assertEqual(artifact.coverage.included_paper_ids, [])


class TestChartFailureReporting(unittest.TestCase):
    """A chart that cannot be built must say so, and say why."""

    def test_a_lone_grounded_point_is_still_a_chart(self):
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
            **DB,
        )

        assert artifact is not None
        # One paper reporting the measure is a thin answer, not a failed one.
        self.assertTrue(StubChartOperations.is_chart_ready(artifact))
        self.assertEqual(artifact.coverage.included_paper_ids, ["one"])

    def test_no_grounded_points_is_not_a_chart(self):
        artifact = StubChartOperations(records_json()).build_chart_artifact(
            prompt="chart scores",
            plan=simple_plan(),
            evidence={"one": ["12: nothing relevant"]},
            papers=[("one", "Paper one"), ("two", "Paper two")],
            **DB,
        )

        assert artifact is not None
        self.assertFalse(StubChartOperations.is_chart_ready(artifact))
        message = StubChartOperations.chart_failure_message(artifact)
        self.assertIn("Score", message)
        self.assertIn("0 of 2 papers", message)

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
                **DB,
            )

        assert artifact is not None
        self.assertEqual(artifact.coverage.included_paper_ids, [])
        self.assertIn("sandbox unavailable", artifact.warnings)


class TestChartPlanHygiene(unittest.TestCase):
    """The plan is the contract handed to the investigator and the extractor."""

    def test_series_survives_so_one_entity_can_be_measured_several_ways(self):
        """x=model, y=score, series=benchmark: without the series the same
        model appears once per benchmark with no way to tell them apart."""
        plan = StubChartOperations(
            json.dumps(
                {
                    "candidates": [
                        {
                            "title": "Score by model",
                            "chart_type": "bar",
                            "x": {"key": "model", "label": "Model"},
                            "y": {"key": "score", "label": "Score"},
                            "series": {"key": "benchmark", "label": "Benchmark"},
                            "fields": [],
                        }
                    ]
                }
            )
        ).propose_chart_plan("chart model scores per benchmark", [("one", "Paper one")])

        assert plan is not None
        assert plan.series is not None
        self.assertEqual(plan.series.key, "benchmark")
        self.assertEqual({f.key for f in plan.fields}, {"model", "score", "benchmark"})

    def test_series_that_repeats_an_axis_is_dropped(self):
        plan = StubChartOperations(
            json.dumps(
                {
                    "candidates": [
                        {
                            "title": "Score by model",
                            "chart_type": "bar",
                            "x": {"key": "model", "label": "Model"},
                            "y": {"key": "score", "label": "Score"},
                            "series": {"key": "model", "label": "Model"},
                            "fields": [],
                        }
                    ]
                }
            )
        ).propose_chart_plan("chart model scores", [("one", "Paper one")])

        assert plan is not None
        self.assertIsNone(plan.series)

    def test_axis_fields_are_backfilled(self):
        plan = StubChartOperations(
            json.dumps(
                {
                    "candidates": [
                        {
                            "title": "Score by benchmark",
                            "chart_type": "bar",
                            "x": {"key": "benchmark", "label": "Benchmark"},
                            "y": {"key": "score", "label": "Score"},
                            "series": {"key": "model", "label": "Model"},
                            "fields": [],
                        }
                    ]
                }
            )
        ).propose_chart_plan("chart scores", [("one", "Paper one")])

        assert plan is not None
        self.assertEqual({f.key for f in plan.fields}, {"benchmark", "score", "model"})

    def test_derived_y_is_bound_to_the_y_field_key(self):
        plan = StubChartOperations(
            json.dumps(
                {
                    "candidates": [
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
                    ]
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
                    "candidates": [
                        {
                            "title": "Effect size by sample size",
                            "chart_type": "scatter",
                            "x": {"key": "n_total", "label": "Sample size"},
                            "y": {"key": "cohens_d", "label": "Cohen's d"},
                            "fields": [{"key": "n_total", "label": "Sample size"}],
                            "calculation": {
                                "label": "cohens_d",
                                "spec": "standardised mean difference",
                                "inputs": [
                                    "mean_t",
                                    "sd_t",
                                    "n_t",
                                    "mean_c",
                                    "sd_c",
                                    "n_c",
                                ],
                            },
                        }
                    ]
                }
            )
        ).propose_chart_plan("chart effect size against sample size", [("one", "P")])

        assert plan is not None
        assert plan.calculation is not None
        self.assertLessEqual(set(plan.calculation.inputs), {f.key for f in plan.fields})


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
            **DB,
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
            **DB,
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
                **DB,
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
                **DB,
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
                **DB,
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
            **DB,
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
                if 'paper_id": "two"' in prompt_text(kwargs):
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
            **DB,
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
            **DB,
        )
        self.assertTrue(
            all(len(documents(call)) == 1 for call in stub.calls),
            "one call carries one paper, so a large corpus cannot crowd out its tail",
        )
        largest = max(len(prompt_text(call)) for call in stub.calls)
        self.assertLess(largest, 60_000, "extraction context must be bounded per call")


class TestPlanCoverageIsMeasured(unittest.TestCase):
    """The planner must not pick a measure only one paper reports.

    Both real-world failures had this shape: "Robust Accuracy" chosen when 1 of
    18 papers used the phrase and 13 reported "accuracy"; "Odds Ratio for ADHD
    Diagnosis" chosen when every paper reported an odds ratio.
    """

    CANDIDATES = json.dumps(
        {
            "candidates": [
                {  # narrow — the phrasing of a single paper, and listed first
                    "title": "Robust accuracy by model",
                    "chart_type": "bar",
                    "x": {"key": "model", "label": "Model"},
                    "y": {"key": "robust_accuracy", "label": "Robust Accuracy"},
                    "fields": [],
                },
                {  # broad — the measure the corpus shares
                    "title": "Accuracy by model",
                    "chart_type": "bar",
                    "x": {"key": "model", "label": "Model"},
                    "y": {"key": "accuracy", "label": "Accuracy"},
                    "fields": [],
                },
            ]
        }
    )

    CORPUS = {
        "robust accuracy": {"p1": ["robust accuracy 91%"]},
        "accuracy": {f"p{i}": ["accuracy 91%"] for i in range(1, 14)},
        "model": {f"p{i}": ["model GPT-4o"] for i in range(1, 19)},
    }

    def _search(self, query, **_kwargs):
        # Mirrors the tool's '|' alternation over phrases.
        hits: dict[str, list[str]] = {}
        for term in query.split("|"):
            for paper_id, lines in self.CORPUS.get(term.strip().lower(), {}).items():
                hits.setdefault(paper_id, []).extend(lines)
        return hits

    def test_the_widest_covered_candidate_wins_over_the_first_offered(self):
        papers = [(f"p{i}", f"Paper {i}") for i in range(1, 19)]
        with patch(
            "app.llm.chart_operations.search_all_files", side_effect=self._search
        ):
            plan = StubChartOperations(self.CANDIDATES).propose_chart_plan(
                "chart models tested vs their relative scores",
                papers,
                current_user=SimpleNamespace(),
                db=SimpleNamespace(),
                project_id="project-1",
            )

        assert plan is not None
        self.assertEqual(plan.y.key, "accuracy")

    def test_a_qualified_measure_is_not_inflated_by_its_common_word(self):
        """The whole trap: 'Robust Accuracy' as robust|accuracy matches every
        paper that says accuracy, so word-level scoring rates a one-paper field
        as corpus-wide. Coverage must be measured on the phrase."""
        papers = [(f"p{i}", f"Paper {i}") for i in range(1, 19)]
        narrow = ChartPlan(
            title="Robust accuracy by model",
            chart_type="bar",
            x=ChartField(key="model", label="Model"),
            y=ChartField(key="robust_accuracy", label="Robust Accuracy"),
            fields=[],
        )
        with patch(
            "app.llm.chart_operations.search_all_files", side_effect=self._search
        ):
            coverage = ChartOperations.measure_plan_coverage(
                narrow, papers, SimpleNamespace(), SimpleNamespace(), "project-1"
            )
        self.assertEqual(coverage, 1)

    def test_a_computed_candidate_needs_every_input_in_the_same_paper(self):
        """A derived value can only be computed where all its primitives are.
        Scoring the inputs as an OR would credit a paper supplying one of four
        counts, and a computed plan would win on coverage it cannot deliver."""
        papers = [(f"p{i}", f"Paper {i}") for i in range(1, 6)]
        corpus = {
            "exposed cases": {"p1": ["x"], "p2": ["x"], "p3": ["x"]},
            "exposed non cases": {"p1": ["x"], "p2": ["x"]},
            "unexposed cases": {"p1": ["x"]},
            "unexposed non cases": {"p1": ["x"], "p2": ["x"], "p4": ["x"]},
            "outcome": {f"p{i}": ["x"] for i in range(1, 6)},
        }

        def search(query, **_kwargs):
            hits: dict[str, list[str]] = {}
            for term in query.split("|"):
                for paper_id, lines in corpus.get(term.strip().lower(), {}).items():
                    hits.setdefault(paper_id, []).extend(lines)
            return hits

        inputs = [
            "exposed_cases",
            "exposed_non_cases",
            "unexposed_cases",
            "unexposed_non_cases",
        ]
        computed = ChartPlan(
            title="Odds ratio by outcome",
            chart_type="bar",
            x=ChartField(key="outcome", label="Outcome"),
            y=ChartField(key="odds_ratio", label="Odds Ratio"),
            fields=[ChartField(key=key, label=key.replace("_", " ")) for key in inputs],
            calculation=ChartCalculation(
                label="odds_ratio",
                spec="(exposed cases / exposed non-cases) / (unexposed cases / unexposed non-cases)",
                inputs=inputs,
            ),
        )
        with patch("app.llm.chart_operations.search_all_files", side_effect=search):
            coverage = ChartOperations.measure_plan_coverage(
                computed, papers, SimpleNamespace(), SimpleNamespace(), "project-1"
            )
        # Only p1 states all four counts, though p2 states three and p3/p4 one.
        self.assertEqual(coverage, 1)

    def test_without_a_corpus_to_measure_the_first_candidate_stands(self):
        plan = StubChartOperations(self.CANDIDATES).propose_chart_plan(
            "chart scores", [("p1", "Paper 1")]
        )
        assert plan is not None
        self.assertEqual(plan.y.key, "robust_accuracy")

    def test_the_planner_is_told_what_the_conversation_established(self):
        """'Chart this relationship' names nothing without the prior turn."""
        stub = StubChartOperations(self.CANDIDATES)
        stub.propose_chart_plan(
            "can you create a chart that illustrates this relationship quantitatively?",
            [("p1", "Paper 1")],
            history="assistant: Six papers inspect maternal fever and adverse outcomes...",
        )
        self.assertIn("maternal fever", stub.last_prompt)


class TestTheScreenDecidesWhatIsOpened(unittest.TestCase):
    """Retrieval's job is to say which papers are worth opening.

    Opening a PDF costs real money and a library holds hundreds, so the shallow
    question text search is good at — does this paper talk about this measure
    and this kind of entity — is the only one it is asked. It is deliberately
    generous: rejecting a paper that mentions neither is safe, and everything
    past that is the reader's job.
    """

    def setUp(self):
        # This class tests the screen itself, so the module-wide stand-in is
        # lifted for its duration.
        patcher = patch("app.llm.chart_operations._plan_screen", _real_plan_screen)
        patcher.start()
        self.addCleanup(patcher.stop)

    def _artifact(self, evidence, papers):
        artifact = StubChartOperations(records_json()).build_chart_artifact(
            prompt="chart scores",
            plan=simple_plan(),
            evidence=evidence,
            papers=papers,
            **DB,
        )
        assert artifact is not None
        return artifact

    def test_a_paper_mentioning_neither_field_is_never_opened(self):
        stub = StubChartOperations(records_json())
        stub.build_chart_artifact(
            prompt="chart scores",
            plan=simple_plan(),
            evidence={
                "one": ["4: benchmark A reports a score of 91"],
                "two": ["9: this paper is about something else entirely"],
            },
            papers=[("one", "Paper one"), ("two", "Paper two")],
            **DB,
        )

        self.assertEqual(len(stub.calls), 1)
        self.assertIn("one", prompt_text(stub.calls[0]))

    def test_a_field_label_with_punctuation_is_matched_literally(self):
        """Labels are prose — "Lat. (s)", "Accuracy (%)" — and a label read as
        a regex either explodes or matches the wrong thing."""
        plan = simple_plan()
        plan.y = ChartField(key="latency", label="Lat. (s)")
        plan.fields = [plan.x, plan.y]
        stub = StubChartOperations(records_json())
        stub.build_chart_artifact(
            prompt="chart latency",
            plan=plan,
            evidence={"one": ["4: benchmark A reports Lat. (s) of 4.9"]},
            papers=[("one", "Paper one")],
            **DB,
        )

        self.assertEqual(len(stub.calls), 1)

    def test_every_paper_the_screen_passes_is_read(self):
        """No ceiling on how many PDFs a chart opens.

        A rank-based cap decides coverage by position in a list whose scores
        are mostly ties — on a real corpus the 40th and the 56th match scored
        the same, so which papers reached the chart came down to roster order.
        The screen is the filter; what it passes gets read.
        """
        roster = [(f"paper-{n}", f"Paper {n}") for n in range(60)]
        stub = StubChartOperations(records_json())
        stub.build_chart_artifact(
            prompt="chart scores",
            plan=simple_plan(),
            evidence={
                paper_id: ["4: benchmark A reports a score of 91"]
                for paper_id, _ in roster
            },
            papers=roster,
            **DB,
        )

        self.assertEqual(len(stub.calls), len(roster))

    def test_an_unscreened_paper_is_reported_as_unmentioned_not_unread(self):
        artifact = self._artifact(
            {"two": ["9: this paper is about something else entirely"]},
            [("two", "Paper two")],
        )
        self.assertIn("does not mention", artifact.coverage.excluded["two"])


class TestAnUnindexedPaperIsReported(unittest.TestCase):
    """A shortlisted paper with no stored PDF is an indexing failure.

    Falling back to its extracted text is what put wrong numbers on charts, so
    it is named instead — the gap belongs in the library, not on the chart.
    """

    def test_a_paper_with_no_pdf_is_excluded_by_name(self):
        with patch("app.llm.chart_operations._paper_pdf", return_value=None):
            artifact = StubChartOperations(records_json()).build_chart_artifact(
                prompt="chart scores",
                plan=simple_plan(),
                evidence={"one": ["4: benchmark A reports a score of 91"]},
                papers=[("one", "Paper one")],
                **DB,
            )

        assert artifact is not None
        self.assertIn("no indexed PDF", artifact.coverage.excluded["one"])
        self.assertTrue(
            any("no indexed PDF" in step for step in artifact.extraction_steps)
        )

    def test_one_unreadable_paper_does_not_stop_the_others(self):
        def missing_for_two(paper_id, *_args, **_kwargs):
            if paper_id == "two":
                raise RuntimeError("s3 exploded")
            return b"%PDF-1.4", f"{paper_id}.pdf"

        with patch("app.llm.chart_operations._paper_pdf", side_effect=missing_for_two):
            artifact = StubChartOperations(
                records_json(
                    record(
                        "one",
                        "Paper one",
                        benchmark=("A", "a score of 91"),
                        score=("91", "a score of 91"),
                    )
                )
            ).build_chart_artifact(
                prompt="chart scores",
                plan=simple_plan(),
                evidence={
                    "one": ["4: benchmark A reports a score of 91"],
                    "two": ["4: benchmark B reports a score of 80"],
                },
                papers=[("one", "Paper one"), ("two", "Paper two")],
                **DB,
            )

        assert artifact is not None
        self.assertEqual(artifact.coverage.included_paper_ids, ["one"])
        self.assertIn("no indexed PDF", artifact.coverage.excluded["two"])


class TestThePaperIsWhatIsRead(unittest.TestCase):
    """Extraction reads the PDF, never the reassembled text.

    Retrieval flattens a results table into a caption, a column of row labels
    and a separate run of numbers per column, so no line pairs an entity with
    its value. Asking a model to put that back together produced numbers under
    the wrong heading — a benchmark tested on eight models charted one of them,
    and the one it charted came from a sentence in the abstract. Retrieval now
    only decides which papers to open.
    """

    def test_the_extractor_receives_the_document(self):
        stub = StubChartOperations(records_json())
        stub.build_chart_artifact(
            prompt="chart odds ratios by trimester",
            plan=simple_plan(x_key="trimester", y_key="odds_ratio"),
            evidence={"p1": ["7: third-trimester fever and ADHD (OR = 0.80)"]},
            papers=[("p1", "Paper one")],
            **DB,
        )

        attached = documents(stub.calls[-1])
        self.assertEqual(len(attached), 1)
        self.assertEqual(attached[0].mime_type, "application/pdf")

    def test_gathered_lines_are_not_forwarded_as_the_source(self):
        """A quote must come from the paper, so the retrieved text is not
        offered as something to copy from."""
        stub = StubChartOperations(records_json())
        stub.build_chart_artifact(
            prompt="chart odds ratios by trimester",
            plan=simple_plan(x_key="trimester", y_key="odds_ratio"),
            evidence={"p1": ["7: third-trimester fever and ADHD (OR = 0.80)"]},
            papers=[("p1", "Paper one")],
            **DB,
        )

        self.assertNotIn("OR = 0.80", stub.last_prompt)


class TestBothSurfacesShareOnePath(unittest.TestCase):
    """Chat and the composer once gathered evidence differently — the composer
    ran a plan-targeted agent that chat never did — so the same request could
    chart in one surface and come up empty in the other."""

    class Recorder(StubChartOperations):
        def __init__(self, *payloads):
            super().__init__(*payloads)
            self.investigations: list[bool] = []

        def investigate_chart_fields(self, *, plan=None, **_kwargs):
            self.investigations.append(plan is not None)
            return SimpleNamespace(
                findings="findings",
                evidence={"p1": ["12: accuracy was 91%"]},
                trace={"status_messages": ["investigated"]},
            )

    CANDIDATE = json.dumps(
        {
            "candidates": [
                {
                    "title": "Score by benchmark",
                    "chart_type": "bar",
                    "x": {"key": "benchmark", "label": "Benchmark"},
                    "y": {"key": "score", "label": "Score"},
                    "fields": [],
                }
            ]
        }
    )

    def _run(self, plan):
        ops = self.Recorder(self.CANDIDATE, records_json())
        artifact, trace = ops.create_chart_artifact(
            prompt="chart scores",
            papers=[("p1", "Paper one")],
            current_user=SimpleNamespace(),
            db=SimpleNamespace(),
            project_id="project-1",
            plan=plan,
        )
        return ops, artifact, trace

    def test_chat_gets_the_plan_targeted_pass_the_composer_always_had(self):
        ops, _, _ = self._run(plan=None)
        # Discovery (no plan), then verification against the chosen plan.
        self.assertEqual(ops.investigations, [False, True])

    def test_a_confirmed_plan_skips_discovery_but_still_verifies(self):
        ops, _, _ = self._run(plan=simple_plan())
        self.assertEqual(ops.investigations, [True])

    def test_prior_evidence_is_merged_not_replaced(self):
        """The chat's own passages decide which papers get opened alongside the
        investigation's, rather than being dropped in favour of them."""
        seen: list[list[str]] = []
        with patch(
            "app.llm.chart_operations._plan_screen",
            side_effect=lambda _plan: lambda lines: seen.append(lines) or len(lines),
        ):
            self.Recorder(self.CANDIDATE, records_json()).create_chart_artifact(
                prompt="chart scores",
                papers=[("p1", "Paper one")],
                current_user=SimpleNamespace(),
                db=SimpleNamespace(),
                project_id="project-1",
                plan=simple_plan(),
                prior_evidence={"p1": ["9: from the chat's own arc"]},
            )

        screened = [line for lines in seen for line in lines]
        self.assertIn("9: from the chat's own arc", screened)
        self.assertIn("12: accuracy was 91%", screened)

    def test_a_single_paper_chart_is_a_valid_outcome(self):
        """One paper reporting two entities is a chart, not a failure."""
        artifact = StubChartOperations(
            records_json(
                record(
                    "p1",
                    "?",
                    benchmark=("A", "A scored 91%"),
                    score=("91", "A scored 91%"),
                ),
                record(
                    "p1",
                    "?",
                    benchmark=("B", "B scored 72%"),
                    score=("72", "B scored 72%"),
                ),
            )
        ).build_chart_artifact(
            prompt="chart scores",
            plan=simple_plan(),
            evidence={"p1": ["12: A scored 91%", "13: B scored 72%"]},
            papers=[("p1", "Paper one"), ("p2", "Paper two")],
            **DB,
        )

        assert artifact is not None
        self.assertEqual(artifact.coverage.included_paper_ids, ["p1"])
        self.assertTrue(StubChartOperations.is_chart_ready(artifact))


class TestSeriesIsExtracted(unittest.TestCase):
    """A second dimension is a quoted field like any other, and part of a
    point's identity — the same model on two benchmarks is two points."""

    PLAN = ChartPlan(
        title="Score by model and benchmark",
        chart_type="bar",
        x=ChartField(key="model", label="Model"),
        y=ChartField(key="score", label="Score"),
        series=ChartField(key="benchmark", label="Benchmark"),
        fields=[
            ChartField(key="model", label="Model"),
            ChartField(key="score", label="Score"),
            ChartField(key="benchmark", label="Benchmark"),
        ],
    )

    def test_one_model_measured_on_two_benchmarks_is_two_points(self):
        artifact = StubChartOperations(
            records_json(
                record(
                    "p1",
                    "?",
                    model=("GPT-4o", "GPT-4o scores 65% on WebVoyager"),
                    score=("65", "GPT-4o scores 65% on WebVoyager"),
                    benchmark=("WebVoyager", "GPT-4o scores 65% on WebVoyager"),
                ),
                record(
                    "p1",
                    "?",
                    model=("GPT-4o", "GPT-4o scores 47% on SWE-bench"),
                    score=("47", "GPT-4o scores 47% on SWE-bench"),
                    benchmark=("SWE-bench", "GPT-4o scores 47% on SWE-bench"),
                ),
            )
        ).build_chart_artifact(
            prompt="chart model scores per benchmark",
            plan=self.PLAN,
            evidence={
                "p1": [
                    "12: GPT-4o scores 65% on WebVoyager",
                    "13: GPT-4o scores 47% on SWE-bench",
                ]
            },
            papers=[("p1", "Paper one")],
            **DB,
        )

        assert artifact is not None
        plotted = [r for r in artifact.records if not r.exclusion_reason]
        self.assertEqual(len(plotted), 2)
        self.assertEqual(len({r.record_id for r in plotted}), 2)
        self.assertEqual(
            sorted(r.values["benchmark"].value for r in plotted),
            ["SWE-bench", "WebVoyager"],
        )

    def test_a_record_missing_the_series_field_is_not_plotted(self):
        artifact = StubChartOperations(
            records_json(
                record(
                    "p1",
                    "?",
                    model=("GPT-4o", "GPT-4o scores 65% on WebVoyager"),
                    score=("65", "GPT-4o scores 65% on WebVoyager"),
                ),
            )
        ).build_chart_artifact(
            prompt="chart model scores per benchmark",
            plan=self.PLAN,
            evidence={"p1": ["12: GPT-4o scores 65% on WebVoyager"]},
            papers=[("p1", "Paper one")],
            **DB,
        )

        assert artifact is not None
        self.assertEqual(artifact.coverage.included_paper_ids, [])


class TestPaperCanBeTheSeries(unittest.TestCase):
    """Several papers reporting the same entity is the commonest shape a
    literature chart takes, and nothing quoted from the text separates those
    points — the study does. Without that encoding the plot draws repeated
    identical labels and the reader cannot tell which number came from where.
    """

    BENCH_PLAN = ChartPlan(
        title="Score by model and benchmark",
        chart_type="bar",
        x=ChartField(key="model", label="Model"),
        y=ChartField(key="score", label="Score"),
        series=ChartField(key="benchmark", label="Benchmark"),
        fields=[
            ChartField(key="model", label="Model"),
            ChartField(key="score", label="Score"),
            ChartField(key="benchmark", label="Benchmark"),
        ],
    )

    def test_two_papers_reporting_one_entity_makes_the_study_the_series(self):
        artifact = StubChartOperations(
            records_json(
                record(
                    "p1",
                    "?",
                    benchmark=("AssistantBench", "AssistantBench accuracy was 33%"),
                    score=("33", "AssistantBench accuracy was 33%"),
                )
            ),
            records_json(
                record(
                    "p2",
                    "?",
                    benchmark=("AssistantBench", "we measured 41% on AssistantBench"),
                    score=("41", "we measured 41% on AssistantBench"),
                )
            ),
        ).build_chart_artifact(
            prompt="chart benchmark accuracy",
            plan=simple_plan(),
            evidence={
                "p1": ["AssistantBench accuracy was 33%"],
                "p2": ["we measured 41% on AssistantBench"],
            },
            papers=[("p1", "Paper one"), ("p2", "Paper two")],
            **DB,
        )

        assert artifact is not None
        self.assertTrue(
            artifact.series_by_paper,
            "two papers share an x, so only the study tells the points apart",
        )

    def test_one_entity_per_paper_needs_no_study_series(self):
        artifact = StubChartOperations(
            records_json(
                record(
                    "p1",
                    "?",
                    benchmark=("AssistantBench", "AssistantBench accuracy was 33%"),
                    score=("33", "AssistantBench accuracy was 33%"),
                )
            ),
            records_json(
                record(
                    "p2",
                    "?",
                    benchmark=("WebVoyager", "WebVoyager accuracy was 41%"),
                    score=("41", "WebVoyager accuracy was 41%"),
                )
            ),
        ).build_chart_artifact(
            prompt="chart benchmark accuracy",
            plan=simple_plan(),
            evidence={
                "p1": ["AssistantBench accuracy was 33%"],
                "p2": ["WebVoyager accuracy was 41%"],
            },
            papers=[("p1", "Paper one"), ("p2", "Paper two")],
            **DB,
        )

        assert artifact is not None
        self.assertFalse(
            artifact.series_by_paper,
            "x already identifies every point, so the study would only add a "
            "legend that disambiguates nothing",
        )

    def test_a_quoted_series_that_already_separates_papers_wins(self):
        artifact = StubChartOperations(
            records_json(
                record(
                    "p1",
                    "?",
                    model=("GPT-4o", "GPT-4o scores 65% on WebVoyager"),
                    score=("65", "GPT-4o scores 65% on WebVoyager"),
                    benchmark=("WebVoyager", "GPT-4o scores 65% on WebVoyager"),
                )
            ),
            records_json(
                record(
                    "p2",
                    "?",
                    model=("GPT-4o", "GPT-4o scores 47% on SWE-bench"),
                    score=("47", "GPT-4o scores 47% on SWE-bench"),
                    benchmark=("SWE-bench", "GPT-4o scores 47% on SWE-bench"),
                )
            ),
        ).build_chart_artifact(
            prompt="chart model scores per benchmark",
            plan=self.BENCH_PLAN,
            evidence={
                "p1": ["GPT-4o scores 65% on WebVoyager"],
                "p2": ["GPT-4o scores 47% on SWE-bench"],
            },
            papers=[("p1", "Paper one"), ("p2", "Paper two")],
            **DB,
        )

        assert artifact is not None
        self.assertFalse(
            artifact.series_by_paper,
            "the benchmark already tells these two points apart",
        )

    def test_one_paper_reporting_two_values_for_one_entity_keeps_both(self):
        artifact = StubChartOperations(
            records_json(
                record(
                    "p1",
                    "?",
                    benchmark=("AssistantBench", "girls scored 33% on AssistantBench"),
                    score=("33", "girls scored 33% on AssistantBench"),
                ),
                record(
                    "p1",
                    "?",
                    benchmark=("AssistantBench", "boys scored 41% on AssistantBench"),
                    score=("41", "boys scored 41% on AssistantBench"),
                ),
            )
        ).build_chart_artifact(
            prompt="chart benchmark accuracy",
            plan=simple_plan(),
            evidence={
                "p1": [
                    "girls scored 33% on AssistantBench",
                    "boys scored 41% on AssistantBench",
                ]
            },
            papers=[("p1", "Paper one")],
            **DB,
        )

        assert artifact is not None
        plotted = [r for r in artifact.records if not r.exclusion_reason]
        self.assertEqual(
            sorted(r.values["score"].value for r in plotted),
            ["33", "41"],
            "two subgroups reported for one entity are two findings; keying "
            "identity on the x label alone silently discards one of them",
        )
        self.assertEqual(len({r.record_id for r in plotted}), 2)
        self.assertFalse(
            artifact.series_by_paper,
            "one paper cannot be told apart from itself",
        )

    def test_points_sharing_an_x_are_grouped_by_study(self):
        artifact = StubChartOperations(
            records_json(
                record(
                    "p1",
                    "?",
                    benchmark=("AssistantBench", "33%"),
                    score=("33", "33%"),
                ),
                record("p1", "?", benchmark=("WebVoyager", "51%"), score=("51", "51%")),
            ),
            records_json(
                record(
                    "p2",
                    "?",
                    benchmark=("AssistantBench", "41%"),
                    score=("41", "41%"),
                ),
                record("p2", "?", benchmark=("WebVoyager", "62%"), score=("62", "62%")),
            ),
        ).build_chart_artifact(
            prompt="chart benchmark accuracy",
            plan=simple_plan(),
            evidence={"p1": ["33%", "51%"], "p2": ["41%", "62%"]},
            papers=[("p1", "Alpha study"), ("p2", "Beta study")],
            **DB,
        )

        assert artifact is not None
        plotted = [r for r in artifact.records if not r.exclusion_reason]
        self.assertEqual(
            [(r.values["benchmark"].value, r.paper_title) for r in plotted],
            [
                ("AssistantBench", "Alpha study"),
                ("AssistantBench", "Beta study"),
                ("WebVoyager", "Alpha study"),
                ("WebVoyager", "Beta study"),
            ],
            "tied x values order by study, so a chart never interleaves two "
            "papers by their position in the roster",
        )


class TestOnePaperIsReadOnce(unittest.TestCase):
    """The same PDF imported twice is one study, not two.

    A duplicate import charted twice: two bars, two extraction calls, and a
    coverage denominator counting one paper as two. The sweep already holds
    each paper's text, so identity is the text itself — no title matching and
    no threshold.
    """

    def test_a_second_copy_is_reported_and_left_unread(self):
        with patch(
            "app.llm.chart_operations.read_file",
            return_value="Benchmark A reports 100 examples",
        ):
            evidence, steps, duplicates = ChartOperations.sweep_plan_evidence(
                plan=simple_plan(),
                papers=[("paper-1", "System Card"), ("paper-2", "System Card")],
                evidence={},
                current_user=SimpleNamespace(),
                db=SimpleNamespace(),
                project_id="project-1",
            )

        self.assertEqual(duplicates, {"paper-2"})
        self.assertNotIn("paper-2", evidence)
        self.assertTrue([step for step in steps if "identical" in step])

    def test_papers_that_merely_share_a_title_are_both_read(self):
        with patch(
            "app.llm.chart_operations.read_file",
            side_effect=lambda paper_id, **_: f"Benchmark A reports {paper_id} examples",
        ):
            evidence, _, duplicates = ChartOperations.sweep_plan_evidence(
                plan=simple_plan(),
                papers=[("paper-1", "A Study"), ("paper-2", "A Study")],
                evidence={},
                current_user=SimpleNamespace(),
                db=SimpleNamespace(),
                project_id="project-1",
            )

        self.assertFalse(duplicates)
        self.assertEqual(set(evidence), {"paper-1", "paper-2"})


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
            **DB,
        )

        assert artifact is not None
        steps = artifact.extraction_steps
        self.assertTrue(any("Read 2 PDFs in full" in step for step in steps))
        self.assertTrue(any('"Paper one" — 1 point' in step for step in steps))
        self.assertTrue(
            any("1 paper we read reported no usable value" in step for step in steps)
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
            "app.llm.chart_operations.read_file",
            side_effect=lambda paper_id, **_: f"benchmark {paper_id} reports 12 examples",
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
        with patch(
            "app.llm.chart_operations.read_file", return_value="Nothing relevant here."
        ), patch(
            "app.llm.chart_operations.read_abstract",
            return_value="Abstract:\n\nWe study retrieval.",
        ):
            evidence, _, _ = ChartOperations.sweep_plan_evidence(
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
            "app.llm.chart_operations.read_file",
            return_value="Benchmark A uses 100 examples",
        ):
            evidence, _, _ = ChartOperations.sweep_plan_evidence(
                plan=simple_plan(),
                papers=[("paper-1", "Paper one")],
                evidence={"paper-1": ["1: Benchmark A uses 100 examples"]},
                current_user=SimpleNamespace(),
                db=SimpleNamespace(),
                project_id="project-1",
            )

        self.assertEqual(len(evidence["paper-1"]), 1)


if __name__ == "__main__":
    unittest.main()
