"""Typed, source-backed payloads for chart artifacts."""

from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field

ChartType = Literal["bar", "line", "scatter"]


class ChartField(BaseModel):
    """One field the chart extractor must find in a paper."""

    key: str = Field(description="Stable short key used in chart records")
    label: str = Field(description="Human-readable axis or grouping label")
    unit: Optional[str] = Field(
        default=None,
        description=(
            "The unit this field's numbers are plotted in — s, %, mg/dL, kg. "
            "One field is one unit, so name it here even when the papers are "
            "expected to disagree: each paper's number is converted into this "
            "one. Leave empty only for a measure that has no unit at all — a "
            "count, an index, a dimensionless score."
        ),
    )


class ChartCalculation(BaseModel):
    """A derived y value computed only from cited primitive fields."""

    label: str
    spec: str
    inputs: List[str] = Field(default_factory=list)


class ChartPlan(BaseModel):
    title: str
    chart_type: ChartType
    x: ChartField
    y: ChartField
    series: Optional[ChartField] = None
    fields: List[ChartField] = Field(
        default_factory=list,
        description="Primitive fields extracted for the chart, including x/y when raw",
    )
    calculation: Optional[ChartCalculation] = None


class ChartPlanCandidates(BaseModel):
    """Several plans to choose between by measured corpus coverage.

    Asking for one plan makes the model commit to a field name before anyone
    knows how many papers report it, which is how a chart ends up with one bar.
    """

    candidates: List[ChartPlan] = Field(default_factory=list)
    clarification: Optional[str] = Field(
        default=None,
        description=(
            "Returned INSTEAD of candidates when the request cannot honestly be "
            "turned into a chart over this corpus. Say what is missing and what "
            "the user could specify, in one or two sentences addressed to them."
        ),
    )


class ChartProposal(BaseModel):
    """What the planner came back with: a plan, or why it could not make one."""

    plan: Optional[ChartPlan] = None
    clarification: Optional[str] = None


class ChartQuotedValue(BaseModel):
    """What the extractor is asked for: what the paper says, and how to read it.

    Separate from ChartValue because this is the shape the model fills in. It
    may state a conversion but never perform one — `value` is what the paper
    printed, and the arithmetic that moves it onto the chart's unit runs later,
    in the sandbox, from the lambda given here.
    """

    value: str = Field(description="The value exactly as the paper prints it")
    quote: str = Field(description="Exact supporting quote from the paper")
    line_number: Optional[str] = None
    unit: Optional[str] = Field(
        default=None,
        description=(
            "The unit this paper states for this value — %, s, ms, mg/dL — "
            "copied from the paper, never converted and never invented. Leave "
            "empty when the paper states none."
        ),
    )
    conversion: str = Field(
        default="lambda v: v",
        description=(
            "A Python lambda of one argument that takes the number in `value`, "
            "in this paper's unit, to the same quantity in the unit the plan "
            "gives this field. `lambda v: v` when the paper already reports in "
            "that unit, or the field has no unit. `lambda v: v / 1000` for ms "
            "on a seconds axis; `lambda v: v * 0.621371` for km on a miles "
            "axis; `lambda v: v * 9 / 5 + 32` for Celsius on a Fahrenheit one. "
            "One expression — no statements, no imports — though `math` is "
            "available. Leave it EMPTY when this paper's number cannot be "
            "expressed in the plan's unit at all, and say why in "
            "`conversion_note`."
        ),
    )
    conversion_note: Optional[str] = Field(
        default=None,
        description=(
            "Why this value cannot be expressed in the plan's unit, when "
            "`conversion` is empty — a different instrument, an "
            "incommensurable scale. One sentence, addressed to someone reading "
            "the chart and wondering where this paper went."
        ),
    )


class ChartValue(ChartQuotedValue):
    """A quoted value with the quantity the application read out of it."""

    number: Optional[float] = Field(
        default=None,
        description=(
            "The plotted quantity: the number `value` carries, parsed on the "
            "server and put through `conversion` in the sandbox, so it is in "
            "the unit the plan gives this field. `value` stays exactly as the "
            "paper wrote it, so the quote still matches. None when the quoted "
            "text states no plottable quantity."
        ),
    )


class ChartRecord(BaseModel):
    """One plotted point.

    A paper reporting several benchmarks contributes several records, so the
    point — not the paper — is the unit of identity.
    """

    record_id: str
    paper_id: str
    paper_title: str
    values: Dict[str, ChartValue] = Field(default_factory=dict)
    exclusion_reason: Optional[str] = None


class ChartExtractionRecord(BaseModel):
    """A qualifying point emitted by the model before coverage is computed.

    The request schema is built per plan so every field the plan needs is a
    required property; this is the static shape those responses are read back
    as, and completeness is checked per record so one short record costs a
    point rather than the whole paper's response.
    """

    paper_id: str
    paper_title: str
    values: Dict[str, ChartQuotedValue] = Field(
        description="The plan's fields, each with a direct quote",
    )


class ChartExtraction(BaseModel):
    """Model output for chart extraction; coverage is added deterministically."""

    records: List[ChartExtractionRecord] = Field(default_factory=list)


class ChartCoverage(BaseModel):
    searched_paper_ids: List[str] = Field(default_factory=list)
    included_paper_ids: List[str] = Field(default_factory=list)
    excluded: Dict[str, str] = Field(default_factory=dict)


class ChartArtifactPayload(BaseModel):
    kind: Literal["chart"] = "chart"
    plan: ChartPlan
    records: List[ChartRecord] = Field(default_factory=list)
    coverage: ChartCoverage
    series_by_paper: bool = Field(
        default=False,
        description=(
            "Draw the paper as the series. Set when several papers report the "
            "same x, where the study is what tells otherwise identical points "
            "apart. Distinct from plan.series, which is a value quoted from a "
            "paper's text; the study is metadata and is never extracted."
        ),
    )
    computation: Optional[dict] = None
    conversions: Optional[dict] = Field(
        default=None,
        description=(
            "Provenance for the unit conversions: the harness, every lambda it "
            "ran and what each one produced. Present only when some paper "
            "reported in a unit other than the plan's."
        ),
    )
    warnings: List[str] = Field(default_factory=list)
    extraction_steps: List[str] = Field(
        default_factory=list,
        description="What extraction did, per paper; callers merge these into the trace",
    )
    investigation_trace: Optional[dict] = None
