"""Typed, source-backed payloads for chart artifacts."""

from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field

ChartType = Literal["bar", "line", "scatter"]


class ChartField(BaseModel):
    """One field the chart extractor must find in a paper."""

    key: str = Field(description="Stable short key used in chart records")
    label: str = Field(description="Human-readable axis or grouping label")
    unit: Optional[str] = Field(default=None, description="Unit displayed with values")


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


class ChartValue(BaseModel):
    value: str
    quote: str = Field(description="Exact supporting quote from the paper")
    line_number: Optional[str] = None


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
    values: Dict[str, ChartValue] = Field(
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
    warnings: List[str] = Field(default_factory=list)
    extraction_steps: List[str] = Field(
        default_factory=list,
        description="What extraction did, per paper; callers merge these into the trace",
    )
    investigation_trace: Optional[dict] = None
