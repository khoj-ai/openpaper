"""Chart artifacts for chat and the project artifact panel.

Two halves, one per file, because they answer different questions and fail in
different ways:

- `planning` decides what chart to draw and whether the corpus can fill it. It
  reads extracted text, cheaply, across every selected paper.
- `extraction` turns a confirmed plan into cited points. It reads PDFs, one per
  paper, and only for the papers planning's screen passed.

`text` holds what both need: are these two pieces of text the same thing, and
where in a paper is this field named.

Two properties matter as much as grounding, because a chart that quietly
changes between identical requests is not trustworthy even when every bar is
cited:

- Coverage is obligatory, not emergent. The investigator agent searches
  wherever its terms lead it; on top of that, every selected paper gets a
  plan-driven sweep, so a paper's absence means "we looked and it isn't
  there", never "the agent didn't happen to search here".
- Extraction is per paper. One call each, so a large corpus can't crowd out the
  tail of the roster and one bad response can't take the whole chart down.
"""

from collections import Counter
from typing import Optional

from app.llm.chart_operations.extraction import ChartExtracting
from app.llm.chart_operations.planning import ChartPlanning
from app.llm.chart_operations.text import normalize
from app.llm.conversation_operations import FieldInvestigation
from app.schemas.chart import ChartArtifactPayload, ChartPlan
from app.schemas.user import CurrentUser
from sqlalchemy.orm import Session


class ChartOperations(ChartPlanning, ChartExtracting):
    """Mixin used by the unified Operations client.

    Holds only what spans both halves: the request-to-chart orchestration, and
    the small predicates callers use to decide whether to show a chart at all.
    """

    @staticmethod
    def is_chart_ready(payload: ChartArtifactPayload) -> bool:
        """Any grounded point is a chart.

        Requiring two threw away real findings: a corpus where exactly one
        paper reports the measure produced no chart at all, which reads as "we
        found nothing" when the truth is "we found one thing". The coverage
        line says how thin it is and the not-charted list says why.
        """
        return any(not record.exclusion_reason for record in payload.records)

    @staticmethod
    def chart_failure_message(payload: ChartArtifactPayload) -> str:
        """Explain a no-chart result without pretending an empty card succeeded."""
        excluded = Counter(payload.coverage.excluded.values())
        reasons = (
            "; ".join(
                f"{count} paper{'s' if count != 1 else ''}: {reason}"
                for reason, count in excluded.most_common(3)
            )
            or "no directly quoted values were found"
        )
        # The scope is rarely the problem — an axis named after one paper's
        # vocabulary is. Telling the user to narrow the scope sends them the
        # wrong way, so name the axis and point at broadening it.
        return (
            "I couldn't create a chart from this scope. I interpreted the request as "
            f"**{payload.plan.y.label}** against **{payload.plan.x.label}**, but found "
            f"only {len(payload.coverage.included_paper_ids)} of "
            f"{len(payload.coverage.searched_paper_ids)} papers with the required directly quoted values. "
            f"Why: {reasons}. **{payload.plan.y.label}** may be too specific for this "
            "project — a broader measure these papers share would cover more of them. "
        )

    def create_chart_artifact(
        self,
        *,
        prompt: str,
        papers: list[tuple[str, str]],
        current_user: CurrentUser,
        db: Session,
        project_id: str,
        plan: Optional[ChartPlan] = None,
        conversation_id: Optional[str] = None,
        prior_evidence: Optional[dict[str, list[str]]] = None,
    ) -> tuple[Optional[ChartArtifactPayload], dict]:
        """The one path from a request to a chart, for chat and the composer.

        Chat and the artifact panel used to gather evidence differently — the
        panel ran a plan-targeted agent that chat never did — so the same
        request could chart in one surface and come up empty in the other.
        Both now run the same steps in the same order:

          discover (unless a plan is confirmed) -> plan -> verify against the
          plan -> extract per paper.

        `plan` is supplied by the composer, which already proposed one for the
        user to edit; chat proposes its own. `prior_evidence` carries the chat's
        own gathered passages in, and `conversation_id` lets a follow-up like
        "chart that relationship" resolve against the turns that established it.
        Returns the artifact and the merged trace.
        """
        evidence: dict[str, list[str]] = {
            paper_id: list(lines) for paper_id, lines in (prior_evidence or {}).items()
        }
        status: list[str] = []

        def absorb(investigation: FieldInvestigation) -> None:
            for paper_id, lines in investigation.evidence.items():
                existing = evidence.setdefault(paper_id, [])
                seen = {normalize(line) for line in existing}
                for line in lines:
                    if normalize(line) not in seen:
                        existing.append(line)
                        seen.add(normalize(line))
            status.extend(investigation.trace.get("status_messages", []))

        if plan is None:
            absorb(
                self.investigate_chart_fields(
                    prompt=prompt,
                    papers=papers,
                    current_user=current_user,
                    db=db,
                    project_id=project_id,
                )
            )
            proposal = self.propose_chart_plan(
                prompt,
                papers,
                "\n\n".join(status),
                conversation_id=conversation_id,
                current_user=current_user,
                db=db,
                project_id=project_id,
            )
            if proposal.plan is None:
                if proposal.clarification:
                    status.append(proposal.clarification)
                return None, {
                    "status_messages": status,
                    "clarification": proposal.clarification,
                }
            plan = proposal.plan

        # The plan-targeted pass: an agent reading for these exact fields finds
        # pairs that a term sweep alone misses, and it runs the sweep too.
        verification = self.investigate_chart_fields(
            prompt=prompt,
            papers=papers,
            current_user=current_user,
            db=db,
            project_id=project_id,
            plan=plan,
        )
        absorb(verification)
        # A second copy of a paper is not a second study. Dropping it from the
        # roster before extraction keeps it out of the coverage count as well as
        # off the chart, so "3 of 249 papers" means 249 distinct papers.
        duplicates = set(verification.trace.get("duplicate_paper_ids") or [])
        if duplicates:
            papers = [
                (paper_id, title)
                for paper_id, title in papers
                if paper_id not in duplicates
            ]
            for paper_id in duplicates:
                evidence.pop(paper_id, None)
        artifact = self.build_chart_artifact(
            prompt=prompt,
            plan=plan,
            evidence=evidence,
            papers=papers,
            current_user=current_user,
            db=db,
            project_id=project_id,
        )
        if artifact is not None:
            status.extend(artifact.extraction_steps)
            artifact.investigation_trace = {"status_messages": status}
        return artifact, {"status_messages": status}


__all__ = ["ChartOperations"]
