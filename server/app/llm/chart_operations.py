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

import hashlib
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
from app.llm.tools.file_tools import read_abstract, search_all_files, search_file
from app.schemas.chart import (
    ChartArtifactPayload,
    ChartCoverage,
    ChartField,
    ChartPlan,
    ChartPlanCandidates,
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


# One extraction call carries one paper, so its evidence goes to the model
# whole. Routinely trimming it did more harm than good: an 80-line cap was
# silently dropping the very odds ratios a chart was asked for, because they
# happened to appear late in the paper.
#
# This mirrors the chat's threshold-gated compaction
# (CONTENT_LIMIT_EVIDENCE_GATHERING) with one deliberate difference. Chat
# compacts by summarizing, which would be fatal here: a rewritten passage no
# longer contains the quote the extractor cites, so grounding would reject its
# own evidence, and a mangled number would still render a chart. When this
# does engage it SELECTS whole retrieved lines and never rewrites one.
EVIDENCE_COMPACTION_THRESHOLD_CHARS = 150_000
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
You propose candidate charts over a body of literature. Return only the JSON
ChartPlanCandidates schema: 2 to 4 distinct candidate plans, best first.

Rank candidates by BREADTH — how much of the corpus reports that measure —
but only among candidates that genuinely answer the request. Breadth breaks
ties; it never picks the question. A chart drawn from a single paper is a fine
outcome when that is where the evidence is.

- EVERY candidate must answer the request that was actually made. Breadth is
  about how a measure is PHRASED, never about what is being measured.
  - Phrasing qualifiers narrow a measure to one paper's vocabulary and should
    be stripped: "Robust Accuracy" -> "Accuracy", "Adjusted odds ratio (aOR)"
    -> "Odds ratio".
  - Subject qualifiers say what is being measured — the outcome, population,
    condition, or cohort the user named. NEVER strip or swap these. If the user
    asked about autism, every candidate is about autism; a better-covered
    chart about ADHD is a different question and is not an option.
  If the corpus barely reports the subject the user asked about, still propose
  it. A chart that comes back thin is a true answer; a well-covered chart about
  something else is a false one.
- Make the candidates genuinely different — a broad measure, a narrower one, a
  different pairing entirely — so the widest-covered one can be chosen.
- Use bar, line, or scatter. x is usually the named entity a value belongs to
  (model, benchmark, dataset, arm, condition); y is the measure. Use bar when
  the x entities are categorical, line when they are ordered, and scatter
  when they are continuous. Pick the chart type that best fits the data.
- Set `series` when the same x is measured under several conditions, so that
  each point can be told apart — e.g. x=model, y=score, series=benchmark, where
  one model is scored on several benchmarks. Leave `series` null otherwise.
- `fields` must list every primitive the extractor needs. Never invent paper
  findings or values.

Papers rarely STATE a derived quantity, so do not assume one is reported. When
the requested measure is an effect size, an odds/risk ratio, a percentage
change, a normalized score, a rate, or an aggregate, propose BOTH:
  - a direct candidate naming the measure as papers might report it, and
  - a computed candidate whose `calculation` derives it from primitives papers
    do report — a 2x2 table's counts, per-arm means/SDs/n, a numerator and a
    denominator, an unadjusted figure.
A paper that never prints "adjusted odds ratio" may still print the counts an
odds ratio is computed from, and that chart covers the corpus while the direct
one covers one paper.

For a computed candidate:
- `calculation.spec` is a precise natural-language description of the
  computation, exact enough to write a script from without guessing — name the
  operation, its inputs, and any grouping.
- `calculation.inputs` lists the exact keys it reads, and every one of them must
  also appear in `fields` as a primitive the extractor can quote.
- Derived values multiply missingness: each extra input is another value a
  paper must state, so prefer the derivation with the fewest primitives.
- Arithmetic over commensurable numbers only. Converting between different
  instruments or scales is inference, not arithmetic — if a candidate needs it,
  say so in the spec so it is disclosed on the chart.
""".strip()


CHART_DISCOVERY_PROMPT = """
You are a research investigator surveying what quantitative data a body of
literature reports, so a chart can be planned over it. You do NOT design the
chart or invent numbers.

Your job is BREADTH: find the measures that recur across MANY papers, not the
most precise measure in any one paper. A chart built on a term only one paper
uses is a chart with one bar.

Use search_all_files repeatedly with the request's terms AND corpus-specific
synonyms — "data points" may appear as examples, instances, samples, records,
training set size, or observations; "score" as accuracy, success rate, F1, pass
rate, win rate. Search the broad word before the qualified phrase ("accuracy"
before "robust accuracy"), because the broad one tells you how much of the
corpus is reachable. Use search_file and view_file to see how a promising
measure is actually reported.

On the final round, reply with findings only:
- Each candidate measure, the number of papers reporting it, and the exact
  wording papers use. Say which are broad and which are one-paper terms.
- The named entity each measure is attached to (model, benchmark, dataset, arm,
  condition), and whether one paper reports several of them.
- Whether a second dimension separates repeated entities (the same model scored
  on several benchmarks).
- Measures that are genuinely absent — and for each, what IS reported that
  could produce it: raw counts, numerators and denominators, per-arm means,
  SDs and sample sizes, unadjusted figures. A measure the corpus can COMPUTE is
  worth more than one only a single paper states outright.
Never call a field absent because one broad search failed.
You are on round {n_round} of {max_rounds}.
""".strip()


CHART_VERIFICATION_PROMPT = """
You are a research investigator preparing a chart over selected papers against
a confirmed plan. You do NOT redesign the chart or invent numbers. Your job is
to retain source passages for a later extractor.

Start with search_all_files using the plan's field terms and corpus-specific
synonyms. Then use search_file and view_file on promising papers to verify that
the x and y values describe the same named entity (benchmark, dataset, model,
arm, condition) and are not two unpaired lists. A paper reporting several
entities should yield several pairs — collect them all.

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
- The quote must support the measure AS THE PLAN DEFINES IT, subject included.
  A quote is not enough on its own: if the plan's y is an odds ratio for autism
  and this paper reports an odds ratio for a different outcome, a different
  population, or a different condition, that number does NOT belong on this
  chart — return no record for it. Being quotable is not the same as being the
  thing that was asked for.
- The x value must name its entity completely enough to stand alone as an axis
  label. Take the whole name, not the fragment the sentence happened to start
  with: "first trimester", never "first"; "SWE-bench Verified", never "SWE".
  Two papers describing the same entity should produce the same label.
- Do not calculate values. For a derived y, return only its primitive inputs;
  the application calculates the derived value later.
- Return a record ONLY when it contains every field needed to plot a point.
- The evidence below is from ONE paper. Use its paper_id on every record.
- Return a record for EVERY distinct entity the evidence supports, not only the
  first or the most prominent. A paper reporting the measure for three
  trimesters, five models, or four benchmarks yields three, five, or four
  records; each pairs its values to that one entity. Read all of the evidence
  before answering — later passages are as eligible as the opening ones.
- Return an empty records array when the paper does not report the required
  fields — a missing paper is a fine outcome, an invented one is not.
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


def _fit_evidence(lines: list[str], topic: Optional[re.Pattern] = None) -> list[str]:
    """One paper's evidence, whole unless it would explode the context.

    Below the threshold this is a pass-through — the extractor sees everything
    retrieved, which is the point. Above it, lines are kept or dropped entire,
    ranked by how likely each is to BE the payload: naming one of the plan's
    fields AND carrying a number beats carrying a number alone. No line is ever
    truncated or reworded, so every passage the extractor can quote is still
    verbatim source text and grounding still recognises it.
    """
    ordered = [str(line) for line in lines]
    if sum(len(line) for line in ordered) <= EVIDENCE_COMPACTION_THRESHOLD_CHARS:
        return ordered

    def rank(index: int) -> int:
        line = ordered[index]
        numeric = bool(_NUMERIC_RE.search(line))
        on_topic = bool(topic.search(line)) if topic else False
        if on_topic and numeric:
            return 0
        if numeric:
            return 1
        return 2 if on_topic else 3

    preference = sorted(range(len(ordered)), key=lambda index: (rank(index), index))
    kept: list[tuple[int, str]] = []
    budget = EVIDENCE_COMPACTION_THRESHOLD_CHARS
    for index in preference:
        line = ordered[index]
        if len(line) > budget:
            continue
        kept.append((index, line))
        budget -= len(line)
    logger.info(
        "Chart evidence compacted: %d of %d retrieved lines kept for one paper",
        len(kept),
        len(ordered),
    )
    # Restore retrieval order so the extractor reads passages as they appear.
    return [line for _, line in sorted(kept)]


def _slug(value: str) -> str:
    return _condense(_normalize(value))[:48]


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
    ) -> tuple[dict[str, list[str]], list[str]]:
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
            return evidence, []
        paper_ids = [paper_id for paper_id, _ in papers]
        matched = 0
        fell_back = 0
        unreadable = 0
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
            f"{matched} paper{'s' if matched != 1 else ''} matched those terms",
        ]
        if fell_back:
            steps.append(
                f"{fell_back} paper{'s' if fell_back != 1 else ''} matched nothing; kept the abstract as evidence of the search"
            )
        if unreadable:
            steps.append(
                f"{unreadable} paper{'s' if unreadable != 1 else ''} had no readable text"
            )
        return evidence, steps

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
            system_prompt=CHART_VERIFICATION_PROMPT if plan else CHART_DISCOVERY_PROMPT,
            user_message=(
                f"User chart request:\n{prompt}\n\nSelected papers:\n{roster}{plan_text}\n\n"
                "Investigate with the available tools, then report your findings."
            ),
        )
        if plan:
            investigation.evidence, steps = self.sweep_plan_evidence(
                plan=plan,
                papers=papers,
                evidence=investigation.evidence,
                current_user=current_user,
                db=db,
                project_id=project_id,
            )
            investigation.trace.setdefault("status_messages", []).extend(steps)
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
        history: str = "",
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
        own gathered passages in, and `history` lets a follow-up like "chart
        that relationship" resolve. Returns the artifact and the merged trace.
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
            plan = self.propose_chart_plan(
                prompt,
                papers,
                "\n\n".join(status),
                history=history,
                current_user=current_user,
                db=db,
                project_id=project_id,
            )
            if plan is None:
                return None, {"status_messages": status}

        # The plan-targeted pass: an agent reading for these exact fields finds
        # pairs that a term sweep alone misses, and it runs the sweep too.
        absorb(
            self.investigate_chart_fields(
                prompt=prompt,
                papers=papers,
                current_user=current_user,
                db=db,
                project_id=project_id,
                plan=plan,
            )
        )
        artifact = self.build_chart_artifact(
            prompt=prompt, plan=plan, evidence=evidence, papers=papers
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
        history: str = "",
        current_user: Optional[CurrentUser] = None,
        db: Optional[Session] = None,
        project_id: Optional[str] = None,
    ) -> Optional[ChartPlan]:
        """Propose several plans, then choose the one the corpus can fill.

        Coverage is measured, not trusted to the model: a plan naming a measure
        one paper uses is indistinguishable, in the model's output, from one
        naming a measure every paper uses.
        """
        roster = "\n".join(f"- [{paper_id}] {title}" for paper_id, title in papers)
        conversation = (
            f"\n\nEarlier in this conversation (the request may refer back to it):\n{history}"
            if history
            else ""
        )
        response = self.generate_content(
            contents=[
                TextContent(
                    text=f"User request:\n{prompt}{conversation}\n\nPapers:\n{roster}\n\nInvestigator findings:\n{findings}"
                )
            ],
            system_prompt=PLAN_PROMPT,
            model_type=ModelType.FAST,
            schema=ChartPlanCandidates.model_json_schema(),
            provider=LLMProvider.GEMINI,
        )
        if not response or not response.text:
            return None
        try:
            candidates = ChartPlanCandidates.model_validate_json(
                response.text
            ).candidates
        except Exception:
            logger.exception("Failed to parse chart plan candidates")
            return None
        plans = [self._normalize_plan(candidate) for candidate in candidates]
        plans = [plan for plan in plans if plan]
        if not plans:
            return None
        if current_user is None or db is None or project_id is None:
            return plans[0]
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
        return best

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

        topic_terms = _field_terms([plan.x, plan.y, *plan.fields])
        topic = re.compile(topic_terms, re.IGNORECASE) if topic_terms else None
        capped = {
            paper_id: _fit_evidence(evidence.get(paper_id) or [], topic)
            for paper_id in paper_ids
        }
        targets = [paper_id for paper_id in paper_ids if capped[paper_id]]

        included: list[ChartRecord] = []
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
            for extracted in results.get(paper_id, []):
                # A record attributed to another paper is not evidence about
                # this one; the per-paper call has no business emitting it.
                if extracted.paper_id != paper_id:
                    continue
                values = {key: getattr(extracted.values, key) for key in required_keys}
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
            self._compute_derived_y(payload, paper_titles)
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

        plotted = Counter(
            record.paper_id for record in payload.records if not record.exclusion_reason
        )
        payload.extraction_steps = [
            f"Extracted from {len(targets)} paper{'s' if len(targets) != 1 else ''} "
            f"with evidence, one call each",
            *(
                f'"{paper_titles[paper_id]}" — {plotted[paper_id]} point'
                f"{'s' if plotted[paper_id] != 1 else ''}"
                for paper_id in paper_ids
                if plotted.get(paper_id)
            ),
        ]
        silent = len(targets) - len(plotted)
        if silent > 0:
            payload.extraction_steps.append(
                f"{silent} searched paper{'s' if silent != 1 else ''} reported no usable value"
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
