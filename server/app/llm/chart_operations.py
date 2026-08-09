"""Chart planning and extraction for chat and project artifacts.

The model is allowed to select fields and quote primitives, never to perform
arithmetic.  Derived y values are delegated to the existing sandboxed compute
agent, whose full provenance becomes part of the artifact payload.

Two properties matter as much as grounding, because a chart that quietly
changes between identical requests is not trustworthy even when every bar is
cited:

- Coverage is obligatory, not emergent. The investigator agent searches
  wherever its terms lead it; on top of that, every selected paper gets a
  plan-driven sweep, so a paper's absence means "we looked and it isn't
  there", never "the agent didn't happen to search here".
- Extraction is per paper. One call per paper over that paper's own bounded
  evidence, so a large corpus can't crowd out the tail of the roster and one
  bad response can't take the whole chart down with it.
"""

import json
import logging
import re
import unicodedata
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from contextvars import copy_context
from typing import Optional

from app.helpers.compute_agent import ComputeAgentError, run_computed_columns
from app.llm.base import ModelType
from app.llm.conversation_operations import FieldInvestigation
from app.llm.provider import LLMProvider, TextContent
from app.llm.tools.file_tools import read_abstract, search_file
from app.schemas.chart import (
    ChartArtifactPayload,
    ChartCoverage,
    ChartField,
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


# Per-paper evidence handed to one extraction call. The same capped list backs
# the prompt and the grounding check, so the extractor is never rejected for
# quoting a passage it was actually shown.
EVIDENCE_LINES_PER_PAPER = 80
EVIDENCE_CHARS_PER_PAPER = 20_000
EXTRACTION_WORKERS = 5

# Terms in the plan-driven sweep. Enough to cover an axis and its primitives,
# few enough that the regex stays selective.
SWEEP_MAX_TERMS = 12
SWEEP_LINES_PER_PAPER = 40
SWEEP_STOPWORDS = frozenset(
    {
        "the",
        "and",
        "for",
        "with",
        "per",
        "each",
        "all",
        "any",
        "from",
        "into",
        "value",
        "values",
        "number",
        "count",
        "total",
        "amount",
        "level",
        "score",
        "rate",
        "size",
        "name",
        "type",
        "kind",
        "label",
        "field",
        "data",
        "point",
        "points",
        "paper",
        "papers",
        "study",
        "studies",
        "chart",
        "plot",
        "graph",
        "axis",
        "reported",
        "average",
        "mean",
    }
)


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
You extract the cited primitive values required by a chart plan from one
paper's collected evidence. Return only the JSON ChartExtraction schema.

Rules:
- Copy values only when directly supported by the supplied evidence.
- Every value MUST include an exact quote from that evidence; use the source
  line number when available.
- Do not calculate values. For a derived y, return only its primitive inputs;
  the application calculates the derived value later.
- Return a record ONLY when it contains every field needed to plot a point.
- The evidence below is from ONE paper. Use its paper_id on every record.
- That paper may produce multiple records when it reports multiple named
  benchmarks/datasets/models; each record must pair its values to that same
  entity. Return an empty records array when the paper does not report the
  required fields — a missing paper is a fine outcome, an invented one is not.
- Do not return exclusion records or coverage; the application creates those
  deterministically.
""".strip()


_LINE_PREFIX_RE = re.compile(r"^\s*\d+:\s?")
_VIEW_HEADER_RE = re.compile(r"^File content from lines \d+ to \d+:\s*$")
_NON_ALNUM_RE = re.compile(r"[^0-9a-z]+")
_WORD_RE = re.compile(r"[A-Za-z]{3,}")
_NUMERIC_RE = re.compile(r"\d")
# Retrieval, PDF extraction and the model all disagree about typography. Fold
# the variants that carry no meaning before comparing text.
_TYPOGRAPHY = str.maketrans(
    {
        "‘": "'",
        "’": "'",
        "‚": "'",
        "‛": "'",
        "“": '"',
        "”": '"',
        "„": '"',
        "‐": "-",
        "‑": "-",
        "‒": "-",
        "–": "-",
        "—": "-",
        "―": "-",
        "−": "-",
        " ": " ",
        " ": " ",
        " ": " ",
        "​": "",
    }
)


def _normalize(text: str) -> str:
    folded = unicodedata.normalize("NFKC", str(text)).translate(_TYPOGRAPHY)
    return re.sub(r"\s+", " ", folded).strip().casefold()


def _condense(text: str) -> str:
    """Drop everything but letters and digits."""
    return _NON_ALNUM_RE.sub("", text)


def _cap_evidence(lines: list[str]) -> list[str]:
    """Bound one paper's evidence for a single extraction call.

    Lines carrying digits come first because chart primitives are numbers, but
    original order is preserved within that preference so the same evidence
    always yields the same prompt.
    """
    ordered = [str(line) for line in lines]
    preference = sorted(
        range(len(ordered)),
        key=lambda index: (0 if _NUMERIC_RE.search(ordered[index]) else 1, index),
    )
    kept: list[tuple[int, str]] = []
    budget = EVIDENCE_CHARS_PER_PAPER
    for index in preference:
        if len(kept) >= EVIDENCE_LINES_PER_PAPER or budget <= 0:
            break
        clipped = ordered[index][:budget]
        kept.append((index, clipped))
        budget -= len(clipped)
    # Restore retrieval order so the extractor reads passages as they appear.
    return [line for _, line in sorted(kept)]


def _evidence_source(lines: list[str]) -> tuple[str, str]:
    """Flatten retrieved passages into one haystack for grounding checks.

    Retrieval returns `"<lineno>: <text>"` fragments and `view_file` prepends a
    header; a quote that crossed a line break in the PDF has to ground against
    the running text, so prefixes are stripped, end-of-line hyphenation is
    repaired, and fragments are joined. Returns the normalized text and its
    letters-and-digits-only condensation.
    """
    pieces: list[str] = []
    for raw in lines:
        for line in str(raw).splitlines():
            if _VIEW_HEADER_RE.match(line):
                continue
            stripped = _LINE_PREFIX_RE.sub("", line).strip()
            if stripped:
                pieces.append(stripped)
    joined = ""
    for piece in pieces:
        if not joined:
            joined = piece
        elif joined.endswith("-"):
            joined = joined[:-1] + piece
        else:
            joined = f"{joined} {piece}"
    normalized = _normalize(joined)
    return normalized, _condense(normalized)


def _is_grounded(quote: str, source: str, condensed_source: str) -> bool:
    """Is this quote actually present in what we retrieved?

    Two passes. The first compares normalized running text. The second ignores
    spacing and punctuation entirely, because column breaks and hyphenation
    disagree far more often than the extractor invents text — and removing
    punctuation cannot turn a paraphrase into a match.
    """
    normalized = _normalize(quote)
    condensed = _condense(normalized)
    if len(condensed) < 4:
        return False
    if normalized in source:
        return True
    return condensed in condensed_source


def _slug(value: str) -> str:
    return _condense(_normalize(value))[:48]


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
    terms: set[str] = set()
    for source in [field.label for field in fields] + [
        key.replace("_", " ") for key in keys
    ]:
        for word in _WORD_RE.findall(source):
            lowered = word.lower()
            if lowered not in SWEEP_STOPWORDS:
                terms.add(lowered)
    if not terms:
        return ""
    return "|".join(sorted(terms)[:SWEEP_MAX_TERMS])


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

    @staticmethod
    def sweep_plan_evidence(
        *,
        plan: ChartPlan,
        papers: list[tuple[str, str]],
        evidence: dict[str, list[str]],
        current_user: CurrentUser,
        db: Session,
        project_id: str,
    ) -> dict[str, list[str]]:
        """Give every selected paper a floor of plan-relevant evidence.

        The investigator agent decides where to look, which means coverage is
        whatever its search terms happened to reach — the reason two identical
        requests can chart different papers. This sweep is deterministic: the
        same plan searches the same terms in every paper, every run. It merges
        into the agent's findings rather than replacing them, and it costs no
        LLM calls.
        """
        query = _sweep_query(plan)
        if not query:
            return evidence
        paper_ids = [paper_id for paper_id, _ in papers]
        for paper_id in paper_ids:
            found: list[str] = []
            try:
                found = [
                    str(line)
                    for line in search_file(
                        paper_id=paper_id,
                        query=query,
                        current_user=current_user,
                        db=db,
                        project_id=project_id,
                        restrict_to_paper_ids=paper_ids,
                    )
                ][:SWEEP_LINES_PER_PAPER]
            except Exception:
                logger.warning(
                    "Chart sweep could not search paper %s", paper_id, exc_info=True
                )
            if not found and not evidence.get(paper_id):
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
                except Exception:
                    logger.warning(
                        "Chart sweep could not read abstract for paper %s",
                        paper_id,
                        exc_info=True,
                    )
            if not found:
                continue
            existing = evidence.setdefault(paper_id, [])
            seen = {_normalize(line) for line in existing}
            for line in found:
                if _normalize(line) not in seen:
                    existing.append(line)
                    seen.add(_normalize(line))
        return evidence

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
            system_prompt=CHART_INVESTIGATION_PROMPT,
            user_message=(
                f"User chart request:\n{prompt}\n\nSelected papers:\n{roster}{plan_text}\n\n"
                "Investigate with the available tools, then report your findings."
            ),
        )
        if plan:
            investigation.evidence = self.sweep_plan_evidence(
                plan=plan,
                papers=papers,
                evidence=investigation.evidence,
                current_user=current_user,
                db=db,
                project_id=project_id,
            )
            investigation.trace.setdefault("status_messages", []).append(
                f"Swept all {len(papers)} paper{'s' if len(papers) != 1 else ''} for the confirmed chart fields"
            )
        return investigation

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
        extraction_schema = extraction_model.model_json_schema()
        field_labels = {field.key: field.label for field in plan.fields}
        field_labels.setdefault(plan.x.key, plan.x.label)
        field_labels.setdefault(plan.y.key, plan.y.label)

        capped = {
            paper_id: _cap_evidence(evidence.get(paper_id) or [])
            for paper_id in paper_ids
        }
        targets = [paper_id for paper_id in paper_ids if capped[paper_id]]

        included: list[ChartRecord] = []
        excluded_records: list[ChartRecord] = []
        seen_record_ids: set[str] = set()
        papers_attempted: set[str] = set()

        def extract(paper_id: str) -> list:
            response = self.generate_content(
                contents=[
                    TextContent(
                        text=(
                            f"User request:\n{prompt}\n\nChart plan:\n{plan.model_dump_json()}"
                            f"\n\nPaper:\n{json.dumps({'paper_id': paper_id, 'paper_title': paper_titles[paper_id]})}"
                            f"\n\nCollected evidence for this paper:\n{json.dumps(capped[paper_id])}"
                        )
                    )
                ],
                system_prompt=(
                    f"{EXTRACTION_PROMPT}\n\nFor this run, every returned record's values "
                    f"MUST include these exact keys: {', '.join(required_keys)}. "
                    f"Every record's paper_id MUST be exactly {paper_id}. "
                    "Return an empty records array if this paper does not report all of "
                    "them; never return an empty values object."
                ),
                model_type=ModelType.FAST,
                schema=extraction_schema,
                provider=LLMProvider.GEMINI,
            )
            if not response or not response.text:
                return []
            try:
                return list(extraction_model.model_validate_json(response.text).records)
            except Exception:
                logger.exception("Failed to parse chart extraction for %s", paper_id)
                return []

        results: dict[str, list] = {}
        if targets:
            # A fresh context copy per task: it carries the request's langfuse
            # span into the worker thread, and copies can't be entered twice
            # concurrently the way one shared context could.
            contexts = [copy_context() for _ in targets]
            with ThreadPoolExecutor(
                max_workers=min(EXTRACTION_WORKERS, len(targets))
            ) as pool:
                futures = [
                    pool.submit(context.run, extract, paper_id)
                    for context, paper_id in zip(contexts, targets)
                ]
                for paper_id, future in zip(targets, futures):
                    try:
                        results[paper_id] = future.result()
                    except Exception:
                        # One paper's extraction failing costs one paper, not
                        # the chart; it is reported as an excluded paper below.
                        logger.exception("Chart extraction failed for %s", paper_id)
                        results[paper_id] = []

        for paper_id in targets:
            papers_attempted.add(paper_id)
            source, condensed_source = _evidence_source(capped[paper_id])
            for extracted in results.get(paper_id, []):
                # A record attributed to another paper is not evidence about
                # this one; the per-paper call has no business emitting it.
                if extracted.paper_id != paper_id:
                    continue
                values = {key: getattr(extracted.values, key) for key in required_keys}
                record = ChartRecord(
                    record_id=f"{paper_id}#{_slug(values[plan.x.key].value)}",
                    paper_id=paper_id,
                    paper_title=paper_titles[paper_id],
                    values=values,
                )
                if record.record_id in seen_record_ids:
                    continue
                seen_record_ids.add(record.record_id)
                ungrounded = [
                    key
                    for key, value in values.items()
                    if not _is_grounded(value.quote, source, condensed_source)
                ]
                if ungrounded:
                    labels = ", ".join(
                        field_labels.get(key, key) for key in sorted(ungrounded)
                    )
                    record.exclusion_reason = (
                        f"No directly quoted value for {labels} in this paper"
                    )
                    excluded_records.append(record)
                else:
                    included.append(record)

        included.sort(key=_point_sort_key(plan))

        payload = ChartArtifactPayload(
            plan=plan,
            records=included + excluded_records,
            coverage=ChartCoverage(),
        )
        if plan.calculation:
            self._compute_derived_y(payload, paper_titles)

        included_paper_ids = list(
            dict.fromkeys(
                record.paper_id
                for record in payload.records
                if not record.exclusion_reason
            )
        )
        excluded: dict[str, str] = {}
        for paper_id, title in papers:
            if paper_id in included_paper_ids:
                continue
            failed = [
                record.exclusion_reason
                for record in payload.records
                if record.paper_id == paper_id and record.exclusion_reason
            ]
            if failed:
                excluded[paper_id] = failed[0] or ""
                continue
            excluded[paper_id] = (
                "We searched this paper and found no directly quoted " f"{plan.y.label}"
                if paper_id in papers_attempted
                else "No passages for these fields could be retrieved from this paper"
            )
            payload.records.append(
                ChartRecord(
                    record_id=paper_id,
                    paper_id=paper_id,
                    paper_title=title,
                    exclusion_reason=excluded[paper_id],
                )
            )
        payload.coverage = ChartCoverage(
            searched_paper_ids=paper_ids,
            included_paper_ids=included_paper_ids,
            excluded=excluded,
        )
        return payload

    @staticmethod
    def _compute_derived_y(
        payload: ChartArtifactPayload, paper_titles: dict[str, str]
    ) -> None:
        calculation = payload.plan.calculation
        if not calculation:
            return
        # The compute agent keys its output by row id, so rows must be one per
        # chart point. Keying by paper_id would collapse every benchmark a
        # paper reports onto whichever one the script emitted last.
        rows = []
        row_titles: dict[str, str] = {}
        for record in payload.records:
            if record.exclusion_reason:
                continue
            row_titles[record.record_id] = record.paper_title
            rows.append(
                DataTableRow(
                    paper_id=record.record_id,
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
        if not rows:
            return
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
                row_titles,
            )
            computed = {
                row.paper_id: cell.value
                for row in rows
                if (cell := row.values.get(calculation.label)) is not None
            }
            for record in payload.records:
                if record.exclusion_reason:
                    continue
                value = computed.get(record.record_id, "N/A")
                if value == "N/A":
                    record.exclusion_reason = "The requested calculation could not be computed from the quoted inputs"
                else:
                    # The derived value's inputs remain in values; this empty quote
                    # is intentionally distinguishable from an extracted primitive.
                    record.values[calculation.label] = ChartValue(
                        value=value, quote="Computed from cited inputs"
                    )
            payload.computation = provenance
            # An imputed or dropped input is exactly what a reader needs to see
            # next to the bar it produced.
            payload.warnings.extend(str(w) for w in provenance.get("warnings") or [])
        except ComputeAgentError as exc:
            payload.warnings.append(str(exc))
            for record in payload.records:
                if not record.exclusion_reason:
                    record.exclusion_reason = "The chart calculation failed; cited primitive values remain available"


def _point_sort_key(plan: ChartPlan):
    """Order points by x so a chart is a function of its evidence.

    Model emission order is arbitrary, so two runs finding identical points
    would still draw them in different positions. Numeric x sorts ascending
    (which line charts need regardless); everything else sorts by label.
    """

    def key(record: ChartRecord):
        raw = record.values[plan.x.key].value if plan.x.key in record.values else ""
        cleaned = _normalize(raw).replace(",", "")
        match = re.search(r"-?\d+(?:\.\d+)?", cleaned)
        if match:
            return (0, float(match.group()), cleaned, record.record_id)
        return (1, 0.0, cleaned, record.record_id)

    return key
