"""Chart planning and extraction for chat and project artifacts.

The model is allowed to select fields and quote primitives, never to perform
arithmetic.  Derived y values are delegated to the existing sandboxed compute
agent, whose full provenance becomes part of the artifact payload.
"""

import json
import logging
from collections import Counter
from typing import Optional

from app.helpers.compute_agent import ComputeAgentError, run_computed_columns
from app.llm.base import ModelType
from app.llm.conversation_operations import FieldInvestigation
from app.llm.provider import LLMProvider, TextContent
from app.schemas.chart import (
    ChartArtifactPayload,
    ChartCoverage,
    ChartPlan,
    ChartRecord,
    ChartValue,
)
from app.schemas.responses import (
    ComputedColumnSpec,
    DataTableCellValue,
    DataTableRow,
    ResponseCitation,
)
from app.schemas.user import CurrentUser
from pydantic import Field, create_model
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


PLAN_PROMPT = """
You design a small, defensible research chart. Given a user request and a paper
roster, return only the JSON ChartPlan schema. Use bar, line, or scatter. V1
supports one series only, so leave `series` null. Make the x/y fields concrete
and include units when known. `fields` must list every
primitive the extractor needs. If y requires arithmetic, put the derived y in
`calculation` and list its primitive input keys in fields. Do not invent paper
findings or values. Keep the plan small enough to chart from a handful of
papers.
""".strip()


CHART_INVESTIGATION_PROMPT = """
You are a research investigator preparing a chart over selected papers. You do
NOT design the chart or invent numbers. Your job is to discover which concrete,
compatible fields the papers report and retain source passages for a later
extractor.

Start with search_all_files using the request's terms and corpus-specific
synonyms. For example, "data points" may be reported as examples, instances,
samples, records, training set size, or observations. Then use search_file and
view_file on promising papers to verify that the x and y values describe the
same named entity (benchmark, dataset, model, arm, condition) and are not two
unpaired lists.

On the final round, reply with findings only: exact terminology, units, the
entity that pairs the values, candidate papers with both fields, and fields
that are absent. Never claim a field is absent merely because a first broad
search failed. You are on round {n_round} of {max_rounds}.
""".strip()


EXTRACTION_PROMPT = """
You extract the cited primitive values required by a chart plan from collected
paper evidence. Return only the JSON ChartExtraction schema.

Rules:
- Copy values only when directly supported by the supplied evidence.
- Every value MUST include an exact quote from that evidence; use the source
  line number when available.
- Do not calculate values. For a derived y, return only its primitive inputs;
  the application calculates the derived value later.
- Return a record ONLY when it contains every field needed to plot a point.
- A paper may produce multiple records when it reports multiple named
  benchmarks/datasets/models; each record must pair its values to that same
  entity. Do not return exclusion records or coverage—the application creates
  those deterministically.
""".strip()


