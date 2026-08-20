"""The wire shape of a first-party artifact, one member per kind.

Storage is normalized into a table per kind; this is what the API sends and
what the client has always parsed. Keeping the two apart means the columns can
change without the client noticing, and it gives every write path one typed
gate instead of a dict whose kind is guessed from a key lookup.
"""

from typing import Annotated, List, Literal, Optional, Union

from app.schemas.chart import ChartArtifactPayload
from app.schemas.citation import CitationData, CitationResult
from pydantic import BaseModel, Field, TypeAdapter


class CitationArtifactPayload(BaseModel):
    """A resolved citation, as the card renders it.

    Deliberately narrower than `CitationResult`: the resolver's trajectory
    (`steps`, `filled_fields`) is how the answer was reached, not part of the
    answer, and it is never stored.
    """

    kind: Literal["citation"] = "citation"
    paper_id: str
    preferred_style: str
    style_display: str
    data: CitationData
    method: str
    missing_fields: List[str] = Field(default_factory=list)
    confidence: Optional[float] = None

    @classmethod
    def from_result(cls, result: CitationResult) -> "CitationArtifactPayload":
        return cls(
            paper_id=result.paper_id,
            preferred_style=result.preferred_style,
            style_display=result.style_display,
            data=result.data,
            method=result.method,
            missing_fields=list(result.missing_fields),
            confidence=result.confidence,
        )


ArtifactPayload = Annotated[
    Union[CitationArtifactPayload, ChartArtifactPayload],
    Field(discriminator="kind"),
]

# Parses a payload dict into the right member by its `kind`, so no caller has
# to read that key itself to decide what it is holding.
artifact_payload_adapter: TypeAdapter[ArtifactPayload] = TypeAdapter(ArtifactPayload)
