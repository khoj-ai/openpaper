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
- Extraction is per paper, and it reads the PDF rather than the extracted
  text. One call per paper, so a large corpus can't crowd out the tail of the
  roster and one bad response can't take the whole chart down with it.

Retrieval screens; the PDF extracts. Text search decides which papers are worth
opening, which is cheap and can run over a whole library. It cannot do the
extracting, because the thing a chart most needs from a paper is its results
table, and that is exactly what text extraction destroys: a table arrives as a
caption, a column of row labels, and a separate run of numbers per column, with
no line pairing an entity to its value. Reassembling that is guesswork, and a
number under the wrong heading is worse than a missing bar. The model is given
the document instead, the same way the data table feature already does it.
"""

import hashlib
import json
import logging
import re
import unicodedata
import uuid
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from contextvars import copy_context
from typing import Any, Optional

from app.database.crud.message_crud import message_crud
from app.database.crud.paper_crud import paper_crud
from app.database.crud.projects.project_paper_crud import project_paper_crud
from app.helpers.compute_agent import ComputeAgentError, run_computed_columns
from app.helpers.s3 import s3_service
from app.llm.base import ModelType
from app.llm.conversation_operations import DataTableOperations, FieldInvestigation
from app.llm.prompts import (
    CHART_DISCOVERY_SYSTEM_PROMPT,
    CHART_EXTRACTION_SYSTEM_PROMPT,
    CHART_PLAN_SYSTEM_PROMPT,
    CHART_VERIFICATION_SYSTEM_PROMPT,
)
from app.llm.provider import FileContent, LLMProvider, TextContent
from app.llm.tools.file_tools import read_abstract, read_file, search_all_files
from app.schemas.chart import (
    ChartArtifactPayload,
    ChartCoverage,
    ChartExtraction,
    ChartExtractionRecord,
    ChartField,
    ChartPlan,
    ChartPlanCandidates,
    ChartProposal,
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

# Terms in the plan-driven sweep. Enough to cover an axis and its primitives,
# few enough that the regex stays selective.
SWEEP_MAX_TERMS = 12
# Matching lines are all the screen needs: it asks whether a paper mentions
# this measure and this kind of entity, never what the numbers are. Reading the
# numbers is the PDF's job.
SWEEP_LINES_PER_PAPER = 60
# No model reads these terms — the sweep is a regex over raw text, and a term
# that appears in every paper tells it nothing about where a measure is named.
# A plan whose y is "Score" or "Total Value" would otherwise match most lines of
# most documents and the sweep would return the paper rather than the passage.
# Only words generic enough to be noise in any field label belong here; anything
# that could name a subject must not.
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


def _slug(value: str) -> str:
    return _condense(_normalize(value))[:48]


def _required_value_fields(keys: list[str]) -> type[BaseModel]:
    """A model whose every field is a required ChartValue.

    The field names come from the plan, so they cannot be written as keyword
    arguments; create_model's overloads reserve names like `__config__` for
    itself and cannot express a caller-supplied mapping.
    """
    fields: dict[str, Any] = {key: (ChartValue, ...) for key in keys}
    return create_model("ChartPointValues", **fields)  # type: ignore[call-overload]


def _values_digest(values: dict[str, ChartValue]) -> str:
    """A stable fingerprint of one extracted point.

    Hashing the content rather than counting emissions keeps identity
    independent of the order the model happened to return records in, so the
    same evidence yields the same record ids on every run.
    """
    material = "|".join(
        f"{key}={_condense(_normalize(values[key].value))}" for key in sorted(values)
    )
    return hashlib.sha1(material.encode("utf-8")).hexdigest()[:8]


def _field_phrases(fields: list[ChartField]) -> str:
    """Search the measure as a whole phrase, not as loose words.

    Word-level alternation is what hides a narrow field: "Robust Accuracy"
    becomes robust|accuracy and matches every paper that says "accuracy", so a
    one-paper measure scores like a corpus-wide one. The phrase does not.
    """
    phrases: list[str] = []
    for field in fields:
        for text in (field.label, field.key.replace("_", " ")):
            cleaned = " ".join(text.split()).strip()
            if cleaned and cleaned.lower() not in {p.lower() for p in phrases}:
                phrases.append(cleaned)
    return "|".join(phrases)


def _field_terms(fields: list[ChartField]) -> str:
    terms: set[str] = set()
    for field in fields:
        for source in (field.label, field.key.replace("_", " ")):
            for word in _WORD_RE.findall(source):
                lowered = word.lower()
                if lowered not in SWEEP_STOPWORDS:
                    terms.add(lowered)
    return "|".join(sorted(terms)[:SWEEP_MAX_TERMS])


def _phrase_pattern(fields: list[ChartField]) -> Optional[re.Pattern]:
    """Match a field's own wording literally.

    Field labels are prose and carry regex metacharacters — "Lat. (s)",
    "Accuracy (%)" — so every phrase is escaped before it becomes a pattern.
    """
    phrases = [phrase for phrase in _field_phrases(fields).split("|") if phrase]
    if not phrases:
        return None
    return re.compile("|".join(re.escape(phrase) for phrase in phrases), re.IGNORECASE)


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
        for pattern in (_phrase_pattern([field]) for field in measures)
        if pattern
    ]
    entity_terms = _field_terms([plan.x])
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


class ChartOperations(DataTableOperations):
    """Mixin used by the unified Operations client.

    Built on the data-table mixin because chart evidence is gathered with that
    field-investigation harness, not a parallel one.
    """

    @staticmethod
    def is_chart_request(question: str) -> bool:
        text = question.lower()
        return any(
            word in text for word in ("chart", "plot", "graph", "visualize", "scatter")
        )

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
            seen = {_normalize(line) for line in existing}
            for line in found:
                if _normalize(line) not in seen:
                    existing.append(line)
                    seen.add(_normalize(line))
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
                found = hits(_field_phrases([field]))
                measure_hits = found if measure_hits is None else measure_hits & found
            measure_hits = measure_hits or set()
        else:
            measure_hits = hits(_field_phrases([plan.y]))
        return len(measure_hits & hits(_field_terms([plan.x])))

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
                seen = {_normalize(line) for line in existing}
                for line in lines:
                    if _normalize(line) not in seen:
                        existing.append(line)
                        seen.add(_normalize(line))
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
                values = {key: extracted.values[key] for key in required_keys}
                series_value = (
                    values[plan.series.key].value
                    if plan.series and plan.series.key in values
                    else ""
                )
                record = ChartRecord(
                    record_id=f"{paper_id}#{_slug(values[plan.x.key].value)}"
                    + (f"#{_slug(series_value)}" if series_value else "")
                    + f"#{_values_digest(values)}",
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
                seen_record_ids.add(record.record_id)
                included.append(record)

        included.sort(key=_point_sort_key(plan))

        payload = ChartArtifactPayload(
            plan=plan,
            records=list(included),
            coverage=ChartCoverage(),
        )
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
        group = (_slug(record.values[plan.x.key].value), _slug(series))
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
        raw = record.values[plan.x.key].value if plan.x.key in record.values else ""
        cleaned = _normalize(raw).replace(",", "")
        tail = (cleaned, record.paper_title, record.record_id)
        match = re.search(r"-?\d+(?:\.\d+)?", cleaned)
        if match:
            return (0, float(match.group()), *tail)
        return (1, 0.0, *tail)

    return key
