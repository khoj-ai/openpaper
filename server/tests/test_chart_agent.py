"""What the chart tool starts, and what it refuses to start.

The tool decides one thing — which papers a chart covers — and gets it wrong in
an expensive way: a chart of the wrong eighteen papers looks exactly like a
chart, and takes five minutes to not answer the question. So scope is settled
twice, and these tests pin which of the two answers wins in each case.

Everything here is about the decision, never the chart: no job started means no
chart, and the reason has to reach the model as words it can say back.
"""

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.llm import chart_agent
from app.llm.chart_agent import run_create_chart_artifact
from app.schemas.chart import ChartScope
from app.schemas.message import EvidenceCollection
from app.schemas.responses import ToolCall

PROJECT_ID = "11111111-1111-1111-1111-111111111111"

ROSTER = [
    ("paper-1", "WebCoach"),
    ("paper-2", "UpBench"),
    ("paper-3", "Predicting Poverty"),
]


class StubPlanner:
    """The scope guard, with its answer supplied by the test."""

    def __init__(self, scope: ChartScope):
        self.scope = scope
        self.rosters: list[list[str]] = []

    def resolve_chart_scope(
        self, prompt, papers, conversation_id=None, current_user=None, db=None
    ) -> ChartScope:
        self.rosters.append([paper_id for paper_id, _ in papers])
        return self.scope


class StubJobs:
    """chart_job_crud, recording what it was asked to persist."""

    def __init__(self, *, grant: bool = True):
        self.grant = grant
        self.kwargs = None

    def create(self, db, **kwargs):
        self.kwargs = kwargs
        return SimpleNamespace(id="job-1") if self.grant else None

    def to_dict(self, job):
        return {"id": str(job.id), "prompt": (self.kwargs or {}).get("prompt")}


def call_tool(
    scope: ChartScope,
    *,
    paper_ids=None,
    project_id=PROJECT_ID,
    roster=ROSTER,
    grant=True,
    restrict=None,
    request="plot reported accuracy against model size",
):
    planner = StubPlanner(scope)
    jobs = StubJobs(grant=grant)
    with (
        patch.object(chart_agent, "_get_planner", lambda: planner),
        patch.object(chart_agent, "chart_job_crud", jobs),
    ):
        result = run_create_chart_artifact(
            request,
            current_user=SimpleNamespace(id="user-1"),
            db=SimpleNamespace(),
            paper_ids=paper_ids,
            project_id=project_id,
            restrict_to_paper_ids=restrict,
            conversation_id="conv-1",
            roster=roster,
        )
    return result, jobs, planner


class TestScopeIsSettledTwice(unittest.TestCase):
    def test_naming_no_papers_means_the_whole_project(self):
        # Empty is not "none" — it is the corpus, and the common case.
        result, jobs, _ = call_tool(ChartScope(covers="all_papers"))

        self.assertIsNotNone(result.job)
        self.assertEqual(jobs.kwargs["paper_ids"], [])

    def test_the_guard_narrows_a_request_that_reached_too_wide(self):
        # The failure this exists for: the tool asked for the whole project,
        # but the request named one paper. The guard's answer stands.
        result, jobs, _ = call_tool(
            ChartScope(covers="specific_papers", paper_ids=["paper-1"]),
            paper_ids=[],
        )

        self.assertIsNotNone(result.job)
        self.assertEqual(jobs.kwargs["paper_ids"], ["paper-1"])

    def test_the_guard_finding_nothing_leaves_the_tools_choice_alone(self):
        # It only ever narrows. A tool that went to the trouble of naming a
        # paper is not overruled by a second opinion that named none.
        _, jobs, _ = call_tool(
            ChartScope(covers="all_papers"),
            paper_ids=["paper-2"],
        )

        self.assertEqual(jobs.kwargs["paper_ids"], ["paper-2"])

    def test_a_paper_that_isnt_in_the_roster_is_dropped(self):
        # An invented id would narrow the chart to nothing, which reads exactly
        # like a corpus where no paper reports the measure.
        _, jobs, _ = call_tool(
            ChartScope(covers="all_papers"),
            paper_ids=["paper-1", "paper-404"],
        )

        self.assertEqual(jobs.kwargs["paper_ids"], ["paper-1"])


