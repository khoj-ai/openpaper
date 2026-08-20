"""Deciding what chart to draw, and finding out whether the corpus can fill it.

Everything here runs before a single value is extracted. It answers three
questions in order: what does this literature report, what chart could be drawn
over it, and which of the candidates does the corpus actually cover. Coverage
is measured against the papers rather than trusted to the model, because a plan
naming a measure one paper uses is indistinguishable, in the model's output,
from one naming a measure every paper uses.
"""

import hashlib
import logging
import re
import uuid
from typing import Optional

from app.database.crud.message_crud import message_crud
from app.llm.base import ModelType
from app.llm.chart_operations.text import (
    field_phrases,
    field_terms,
    normalize,
    plan_terms,
)
from app.llm.conversation_operations import DataTableOperations, FieldInvestigation
from app.llm.prompts import (
    CHART_DISCOVERY_SYSTEM_PROMPT,
    CHART_PLAN_SYSTEM_PROMPT,
    CHART_SCOPE_SYSTEM_PROMPT,
    CHART_VERIFICATION_SYSTEM_PROMPT,
)
from app.llm.provider import LLMProvider, TextContent
from app.llm.tools.file_tools import read_abstract, read_file, search_all_files
from app.schemas.chart import (
    ChartField,
    ChartPlan,
    ChartPlanCandidates,
    ChartProposal,
    ChartScope,
)
from app.schemas.user import CurrentUser
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# Matching lines are all the screen needs: it asks whether a paper mentions
# this measure and this kind of entity, never what the numbers are. Reading the
# numbers is the PDF's job.
SWEEP_LINES_PER_PAPER = 60


def _sweep_query(plan: ChartPlan) -> str:
    """Build the regex that guarantees every paper is searched for this plan.

    Terms come from the confirmed plan's own field labels and keys, so the
    sweep is a function of the plan rather than of whatever synonyms the
    investigator agent happened to try.
    """
    fields = [plan.x, plan.y, *plan.fields]
    keys = [field.key for field in fields]
    if plan.calculation:
        keys.extend(plan.calculation.inputs)
    return plan_terms(
        [field.label for field in fields] + [key.replace("_", " ") for key in keys]
    )