class ChartOperations:
    """Mixin used by the unified Operations client."""

    @staticmethod
    def is_chart_request(question: str) -> bool:
        text = question.lower()
        return any(
            word in text for word in ("chart", "plot", "graph", "visualize", "scatter")
        )

    @staticmethod
    def is_chart_ready(payload: ChartArtifactPayload) -> bool:
        """A chart needs at least two grounded points to support a comparison."""
        return sum(1 for record in payload.records if not record.exclusion_reason) >= 2

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
        return (
            "I couldn't create a chart from this scope. I interpreted the request as "
            f"**{payload.plan.y.label}** against **{payload.plan.x.label}**, but found "
            f"only {len(payload.coverage.included_paper_ids)} of "
            f"{len(payload.coverage.searched_paper_ids)} papers with the required directly quoted values. "
            f"Why: {reasons}. Try narrowing the paper scope or use **Artifacts → Chart** to adjust the axes before generation."
        )

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
        """Use the Data Table field-investigation harness for chart evidence."""
        roster = "\n".join(f"- [{paper_id}] {title}" for paper_id, title in papers)
        plan_text = (
            f"\n\nConfirmed chart plan (investigate these exact fields):\n{plan.model_dump_json()}"
            if plan
            else "\n\nNo chart plan exists yet; identify chartable compatible fields before proposing one."
        )
        return self.investigate_fields(
            prompt=prompt,
            papers=papers,
            current_user=current_user,
            db=db,
            project_id=project_id,
            system_prompt=CHART_INVESTIGATION_PROMPT,
            user_message=(
                f"User chart request:\n{prompt}\n\nSelected papers:\n{roster}{plan_text}\n\n"
                "Investigate with the available tools, then report your findings."
            ),
        )

    def propose_chart_plan(
        self,
        prompt: str,
        papers: list[tuple[str, str]],
        findings: str = "",
    ) -> Optional[ChartPlan]:
        roster = "\n".join(f"- [{paper_id}] {title}" for paper_id, title in papers)
        response = self.generate_content(
            contents=[
                TextContent(
                    text=f"User request:\n{prompt}\n\nPapers:\n{roster}\n\nInvestigator findings:\n{findings}"
                )
            ],
            system_prompt=PLAN_PROMPT,
            model_type=ModelType.FAST,
            schema=ChartPlan.model_json_schema(),
            provider=LLMProvider.GEMINI,
        )
        if not response or not response.text:
            return None
        try:
            plan = ChartPlan.model_validate_json(response.text)
            keys = {field.key for field in plan.fields}
            if plan.x.key not in keys:
                plan.fields.append(plan.x)
            if plan.y.key not in keys and not plan.calculation:
                plan.fields.append(plan.y)
            if plan.series and plan.series.key not in {
                field.key for field in plan.fields
            }:
                plan.fields.append(plan.series)
            # Multi-series rendering waits on the dedicated accessible palette
            # work; keeping the schema flexible does not enable it prematurely.
            plan.series = None
            if plan.calculation:
                # The renderer reads y by its field key, so use that same key
                # for the sandbox output while retaining the display label on y.
                plan.calculation.label = plan.y.key
            return plan
        except Exception:
            logger.exception("Failed to parse chart plan")
            return None

    def build_chart_artifact(
        self,
        *,
        prompt: str,
        plan: ChartPlan,
        evidence: dict[str, list[str]],
        papers: list[tuple[str, str]],
    ) -> Optional[ChartArtifactPayload]:
        paper_ids = [paper_id for paper_id, _ in papers]
        paper_titles = dict(papers)
        required_keys = sorted(
            {plan.x.key}
            | set(plan.calculation.inputs if plan.calculation else [plan.y.key])
        )
        # A generic Dict[str, ChartValue] lets Gemini emit `{}`. Build the
        # structured-output schema from the confirmed plan so each required
        # source-backed field is an explicit required JSON property.
        point_values_model = create_model(
            "ChartPointValues",
            **{key: (ChartValue, ...) for key in required_keys},
        )
        point_record_model = create_model(
            "ChartPointExtractionRecord",
            paper_id=(str, ...),
            paper_title=(str, ...),
            values=(point_values_model, ...),
        )
        extraction_model = create_model(
            "ChartPointExtraction",
            records=(list[point_record_model], Field(default_factory=list)),
        )
        response = self.generate_content(
            contents=[
                TextContent(
                    text=(
                        f"User request:\n{prompt}\n\nChart plan:\n{plan.model_dump_json()}"
                        f"\n\nPaper roster:\n{json.dumps(paper_titles)}"
                        f"\n\nCollected evidence:\n{json.dumps(evidence)}"
                    )
                )
            ],
            system_prompt=(
                f"{EXTRACTION_PROMPT}\n\nFor this run, every returned record's values "
                f"MUST include these exact keys: {', '.join(required_keys)}. "
                "Return an empty records array if no paper has all of them; never return an empty values object."
            ),
            model_type=ModelType.FAST,
            schema=extraction_model.model_json_schema(),
            provider=LLMProvider.GEMINI,
        )
        if not response or not response.text:
            return None
        try:
            extraction = extraction_model.model_validate_json(response.text)
        except Exception:
            logger.exception("Failed to parse chart extraction")
            return None

        payload = ChartArtifactPayload(
            plan=plan,
            records=[
                ChartRecord(
                    paper_id=record.paper_id,
                    paper_title=record.paper_title,
                    values={key: getattr(record.values, key) for key in required_keys},
                )
                for record in extraction.records
            ],
            coverage=ChartCoverage(),
        )
        evidence_text = {
            paper_id: "\n".join(lines) for paper_id, lines in evidence.items()
        }
        valid_records: list[ChartRecord] = []
        excluded: dict[str, str] = {}
        for record in payload.records:
            if record.paper_id not in paper_titles:
                continue
            record.paper_title = paper_titles[record.paper_id]
            source = evidence_text.get(record.paper_id, "")
            invalid = [
                key
                for key, value in record.values.items()
                if not value.quote or value.quote not in source
            ]
            required = {plan.x.key}
            required.update(
                plan.calculation.inputs if plan.calculation else [plan.y.key]
            )
            if invalid or not required.issubset(record.values):
                excluded[record.paper_id] = (
                    "Missing a directly quoted value required for this chart"
                )
                record.exclusion_reason = excluded[record.paper_id]
                valid_records.append(record)
            else:
                valid_records.append(record)
        seen_ids = {record.paper_id for record in valid_records}
        for paper_id, title in papers:
            if paper_id not in seen_ids:
                reason = "No chart-ready value was found in the gathered evidence"
                valid_records.append(
                    ChartRecord(
                        paper_id=paper_id,
                        paper_title=title,
                        exclusion_reason=reason,
                    )
                )
                excluded[paper_id] = reason
        payload.records = valid_records
        payload.coverage = ChartCoverage(
            searched_paper_ids=paper_ids,
            included_paper_ids=list(
                dict.fromkeys(
                    r.paper_id for r in valid_records if not r.exclusion_reason
                )
            ),
            excluded=excluded,
        )

        if plan.calculation:
            self._compute_derived_y(payload, paper_titles)
        return payload

    @staticmethod
    def _compute_derived_y(
        payload: ChartArtifactPayload, paper_titles: dict[str, str]
    ) -> None:
        calculation = payload.plan.calculation
        if not calculation:
            return
        rows = []
        for record in payload.records:
            if record.exclusion_reason:
                continue
            rows.append(
                DataTableRow(
                    paper_id=record.paper_id,
                    values={
                        key: DataTableCellValue(
                            value=value.value,
                            citations=[
                                ResponseCitation(
                                    text=value.quote, index=1, paper_id=record.paper_id
                                )
                            ],
                        )
                        for key, value in record.values.items()
                        if key in calculation.inputs
                    },
                )
            )
        try:
            provenance = run_computed_columns(
                rows,
                [
                    ComputedColumnSpec(
                        label=calculation.label,
                        spec=calculation.spec,
                        inputs=calculation.inputs,
                    )
                ],
                paper_titles,
            )
            computed = {
                row.paper_id: row.values[calculation.label].value for row in rows
            }
            for record in payload.records:
                if record.exclusion_reason:
                    continue
                value = computed.get(record.paper_id, "N/A")
                if value == "N/A":
                    record.exclusion_reason = "The requested calculation could not be computed from the quoted inputs"
                    payload.coverage.excluded[record.paper_id] = record.exclusion_reason
                    if record.paper_id in payload.coverage.included_paper_ids:
                        payload.coverage.included_paper_ids.remove(record.paper_id)
                else:
                    # The derived value's inputs remain in values; this empty quote
                    # is intentionally distinguishable from an extracted primitive.
                    from app.schemas.chart import ChartValue

                    record.values[calculation.label] = ChartValue(
                        value=value, quote="Computed from cited inputs"
                    )
            payload.computation = provenance
        except ComputeAgentError as exc:
            payload.warnings.append(str(exc))
            for record in payload.records:
                if not record.exclusion_reason:
                    record.exclusion_reason = "The chart calculation failed; cited primitive values remain available"
                    payload.coverage.excluded[record.paper_id] = record.exclusion_reason
            payload.coverage.included_paper_ids = []
