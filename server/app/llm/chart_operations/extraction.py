"""Turning a confirmed plan into cited points.

Retrieval screens; the PDF extracts. Text search decides which papers are worth
reading, which is cheap and can run over a whole library. It cannot do the
extracting, because the thing a chart most needs from a paper is its results
table, and that is exactly what text extraction destroys: a table arrives as a
caption, a column of row labels, and a separate run of numbers per column, with
no line pairing an entity to its value. Reassembling that is guesswork, and a
number under the wrong heading is worse than a missing bar. The model is given
the document instead, the same way the data table feature already does it.

Extraction is per paper: one call each, so a large corpus cannot crowd out the
tail of the roster and one bad response cannot take the whole chart down with
it.

The model may quote primitives and it may propose arithmetic, but it never
performs any. A paper reporting in a unit the plan does not use comes back with
the lambda that would move it, and that lambda runs in the sandbox with every
other one, in a single pass, before any derived y is computed. Both the
conversions and the calculation leave their provenance in the payload.
"""

import json
import logging
import re
import uuid
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from contextvars import copy_context
from typing import Any, Optional

from app.database.crud.paper_crud import paper_crud
from app.database.crud.projects.project_paper_crud import project_paper_crud
from app.helpers.compute_agent import (
    ComputeAgentError,
    format_number,
    run_computed_columns,
)
from app.helpers.s3 import s3_service
from app.helpers.unit_conversion import (
    ConversionError,
    ConversionRequest,
    is_identity,
    run_unit_conversions,
    shape_error,
)
from app.llm.base import ModelType
from app.llm.chart_operations.quantities import normalize_unit, parse_quantity
from app.llm.chart_operations.text import (
    field_terms,
    normalize,
    phrase_pattern,
    slug,
    values_digest,
)
from app.llm.conversation_operations import DataTableOperations
from app.llm.prompts import CHART_EXTRACTION_SYSTEM_PROMPT
from app.llm.provider import FileContent, LLMProvider, TextContent
from app.schemas.chart import (
    ChartArtifactPayload,
    ChartCoverage,
    ChartExtraction,
    ChartExtractionRecord,
    ChartField,
    ChartPlan,
    ChartQuotedValue,
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
from pydantic import BaseModel, Field, create_model
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# Every paper the screen passes is read end to end, so this is what decides how
# long a chart takes. The work is a download and a model call — waiting, not
# computing — so the pool is wider than a CPU-bound one would be.
EXTRACTION_WORKERS = 12


def _required_value_fields(keys: list[str]) -> type[BaseModel]:
    """A model whose every field is a required quoted value.

    Built on ChartQuotedValue, not ChartValue: the request schema must not
    contain the parsed number, or the model is being invited to compute one.

    The field names come from the plan, so they cannot be written as keyword
    arguments; create_model's overloads reserve names like `__config__` for
    itself and cannot express a caller-supplied mapping.
    """
    fields: dict[str, Any] = {key: (ChartQuotedValue, ...) for key in keys}
    return create_model("ChartPointValues", **fields)  # type: ignore[call-overload]


def _plan_screen(plan: ChartPlan):
    """How strongly one paper's gathered text answers this plan, or zero.

    Reading a paper end to end is the expensive step — the file is sent whole
    and every page is billed — so this decides which papers are worth reading.
    It is deliberately shallow: text search is good at "does this paper talk
    about this measure and this kind of entity" and bad at reading a number out
    of a table, so it is asked only the first question. Zero means the paper
    never mentions one of them, which is the one thing retrieval can settle on
    its own.
    """
    measures = (
        [field for field in plan.fields if field.key in set(plan.calculation.inputs)]
        or [plan.y]
        if plan.calculation
        else [plan.y]
    )
    # A derived y needs every primitive in the SAME paper, so each is required
    # separately rather than as one alternation.
    measure_patterns = [
        pattern
        for pattern in (phrase_pattern([field]) for field in measures)
        if pattern
    ]
    entity_terms = field_terms([plan.x])
    entity_pattern = re.compile(entity_terms, re.IGNORECASE) if entity_terms else None

    def score(lines: list[str]) -> int:
        text = "\n".join(lines)
        if entity_pattern and not entity_pattern.search(text):
            return 0
        hits = 0
        for pattern in measure_patterns:
            found = len(pattern.findall(text))
            if not found:
                return 0
            hits += found
        return hits or 1

    return score


def _paper_pdf(
    paper_id: str,
    current_user: CurrentUser,
    db: Session,
    project_id: Optional[str],
) -> Optional[tuple[bytes, str]]:
    """The stored PDF for a paper, or None when it has no indexed file.

    A paper in a project with no object key is an indexing failure, not a
    paper without data, so callers report it rather than quietly falling back
    to its extracted text — the fallback is what produced wrong numbers.
    """
    paper = (
        project_paper_crud.get_paper_by_project(
            db,
            paper_id=uuid.UUID(paper_id),
            project_id=uuid.UUID(project_id),
            user=current_user,
        )
        if project_id
        else paper_crud.get(db, id=paper_id, user=current_user)
    )
    if not paper or not paper.s3_object_key:
        return None
    data = s3_service.download_bytes(str(paper.s3_object_key))
    if not data:
        return None
    return data, f"{str(paper.title) if paper.title else 'paper'}.pdf"


def _read_quantity(quoted: ChartQuotedValue) -> ChartValue:
    """A quoted value with the number the paper printed read out of it.

    Only the number. Which unit it belongs in is the plan's decision and
    getting it there is the extractor's lambda, run later in the sandbox — so
    at this point the value is still in whatever the paper used.
    """
    parsed = parse_quantity(quoted.value)
    return ChartValue(
        **quoted.model_dump(exclude={"unit"}),
        unit=normalize_unit(quoted.unit) or parsed.unit,
        number=parsed.number,
    )


def _fields_by_key(plan: ChartPlan) -> dict[str, ChartField]:
    """Every field the plan names, however it names it."""
    return {
        field.key: field
        for field in [
            plan.x,
            plan.y,
            *([plan.series] if plan.series else []),
            *plan.fields,
        ]
    }


def _convert_to_plan_units(
    payload: ChartArtifactPayload,
) -> Optional[dict[str, Any]]:
    """Put every extracted number into the unit its field declares.

    The plan names a unit per field and the extractor, reading one paper with
    that plan in hand, proposes the arithmetic that gets that paper's number
    there. Applying it is this function's job, and it happens in one sandbox
    run for the whole chart: the conversions are model-authored code and the
    server does not execute those.

    Most charts do no work here. A paper reporting in the plan's unit gets
    `lambda v: v`, which is recognised and skipped, so the sandbox is only
    reached when a corpus genuinely disagrees with itself.

    A conversion the extractor withheld is a refusal — this number cannot be
    expressed in the plan's unit without changing what it measures — and the
    point leaves the chart carrying the reason it was given. A conversion that
    is malformed, or that fails in the sandbox, costs its own point too: the
    alternative is plotting milliseconds on an axis of seconds.
    """
    labels = _fields_by_key(payload.plan)

    def target(key: str) -> str:
        field = labels.get(key)
        return normalize_unit(field.unit if field else "") or "the chart's unit"

    convertible: list[ConversionRequest] = []
    # A record can hold several values, so the point alone does not identify
    # the number being converted; the field key has to ride along with it.
    addressed: dict[str, tuple[ChartRecord, str]] = {}

    for record in payload.records:
        if record.exclusion_reason:
            continue
        pending: list[tuple[ConversionRequest, str]] = []
        for key, cell in record.values.items():
            if cell.number is None or is_identity(cell.conversion):
                # A stored conversion means this number moved, which is what
                # tells a reader why the value beside the quote is not the
                # number on the bar. Identity moves nothing, so it is cleared
                # rather than left to be re-interpreted at each surface.
                cell.conversion = ""
                continue
            problem = shape_error(cell.conversion)
            if problem:
                # Withholding the conversion is how the extractor says this
                # number does not belong on this axis, so its note is the
                # reader's explanation. A conversion that is merely malformed
                # gets a generic one and a line in the log.
                record.exclusion_reason = cell.conversion_note or (
                    f"Reported {labels[key].label if key in labels else key} in "
                    f"{cell.unit or 'a unit it did not name'}, which could not "
                    f"be expressed in {target(key)}"
                )
                if not cell.conversion_note:
                    logger.warning(
                        "Discarding conversion %r for %s: %s",
                        cell.conversion,
                        record.record_id,
                        problem,
                    )
                break
            pending.append(
                (
                    ConversionRequest(
                        key=f"{record.record_id}::{key}",
                        number=cell.number,
                        conversion=cell.conversion,
                    ),
                    key,
                )
            )
        if record.exclusion_reason:
            continue
        for request, key in pending:
            addressed[request.key] = (record, key)
            convertible.append(request)

    if not convertible:
        return None

    try:
        results, provenance = run_unit_conversions(convertible)
    except ConversionError as exc:
        payload.warnings.append(
            f"{len(convertible)} value{'s' if len(convertible) != 1 else ''} "
            f"needed converting onto the chart's units and could not be: {exc}"
        )
        for record, _ in addressed.values():
            if not record.exclusion_reason:
                record.exclusion_reason = (
                    "This paper reported in a different unit, and the "
                    "conversion could not be run"
                )
        return None

    moved = Counter()
    for address, (record, key) in addressed.items():
        cell = record.values[key]
        result = results.get(address)
        if result is None or result.number is None:
            if not record.exclusion_reason:
                record.exclusion_reason = (
                    f"Reported {labels[key].label if key in labels else key} in "
                    f"{cell.unit or 'a unit it did not name'}, and converting "
                    f"it to {target(key)} failed"
                )
            logger.warning(
                "Conversion failed for %s: %s",
                address,
                result.error if result else "no result returned",
            )
            continue
        # `value` is left as the paper printed it, so the quote still matches
        # the number's origin rather than its destination.
        cell.number = result.number
        moved[(cell.unit or "an unnamed unit", target(key))] += 1

    for (unit, into), count in sorted(moved.items()):
        payload.warnings.append(
            f"{count} value{'s' if count != 1 else ''} converted from {unit} to {into}"
        )
    return provenance


def _papers_collide_on_x(records: list[ChartRecord], plan: ChartPlan) -> bool:
    """Does the study distinguish points that x alone cannot?

    A literature chart's commonest shape is several papers reporting the same
    measure for the same entity. Nothing quoted from the text separates those
    points — the paper does — so the encoding is decided here from the records
    rather than guessed by the planner. When every x belongs to one paper the
    study adds a legend that disambiguates nothing, so it stays off.
    """
    seen: dict[tuple[str, str], str] = {}
    for record in records:
        if record.exclusion_reason or plan.x.key not in record.values:
            continue
        series = (
            record.values[plan.series.key].value
            if plan.series and plan.series.key in record.values
            else ""
        )
        group = (slug(record.values[plan.x.key].value), slug(series))
        owner = seen.setdefault(group, record.paper_id)
        if owner != record.paper_id:
            return True
    return False


def _point_sort_key(plan: ChartPlan):
    """Order points by x so a chart is a function of its evidence.

    Model emission order is arbitrary, so two runs finding identical points
    would still draw them in different positions. Numeric x sorts ascending
    (which line charts need regardless); everything else sorts by label. Points
    sharing an x then sort by paper, which keeps a study's points together
    instead of interleaving them by roster position.
    """

    def key(record: ChartRecord):
        cell = record.values.get(plan.x.key)
        cleaned = normalize(cell.value) if cell else ""
        tail = (cleaned, record.paper_title, record.record_id)
        # The same parsed number the renderer plots, so the order a chart is
        # stored in and the positions it is drawn at cannot disagree.
        if cell and cell.number is not None:
            return (0, cell.number, *tail)
        return (1, 0.0, *tail)

    return key


class ChartExtracting(DataTableOperations):
    """Reading the confirmed plan's values out of the selected papers."""

    def build_chart_artifact(
        self,
        *,
        prompt: str,
        plan: ChartPlan,
        evidence: dict[str, list[str]],
        papers: list[tuple[str, str]],
        current_user: CurrentUser,
        db: Session,
        project_id: Optional[str] = None,
    ) -> Optional[ChartArtifactPayload]:
        paper_ids = [paper_id for paper_id, _ in papers]
        paper_titles = dict(papers)
        required_keys = sorted(
            {plan.x.key}
            | ({plan.series.key} if plan.series else set())
            | set(plan.calculation.inputs if plan.calculation else [plan.y.key])
        )
        # A generic Dict[str, ChartValue] lets Gemini emit `{}`. Build the
        # structured-output schema from the confirmed plan so each required
        # source-backed field is an explicit required JSON property. Responses
        # are read back as ChartExtraction, whose values stay a plain mapping.
        point_values_model = _required_value_fields(required_keys)
        # Named in the system prompt as well as the dumped plan: the target
        # unit is what every conversion has to land on, so it is stated where
        # the required keys are rather than left to be looked up.
        labels = _fields_by_key(plan)
        plan_units = {key: normalize_unit(field.unit) for key, field in labels.items()}
        target_units = [
            (
                f"{key} in {plan_units[key]}"
                if plan_units.get(key)
                else f"{key} has no unit"
            )
            for key in required_keys
        ]
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

        # The screen: retrieval says which papers are worth opening, ranked by
        # how much they say about this plan's measure. Everything it rejects
        # never reaches a model, which is what makes reading whole PDFs
        # affordable over a library of hundreds.
        score = _plan_screen(plan)
        scored = [
            (points, paper_id)
            for paper_id in paper_ids
            if (points := score(evidence.get(paper_id) or []))
        ]
        # Every paper it passes is read. A ceiling here would decide coverage
        # by rank in a list whose scores are mostly ties, so which papers made
        # the chart would come down to roster position — the arbitrariness this
        # module exists to remove. The screen is the filter; it either says a
        # paper mentions this measure or it does not.
        scored.sort(key=lambda entry: (-entry[0], paper_ids.index(entry[1])))
        shortlisted = [paper_id for _, paper_id in scored]

        # A shortlisted paper with no stored PDF is an indexing failure. Falling
        # back to its extracted text is what put wrong numbers on charts, so it
        # is reported instead.
        documents: dict[str, tuple[bytes, str]] = {}
        unindexed: list[str] = []
        for paper_id in shortlisted:
            try:
                document = _paper_pdf(paper_id, current_user, db, project_id)
            except Exception:
                logger.warning(
                    "Could not load the PDF for paper %s", paper_id, exc_info=True
                )
                document = None
            if document is None:
                unindexed.append(paper_id)
            else:
                documents[paper_id] = document
        targets = [paper_id for paper_id in shortlisted if paper_id in documents]

        included: list[ChartRecord] = []
        seen_record_ids: set[str] = set()
        papers_attempted: set[str] = set()

        def extract(paper_id: str) -> list[ChartExtractionRecord]:
            data, filename = documents[paper_id]
            response = self.generate_content(
                contents=[
                    FileContent(
                        data=data, mime_type="application/pdf", filename=filename
                    ),
                    TextContent(
                        text=(
                            f"User request:\n{prompt}\n\nChart plan:\n{plan.model_dump_json()}"
                            f"\n\nPaper:\n{json.dumps({'paper_id': paper_id, 'paper_title': paper_titles[paper_id]})}"
                        )
                    ),
                ],
                system_prompt=(
                    f"{CHART_EXTRACTION_SYSTEM_PROMPT}\n\nFor this run, every returned record's values "
                    f"MUST include these exact keys: {', '.join(required_keys)}. "
                    f"Each one's `conversion` must land on the unit this plan gives it — "
                    f"{'; '.join(target_units)}. "
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
                parsed = ChartExtraction.model_validate_json(response.text)
            except Exception:
                logger.exception("Failed to parse chart extraction for %s", paper_id)
                return []
            # The request schema already demands these keys; a record that came
            # back short is one point lost, not the paper's whole response.
            return [
                record
                for record in parsed.records
                if all(key in record.values for key in required_keys)
            ]

        results: dict[str, list[ChartExtractionRecord]] = {}
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
            for extracted in results.get(paper_id, []):
                # A record attributed to another paper is not evidence about
                # this one; the per-paper call has no business emitting it.
                if extracted.paper_id != paper_id:
                    continue
                values = {
                    key: _read_quantity(extracted.values[key]) for key in required_keys
                }
                series_value = (
                    values[plan.series.key].value
                    if plan.series and plan.series.key in values
                    else ""
                )
                record = ChartRecord(
                    record_id=f"{paper_id}#{slug(values[plan.x.key].value)}"
                    + (f"#{slug(series_value)}" if series_value else "")
                    + f"#{values_digest(values)}",
                    paper_id=paper_id,
                    paper_title=paper_titles[paper_id],
                    values=values,
                )
                # Identity is the whole extracted point, not its x label. One
                # paper reporting two different values at the same x — two
                # subgroups, two cohorts — contributes two points; only a point
                # the model emitted twice is a duplicate.
                if record.record_id in seen_record_ids:
                    continue
                # A y that parsed to nothing is not a bar. Saying so here puts
                # it in the not-charted list with its own quoted text, which is
                # what lets a reader see that the paper reported "p < 0.001"
                # rather than wonder why it is missing.
                if not plan.calculation and values[plan.y.key].number is None:
                    record.exclusion_reason = (
                        f"Reported {plan.y.label} as "
                        f'"{values[plan.y.key].value}", which states no plottable value'
                    )
                seen_record_ids.add(record.record_id)
                included.append(record)

        included.sort(key=_point_sort_key(plan))

        payload = ChartArtifactPayload(
            plan=plan,
            records=list(included),
            coverage=ChartCoverage(),
        )
        # Before the calculation, not after: a derivation over primitives that
        # are still in each paper's own units is arithmetic over incomparable
        # numbers, and no spec can rescue that.
        payload.conversions = _convert_to_plan_units(payload)
        if plan.calculation:
            self._compute_derived_y(payload)
        payload.series_by_paper = _papers_collide_on_x(payload.records, plan)

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
            if paper_id in papers_attempted:
                excluded[paper_id] = (
                    f"We read this paper and found no directly quoted {plan.y.label}"
                )
            elif paper_id in unindexed:
                excluded[paper_id] = (
                    "This paper matched the search but has no indexed PDF to read"
                )
            else:
                excluded[paper_id] = (
                    f"We searched this paper and it does not mention {plan.y.label}"
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

        plotted = Counter(
            record.paper_id for record in payload.records if not record.exclusion_reason
        )
        payload.extraction_steps = [
            f"Screened {len(paper_ids)} paper{'s' if len(paper_ids) != 1 else ''}; "
            f"{len(scored)} mention{'s' if len(scored) == 1 else ''} both "
            f"{plan.y.label} and {plan.x.label}",
            f"Read {len(targets)} PDF{'s' if len(targets) != 1 else ''} in full, "
            "one call each",
            *(
                f'"{paper_titles[paper_id]}" — {plotted[paper_id]} point'
                f"{'s' if plotted[paper_id] != 1 else ''}"
                for paper_id in paper_ids
                if plotted.get(paper_id)
            ),
        ]
        if unindexed:
            payload.extraction_steps.append(
                f"{len(unindexed)} matching paper{'s' if len(unindexed) != 1 else ''} "
                "had no indexed PDF and could not be read"
            )
        silent = len(targets) - len(plotted)
        if silent > 0:
            payload.extraction_steps.append(
                f"{silent} paper{'s' if silent != 1 else ''} we read reported no usable value"
            )
        return payload

    @staticmethod
    def _compute_derived_y(payload: ChartArtifactPayload) -> None:
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
                        # The converted number, not the paper's own text: the
                        # inputs have been put on the plan's units and the
                        # script must compute over those, not re-read a string
                        # that still says milliseconds.
                        key: DataTableCellValue(
                            value=(
                                format_number(value.number)
                                if value.number is not None
                                else value.value
                            ),
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
                    parsed = parse_quantity(value)
                    record.values[calculation.label] = ChartValue(
                        value=value,
                        quote="Computed from cited inputs",
                        # A derivation over inputs already on the plan's units
                        # lands on the plan's unit; nothing further to convert.
                        unit=normalize_unit(payload.plan.y.unit) or parsed.unit,
                        number=parsed.number,
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