class ChartPlanning(DataTableOperations):
    """Investigation, plan proposal and coverage measurement.

    Built on the data-table mixin because chart evidence is gathered with that
    field-investigation harness, not a parallel one.
    """

    @staticmethod
    def sweep_plan_evidence(
        *,
        plan: ChartPlan,
        papers: list[tuple[str, str]],
        evidence: dict[str, list[str]],
        current_user: CurrentUser,
        db: Session,
        project_id: str,
    ) -> tuple[dict[str, list[str]], list[str], set[str]]:
        """Give every selected paper a floor of plan-relevant evidence.

        The investigator agent decides where to look, which means coverage is
        whatever its search terms happened to reach — the reason two identical
        requests can chart different papers. This sweep is deterministic: the
        same plan reads the same blocks of every paper, every run. It merges
        into the agent's findings rather than replacing them, and it costs no
        LLM calls.

        Also returns the papers that are second copies of one already read. The
        same PDF imported twice is one study, and reading it twice charts it
        twice; that costs an extraction call and puts a duplicate bar on the
        chart. Deciding it here is exact and free, because the text is already
        in hand — no title matching, no similarity threshold. Keeping the
        project's own library clean is a separate job than drawing a chart from
        it, and this only stops one chart from double-counting.
        """
        query = _sweep_query(plan)
        if not query:
            return evidence, [], set()
        try:
            pattern = re.compile(query, re.IGNORECASE)
        except re.error:
            logger.warning("Chart sweep built an invalid query %r", query)
            return evidence, [], set()
        paper_ids = [paper_id for paper_id, _ in papers]
        duplicates: set[str] = set()
        seen_contents: dict[str, str] = {}
        matched = 0
        fell_back = 0
        unreadable = 0
        lines_kept = 0
        for paper_id in paper_ids:
            found: list[str] = []
            try:
                content = read_file(
                    paper_id=paper_id,
                    current_user=current_user,
                    db=db,
                    project_id=project_id,
                    restrict_to_paper_ids=paper_ids,
                )
                fingerprint = hashlib.sha1(content.encode("utf-8")).hexdigest()
                if fingerprint in seen_contents:
                    duplicates.add(paper_id)
                    continue
                seen_contents[fingerprint] = paper_id
                found = [
                    f"{index + 1}: {line}"
                    for index, line in enumerate(content.splitlines(), start=0)
                    if pattern.search(line)
                ][:SWEEP_LINES_PER_PAPER]
                lines_kept += len(found)
            except Exception:
                logger.warning(
                    "Chart sweep could not search paper %s", paper_id, exc_info=True
                )
            if found:
                matched += 1
            elif not evidence.get(paper_id):
                # Nothing matched and the agent never read this paper: keep the
                # abstract so "we looked" is backed by something quotable.
                try:
                    found = [
                        str(
                            read_abstract(
                                paper_id=paper_id,
                                current_user=current_user,
                                db=db,
                                project_id=project_id,
                                restrict_to_paper_ids=paper_ids,
                            )
                        )
                    ]
                    fell_back += 1
                except Exception:
                    unreadable += 1
                    logger.warning(
                        "Chart sweep could not read abstract for paper %s",
                        paper_id,
                        exc_info=True,
                    )
            if not found:
                continue
            existing = evidence.setdefault(paper_id, [])
            seen = {normalize(line) for line in existing}
            for line in found:
                if normalize(line) not in seen:
                    existing.append(line)
                    seen.add(normalize(line))
        steps = [
            f'Swept all {len(paper_ids)} paper{"s" if len(paper_ids) != 1 else ""} '
            f'for the plan\'s own terms ("{query}")',
            f"{matched} paper{'s' if matched != 1 else ''} matched those terms "
            f"across {lines_kept} line{'s' if lines_kept != 1 else ''}",
        ]
        if fell_back:
            steps.append(
                f"{fell_back} paper{'s' if fell_back != 1 else ''} matched nothing; kept the abstract as evidence of the search"
            )
        if unreadable:
            steps.append(
                f"{unreadable} paper{'s' if unreadable != 1 else ''} had no readable text"
            )
        if duplicates:
            steps.append(
                f"{len(duplicates)} paper{'s' if len(duplicates) != 1 else ''} held text "
                "identical to another in the project; read once, charted once"
            )
        return evidence, steps, duplicates

    def investigate_chart_fields(
        self,
        *,
        prompt: str,
        papers: list[tuple[str, str]],
        current_user: CurrentUser,
        db: Session,
        project_id: str,
        plan: Optional[ChartPlan] = None,
    ) -> FieldInvestigation:
        """Use the Data Table field-investigation harness for chart evidence.

        With a confirmed plan, the agent's search is followed by the
        deterministic per-paper sweep so coverage does not depend on which
        synonyms it tried.
        """
        roster = "\n".join(f"- [{paper_id}] {title}" for paper_id, title in papers)
        plan_text = (
            f"\n\nConfirmed chart plan (investigate these exact fields):\n{plan.model_dump_json()}"
            if plan
            else "\n\nNo chart plan exists yet; identify chartable compatible fields before proposing one."
        )
        investigation = self.investigate_fields(
            prompt=prompt,
            papers=papers,
            current_user=current_user,
            db=db,
            project_id=project_id,
            system_prompt=(
                CHART_VERIFICATION_SYSTEM_PROMPT
                if plan
                else CHART_DISCOVERY_SYSTEM_PROMPT
            ),
            user_message=(
                f"User chart request:\n{prompt}\n\nSelected papers:\n{roster}{plan_text}\n\n"
                "Investigate with the available tools, then report your findings."
            ),
        )
        if plan:
            investigation.evidence, steps, duplicates = self.sweep_plan_evidence(
                plan=plan,
                papers=papers,
                evidence=investigation.evidence,
                current_user=current_user,
                db=db,
                project_id=project_id,
            )
            investigation.trace.setdefault("status_messages", []).extend(steps)
            investigation.trace["duplicate_paper_ids"] = sorted(duplicates)
        return investigation

    @staticmethod
    def measure_plan_coverage(
        plan: ChartPlan,
        papers: list[tuple[str, str]],
        current_user: CurrentUser,
        db: Session,
        project_id: str,
    ) -> int:
        """How many papers could actually supply a point for this plan?

        The measure is searched as a phrase and the entity as loose terms,
        because the measure is the discriminating half: papers that report a
        score almost always name what was scored, but "robust accuracy" is a
        different field from "accuracy" and only the phrase can tell them apart.
        """
        paper_ids = [paper_id for paper_id, _ in papers]

        def hits(query: str) -> set[str]:
            if not query:
                return set(paper_ids)
            try:
                found = search_all_files(
                    query=query,
                    current_user=current_user,
                    db=db,
                    project_id=project_id,
                    restrict_to_paper_ids=paper_ids,
                )
            except Exception:
                logger.warning("Coverage probe failed for %r", query, exc_info=True)
                return set()
            return {str(paper_id) for paper_id in found}

        if plan.calculation:
            inputs = [
                field
                for field in plan.fields
                if field.key in set(plan.calculation.inputs)
            ] or [plan.y]
            # Every input must be present in the SAME paper — a derived value
            # needs all of its primitives. Scoring the inputs as an OR would
            # credit a paper that supplies one of four counts, and a computed
            # candidate would win on a number it cannot deliver.
            measure_hits: Optional[set[str]] = None
            for field in inputs:
                found = hits(field_phrases([field]))
                measure_hits = found if measure_hits is None else measure_hits & found
            measure_hits = measure_hits or set()
        else:
            measure_hits = hits(field_phrases([plan.y]))
        return len(measure_hits & hits(field_terms([plan.x])))

    def resolve_chart_scope(
        self,
        prompt: str,
        papers: list[tuple[str, str]],
        conversation_id: Optional[str] = None,
        current_user: Optional[CurrentUser] = None,
        db: Optional[Session] = None,
    ) -> ChartScope:
        """Which papers the request is about, before anything is planned.

        Chat hands the chart pipeline the whole project, and everything
        downstream is built to maximize coverage over whatever roster it is
        given — the sweep reads every paper, and the screen admits every paper
        that mentions the measure. That is right for "compare these papers" and
        wrong for "from that paper", and nothing between the two could tell
        them apart, because a plan describes a measurement and never a subset.

        So the subset is decided here, first, from the request and the turns
        that gave it its antecedent. A resolver that cannot tell asks; guessing
        wide is not a partial answer, it is a different one.

        Returns the whole roster when the request is corpus-wide, which is the
        common case and the safe default.
        """
        roster = "\n".join(f"- [{paper_id}] {title}" for paper_id, title in papers)
        history = (
            message_crud.get_conversation_messages(
                db,
                conversation_id=uuid.UUID(conversation_id),
                current_user=current_user,
            )
            if conversation_id and db and current_user
            else []
        )
        response = self.generate_content(
            contents=[
                TextContent(text=f"Chart request:\n{prompt}\n\nPapers:\n{roster}")
            ],
            history=history,
            system_prompt=CHART_SCOPE_SYSTEM_PROMPT,
            model_type=ModelType.FAST,
            schema=ChartScope.model_json_schema(),
            provider=LLMProvider.GEMINI,
        )
        if not response or not response.text:
            return ChartScope(covers="all_papers")
        try:
            scope = ChartScope.model_validate_json(response.text)
        except Exception:
            logger.exception("Failed to parse chart scope")
            return ChartScope(covers="all_papers")
        # An id the model invented would silently narrow the chart to nothing,
        # which looks exactly like a corpus that reports none of the measure.
        known = {paper_id for paper_id, _ in papers}
        # `covers` is the decision; ids only carry it out. Honouring ids the
        # model listed after calling the request corpus-wide would reintroduce
        # the narrowing by the back door.
        if scope.covers == "all_papers":
            return ChartScope(covers=scope.covers)
        resolved = [paper_id for paper_id in scope.paper_ids if paper_id in known]
        if len(resolved) != len(scope.paper_ids):
            logger.warning(
                "Chart scope named %d paper(s) not in the roster",
                len(scope.paper_ids) - len(resolved),
            )
        if resolved:
            logger.info(
                "Chart scope narrowed to %d of %d papers", len(resolved), len(papers)
            )
        return ChartScope(
            covers=scope.covers,
            paper_ids=resolved,
            clarification=scope.clarification,
        )

    def propose_chart_plan(
        self,
        prompt: str,
        papers: list[tuple[str, str]],
        findings: str = "",
        conversation_id: Optional[str] = None,
        current_user: Optional[CurrentUser] = None,
        db: Optional[Session] = None,
        project_id: Optional[str] = None,
    ) -> ChartProposal:
        """Propose several plans, then choose the one the corpus can fill.

        Coverage is measured, not trusted to the model: a plan naming a measure
        one paper uses is indistinguishable, in the model's output, from one
        naming a measure every paper uses.

        Returns a proposal rather than a plan because the planner is allowed to
        decline. "Chart these papers" pins to no axis, and a plan invented to
        satisfy it wastes a long generation and produces a chart nobody asked
        for; the clarification goes back to the user instead.
        """
        roster = "\n".join(f"- [{paper_id}] {title}" for paper_id, title in papers)
        # The turns go in as conversation history, the way every other chat call
        # passes them, rather than being flattened into the prompt by the caller.
        # "Chart this relationship" names nothing on its own; without the turn
        # that established the relationship a planner has to invent a subject.
        history = (
            message_crud.get_conversation_messages(
                db,
                conversation_id=uuid.UUID(conversation_id),
                current_user=current_user,
            )
            if conversation_id and db and current_user
            else []
        )
        response = self.generate_content(
            contents=[
                TextContent(
                    text=f"User request:\n{prompt}\n\nPapers:\n{roster}\n\nInvestigator findings:\n{findings}"
                )
            ],
            history=history,
            system_prompt=CHART_PLAN_SYSTEM_PROMPT,
            model_type=ModelType.FAST,
            schema=ChartPlanCandidates.model_json_schema(),
            provider=LLMProvider.GEMINI,
        )
        if not response or not response.text:
            return ChartProposal()
        try:
            proposed = ChartPlanCandidates.model_validate_json(response.text)
        except Exception:
            logger.exception("Failed to parse chart plan candidates")
            return ChartProposal()
        plans = [self._normalize_plan(candidate) for candidate in proposed.candidates]
        plans = [plan for plan in plans if plan]
        if not plans:
            return ChartProposal(clarification=proposed.clarification)
        if current_user is None or db is None or project_id is None:
            return ChartProposal(plan=plans[0])
        scored = [
            (
                self.measure_plan_coverage(plan, papers, current_user, db, project_id),
                -index,
                plan,
            )
            for index, plan in enumerate(plans)
        ]
        coverage, _, best = max(scored)
        logger.info(
            "Chart plan chosen by coverage: %r covers %d/%d papers (candidates: %s)",
            best.y.label,
            coverage,
            len(papers),
            ", ".join(f"{p.y.label}={c}" for c, _, p in scored),
        )
        return ChartProposal(plan=best)

    @staticmethod
    def _normalize_plan(plan: ChartPlan) -> Optional[ChartPlan]:
        try:
            keys = {field.key for field in plan.fields}
            if plan.x.key not in keys:
                plan.fields.append(plan.x)
            if plan.y.key not in keys and not plan.calculation:
                plan.fields.append(plan.y)
            if plan.series and plan.series.key not in {
                field.key for field in plan.fields
            }:
                plan.fields.append(plan.series)
            # A series must not duplicate an axis, or every point carries its
            # own group and the legend becomes noise.
            if plan.series and plan.series.key in {plan.x.key, plan.y.key}:
                plan.series = None
            if plan.calculation:
                # The renderer reads y by its field key, so use that same key
                # for the sandbox output while retaining the display label on y.
                plan.calculation.label = plan.y.key
                # fields is what the investigator and the sweep search for. A
                # calculation input missing from it would only ever be found by
                # luck.
                declared = {field.key for field in plan.fields}
                for key in plan.calculation.inputs:
                    if key not in declared:
                        plan.fields.append(
                            ChartField(key=key, label=key.replace("_", " ").strip())
                        )
                        declared.add(key)
            return plan
        except Exception:
            logger.exception("Failed to parse chart plan")
            return None