class TestNothingStartsWithoutAnAnswer(unittest.TestCase):
    def test_an_ambiguous_request_starts_no_job(self):
        # Asking is cheap; five minutes of the wrong papers is not.
        result, jobs, _ = call_tool(
            ChartScope(
                covers="specific_papers",
                clarification="Do you mean WebCoach or UpBench?",
            ),
            paper_ids=["paper-1"],
        )

        self.assertIsNone(result.job)
        self.assertIsNone(jobs.kwargs)
        self.assertIn("WebCoach or UpBench", result.summary)

    def test_a_reader_cannot_start_one(self):
        result, _, _ = call_tool(ChartScope(covers="all_papers"), grant=False)

        self.assertIsNone(result.job)
        self.assertIn("edit access", result.summary)

    def test_charts_need_a_project_to_belong_to(self):
        # A job is a row against a project, so a library-wide thread has
        # nowhere to hang one — and no scope call should be spent finding out.
        result, jobs, planner = call_tool(
            ChartScope(covers="all_papers"), project_id=None
        )

        self.assertIsNone(result.job)
        self.assertIsNone(jobs.kwargs)
        self.assertEqual(planner.rosters, [])
        self.assertIn("project", result.summary)

    def test_an_empty_roster_starts_no_job(self):
        result, jobs, _ = call_tool(ChartScope(covers="all_papers"), roster=[])

        self.assertIsNone(result.job)
        self.assertIsNone(jobs.kwargs)


class TestMentionScopingIsAHardLimit(unittest.TestCase):
    def test_the_guard_never_sees_papers_the_turn_excluded(self):
        # @-mention scoping is enforced before scope is resolved, so a paper
        # the user put out of reach cannot be reintroduced by either decision.
        _, jobs, planner = call_tool(
            ChartScope(covers="all_papers"),
            paper_ids=["paper-2"],
            restrict=["paper-1"],
        )

        self.assertEqual(planner.rosters, [["paper-1"]])
        self.assertEqual(jobs.kwargs["paper_ids"], [])


class TestWhatTheModelIsToldBack(unittest.TestCase):
    def test_the_summary_forbids_inventing_the_chart(self):
        # The answering model never sees the chart — it lands minutes later on
        # its own card — so the one thing this must say is "do not describe it".
        result, _, _ = call_tool(ChartScope(covers="all_papers"))

        self.assertIn("do not describe", result.summary.lower())

    def test_the_job_travels_back_for_the_caller_to_dispatch(self):
        # Queued here, dispatched only once the turn's message exists to
        # attach the finished chart to.
        result, _, _ = call_tool(ChartScope(covers="all_papers"))

        self.assertEqual(result.job["id"], "job-1")


class TestTheAnsweringModelHearsAboutIt(unittest.TestCase):
    """Gathering and answering are two model calls; only one sees tool results.

    Whatever the answering model is not told, it cannot mention — and a chart
    card it fails to mention is a card the user has no explanation for.
    """

    @staticmethod
    def collection(*, jobs=(), calls=()):
        collected = EvidenceCollection()
        for name, args in calls:
            collected.add_tool_call(ToolCall(name=name, args=args))
        for job in jobs:
            collected.add_chart_job(job)
        return collected

    def test_a_queued_chart_crosses_the_boundary(self):
        actions = self.collection(
            jobs=[{"id": "job-1", "prompt": "plot accuracy against model size"}],
            calls=[("create_chart_artifact", {})],
        ).describe_actions()

        self.assertIn("charts_started", actions)
        self.assertEqual(
            actions["charts_started"][0]["request"],
            "plot accuracy against model size",
        )
        self.assertIn("do not describe", actions["charts_started"][0]["note"].lower())

    def test_a_chart_is_not_double_counted_as_a_search(self):
        actions = self.collection(
            jobs=[{"id": "job-1", "prompt": "plot it"}],
            calls=[
                ("search_all_files", {"query": "accuracy"}),
                ("create_chart_artifact", {}),
            ],
        ).describe_actions()

        self.assertEqual(
            actions["evidence_gathering"], "1 tool call(s): search_all_files"
        )

    def test_a_turn_that_did_nothing_reports_nothing(self):
        self.assertIsNone(self.collection().describe_actions())


if __name__ == "__main__":
    unittest.main()
