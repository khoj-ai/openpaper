"""Chat's entry point to a chart: a tool, not a keyword match.

Charts used to be triggered by looking for "chart", "plot", "graph" in the
user's message. That fires on a sentence like "the paper charts a course for
policy" and misses "show me how accuracy varies with model size", and it cannot
see any of the context that decides whether a chart is possible at all — which
papers are in scope, what they report, whether the question is comparative.
The model gathering evidence has read the papers and has all of it, so the
decision is its own.

The tool starts a job; it does not build a chart. Generation takes minutes and
runs in the background (`tasks/chart_generation`), so what comes back is an
acknowledgement the answering model can write around: it knows a chart is
coming, can say so, and has no numbers to invent because none are drawn yet.
"""

import logging
import uuid
from typing import Any, NamedTuple, Optional

from app.database.crud.projects.project_chart_crud import SOURCE_CHAT, chart_job_crud
from app.llm.chart_operations.planning import ChartPlanning
from app.schemas.user import CurrentUser
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


create_chart_function = {
    "name": "create_chart_artifact",
    "description": (
        "Start building a chart from the papers. Use this when the user asks "
        "to chart, plot, graph, or visualize something, and also when they ask "
        "a question a chart answers better than prose — how some measure "
        "varies across papers, or across a condition several papers report.\n\n"
        "This hands the request to an autonomous agent that plans the chart, "
        "reads the papers as PDFs, and extracts directly quoted values. It "
        "takes several minutes and runs in the background: this call returns "
        "as soon as the work is queued, and the finished chart arrives on its "
        "own card in this turn. You will never see its contents, so do not "
        "describe, summarize, or predict what the chart shows — say it is "
        "being built, and answer the rest of the question from the evidence "
        "you gathered. Call it once per chart the user asked for."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "request": {
                "type": "string",
                "description": (
                    "What to chart, as one self-contained instruction. The "
                    "agent cannot see this conversation, so resolve every "
                    "reference before passing it on: 'chart that against "
                    "sample size' becomes 'plot reported F1 score against "
                    "study sample size'. Name the measure and what it varies "
                    "over."
                ),
            },
            "paper_ids": {
                "type": "array",
                "items": {"type": "string"},
                "description": (
                    "The papers THIS request is about. Fill it only when the "
                    "request itself points at papers — a demonstrative, a "
                    "title, a count: 'this paper', 'the Stanford trial', "
                    "'both studies'. Point to the words in the request that "
                    "refer to papers; if you cannot quote such words from the "
                    "request itself, leave this empty, which means every paper "
                    "in the project. What the conversation has been about does "
                    "not narrow a chart — only what was just asked does."
                ),
            },
        },
        "required": ["request"],
    },
}


class ChartRequest(NamedTuple):
    """What the tool hands back: the queued job, and what the model is told.

    Separate fields because they go to different places — the job to the
    client as a card and to the dispatcher once the turn is saved, the summary
    into the model's context as an ordinary tool result.
    """

    job: Optional[dict[str, Any]]
    summary: str


_planner: Optional[ChartPlanning] = None


def _get_planner() -> ChartPlanning:
    global _planner
    if _planner is None:
        _planner = ChartPlanning()
    return _planner


def run_create_chart_artifact(
    request: str,
    current_user: CurrentUser,
    db: Session,
    paper_ids: Optional[list[str]] = None,
    project_id: Optional[str] = None,
    restrict_to_paper_ids: Optional[list[str]] = None,
    conversation_id: Optional[str] = None,
    roster: Optional[list[tuple[str, str]]] = None,
) -> ChartRequest:
    """Queue a chart job for the papers this request is about.

    Scope is decided twice on purpose. The caller has read the papers and is
    the better judge of what the request means, but it is also the model under
    the most pressure to over-read the conversation: several turns deep in one
    paper, "chart the accuracy numbers" reads as "this paper's" to a model that
    has been staring at it, and reads as the whole corpus to the user who asked.
    That mistake is expensive and invisible — it returns a chart, just of the
    wrong eighteen papers — so `resolve_chart_scope` re-reads the request alone,
    and its answer is the one that stands when it commits to specific papers.

    The resolver only ever narrows: when it finds no papers named in the
    request, the caller's own list is kept, because a tool that went to the
    trouble of naming one paper is more likely to be right than a second
    opinion that found nothing to name.
    """
    if not project_id:
        # A job is a row against a project, so a library-wide thread has
        # nowhere to hang one. The declaration is withheld outside projects;
        # this is the backstop, phrased for the model rather than as an error.
        return ChartRequest(
            None,
            "No chart was started: charts can only be built inside a project. "
            "Tell the user they can build one from a project that holds these "
            "papers, and answer their question from the evidence instead.",
        )

    available = list(roster or [])
    if restrict_to_paper_ids is not None:
        allowed = set(restrict_to_paper_ids)
        available = [entry for entry in available if entry[0] in allowed]
    if not available:
        return ChartRequest(
            None, "No chart was started: no papers are in scope for this request."
        )

    known = {paper_id for paper_id, _ in available}
    named = [paper_id for paper_id in (paper_ids or []) if paper_id in known]
    if len(named) != len(paper_ids or []):
        # An invented id would silently narrow the chart to nothing, which
        # looks exactly like a corpus that reports none of the measure.
        logger.warning(
            "Chart request named %d paper(s) not in the roster",
            len(paper_ids or []) - len(named),
        )

    scope = _get_planner().resolve_chart_scope(
        request,
        available,
        conversation_id=conversation_id,
        current_user=current_user,
        db=db,
    )
    if scope.clarification:
        # Asking is cheap; a five-minute chart of the wrong papers is not.
        return ChartRequest(
            None,
            "No chart was started, because it is unclear which papers the "
            f"request covers. Ask the user this, in your own words: {scope.clarification}",
        )

    selected = named
    if scope.covers == "specific_papers" and scope.paper_ids:
        if sorted(scope.paper_ids) != sorted(named):
            logger.info(
                "Chart scope guard replaced %d requested paper(s) with %d",
                len(named),
                len(scope.paper_ids),
            )
        selected = list(scope.paper_ids)

    job = chart_job_crud.create(
        db,
        project_id=uuid.UUID(project_id),
        prompt=request,
        paper_ids=selected,
        plan=None,
        user=current_user,
        source=SOURCE_CHAT,
    )
    if not job:
        return ChartRequest(
            None,
            "No chart was started: the user needs edit access to this project "
            "to build one. Tell them that.",
        )

    count = len(selected) or len(available)
    return ChartRequest(
        chart_job_crud.to_dict(job),
        f"Chart generation has started over {count} paper"
        f"{'s' if count != 1 else ''} and is running in the background; its "
        "card is already visible in this turn and will fill in over the next "
        "few minutes. You cannot see the result, so do not describe or predict "
        "the chart's contents — mention that it is being built, and answer the "
        "rest of the question from the evidence you gathered.",
    )
