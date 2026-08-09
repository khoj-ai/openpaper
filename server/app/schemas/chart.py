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


class ChartValue(BaseModel):
    value: str
    quote: str = Field(description="Exact supporting quote from the paper")
    line_number: Optional[str] = None


class ChartRecord(BaseModel):
    """One plotted point.

    A paper reporting several benchmarks contributes several records, so the
    point — not the paper — is the unit of identity. `record_id` defaults to
    empty for artifacts stored before the distinction existed.
    """

    record_id: str = Field(default="")
    paper_id: str
    paper_title: str
    values: Dict[str, ChartValue] = Field(default_factory=dict)
    exclusion_reason: Optional[str] = None


class ChartExtractionRecord(BaseModel):
    """A qualifying point emitted by the model before coverage is computed."""

    paper_id: str
    paper_title: str
    values: Dict[str, ChartValue] = Field(
        min_length=2,
        description="At least the paired x/y fields, each with a direct quote",
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
    computation: Optional[dict] = None
    warnings: List[str] = Field(default_factory=list)
    investigation_trace: Optional[dict] = None
