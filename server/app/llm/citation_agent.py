"""find_citation: render a paper's citation in a requested style, recovering
missing bibliographic metadata when needed.

Strategy (cheapest first):
  1. cached        — all required fields present, render immediately.
  2. deterministic — fill via the shared CrossRef/OpenAlex hydration seam.
  3. agentic       — delegate to `MetadataRecoveryAgent` (web_search + extraction
                     + confidence-gated null-only write-back with provenance).

This module is the chat-tool-facing layer. The agentic loop itself lives in
`app.llm.citation_recovery` so `app.helpers.metadata_hydration` can call it
without an import cycle.
"""

import logging
import uuid
from typing import Any, Optional

from app.database.crud.paper_crud import paper_crud
from app.database.crud.projects.project_paper_crud import project_paper_crud
from app.database.models import Paper
from app.helpers.citations import (
    STYLE_DISPLAY_NAMES,
    CitationFields,
    fields_from_paper,
    missing_required_fields,
    normalize_style,
)
from app.helpers.metadata_hydration import hydrate_paper_metadata
from app.llm.citation_recovery import MetadataRecoveryAgent
from app.schemas.citation import CitationData, CitationResult, CitationStep
from app.schemas.user import CurrentUser
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


find_citation_function = {
    "name": "find_citation",
    "description": (
        "Produce a bibliographic citation for ONE specific paper. Use this "
        "whenever the user asks for a citation, reference, or bibliography "
        "entry (in APA, MLA, IEEE, Chicago, Harvard, AMA, AAA, or BibTeX). It "
        "resolves any missing publication metadata (journal/venue, publisher, "
        "DOI, date) automatically, and the resulting citation is presented to "
        "the user for you. Call it once per paper the user wants cited."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "paper_id": {
                "type": "string",
                "description": "The ID of the paper to cite.",
            },
            "style": {
                "type": "string",
                "description": (
                    "Preferred citation style requested by the user, e.g. "
                    "'APA 7th edition', 'MLA', 'IEEE', 'Chicago', 'Harvard', "
                    "'AMA', 'AAA', 'BibTeX'. Defaults to APA if unspecified."
                ),
            },
        },
        "required": ["paper_id"],
    },
}


class CitationFinder(MetadataRecoveryAgent):
    """Chat-surface agent: cached -> deterministic -> agentic citation finding."""

    def find_citation(
        self,
        *,
        db: Session,
        paper_id: str,
        style: str,
        current_user: CurrentUser,
        project_id: Optional[str] = None,
    ) -> CitationResult:
        canonical = normalize_style(style)
        display = STYLE_DISPLAY_NAMES[canonical]
        steps: list[CitationStep] = []

        paper = self._load_paper(db, paper_id, current_user, project_id)
        if not paper:
            return CitationResult(
                paper_id=paper_id,
                preferred_style=canonical,
                style_display=display,
                data=CitationData(paper_id=paper_id),
                method="not_found",
                steps=[
                    CitationStep(
                        kind="check", detail="Paper not found or access denied."
                    )
                ],
            )

        # 1. Cached: all required fields already present.
        fields = fields_from_paper(paper)
        missing = missing_required_fields(fields, canonical)
        steps.append(
            CitationStep(
                kind="check",
                detail=f"Fields needed for {display}: {missing or 'none missing'}.",
                data={"missing": missing},
            )
        )
        if not missing:
            return self._finalize(
                paper_id, canonical, display, fields, "cached", [], {}, None, steps
            )

        # 2. Deterministic hydration via the shared seam (CrossRef/OpenAlex).
        paper = hydrate_paper_metadata(
            db=db, paper=paper, user=current_user, force=True
        )
        fields = fields_from_paper(paper)
        missing = missing_required_fields(fields, canonical)
        steps.append(
            CitationStep(
                kind="deterministic",
                detail=f"After CrossRef/OpenAlex lookup, still missing: {missing or 'none'}.",
                data={
                    "missing": missing,
                    "doi": fields.doi,
                    "journal": fields.journal,
                    "publisher": fields.publisher,
                },
            )
        )
        if not missing:
            return self._finalize(
                paper_id,
                canonical,
                display,
                fields,
                "deterministic",
                [],
                {},
                None,
                steps,
            )

        # 3. Agentic web recovery for whatever the style still needs.
        paper, filled, confidence = self.recover_metadata(
            db=db,
            paper=paper,
            user=current_user,
            missing_hint=missing,
            steps=steps,
        )
        fields = fields_from_paper(paper)
        missing = missing_required_fields(fields, canonical)
        method = "agentic" if filled else "partial"
        return self._finalize(
            paper_id,
            canonical,
            display,
            fields,
            method,
            missing,
            filled,
            confidence,
            steps,
        )

    def _load_paper(
        self,
        db: Session,
        paper_id: str,
        current_user: CurrentUser,
        project_id: Optional[str],
    ) -> Optional[Paper]:
        try:
            if project_id:
                return project_paper_crud.get_paper_by_project(
                    db,
                    paper_id=uuid.UUID(paper_id),
                    project_id=uuid.UUID(project_id),
                    user=current_user,
                )
            return paper_crud.get(db, id=paper_id, user=current_user)
        except Exception:
            logger.exception("Failed to load paper %s for citation", paper_id)
            return None

    def _finalize(
        self,
        paper_id: str,
        canonical: str,
        display: str,
        fields: CitationFields,
        method: str,
        missing: list[str],
        filled: dict[str, Any],
        confidence: Optional[float],
        steps: list[CitationStep],
    ) -> CitationResult:
        data = CitationData(
            paper_id=str(paper_id),
            title=fields.title,
            authors=fields.authors,
            publish_date=fields.publish_date,
            journal=fields.journal,
            publisher=fields.publisher,
            doi=fields.doi,
        )
        steps.append(
            CitationStep(
                kind="resolve",
                detail=f"Resolved citation metadata; preferred style {display}.",
                data={"missing": missing},
            )
        )
        return CitationResult(
            paper_id=str(paper_id),
            preferred_style=canonical,
            style_display=display,
            data=data,
            method=method,  # type: ignore[arg-type]
            missing_fields=missing,
            filled_fields=filled,
            confidence=confidence,
            steps=steps,
        )


_finder: Optional[CitationFinder] = None


def _get_finder() -> CitationFinder:
    global _finder
    if _finder is None:
        _finder = CitationFinder()
    return _finder


def run_find_citation(
    paper_id: str,
    current_user: CurrentUser,
    db: Session,
    style: str = "APA",
    project_id: Optional[str] = None,
) -> CitationResult:
    """Tool entry point matching the multi-paper evidence loop's call signature."""
    return _get_finder().find_citation(
        db=db,
        paper_id=paper_id,
        style=style,
        current_user=current_user,
        project_id=project_id,
    )
