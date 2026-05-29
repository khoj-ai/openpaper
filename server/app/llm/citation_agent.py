"""find_citation: render a paper's citation in a requested style, recovering
missing bibliographic metadata when needed.

Strategy (cheapest first):
  1. cached        — all required fields present, render immediately.
  2. deterministic — fill via the shared CrossRef/OpenAlex hydration seam.
  3. agentic       — a bounded web_search/web_fetch LLM loop for whatever is
                     still missing, with confidence-gated, null-only write-back
                     plus provenance.

This is a focused, standalone agent (its own small loop on BaseLLMClient) so it
can be invoked from the multi-paper chat tool or any other codepath.
"""

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from app.database.crud.paper_crud import PaperUpdate, paper_crud
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
from app.helpers.paper_search import extract_doi_from_url
from app.helpers.parser import parse_publication_date
from app.llm.base import BaseLLMClient, ModelType
from app.llm.provider import LLMProvider
from app.llm.tools.web_tools import (
    web_fetch,
    web_fetch_function,
    web_search,
    web_search_function,
)
from app.schemas.citation import CitationData, CitationResult, CitationStep
from app.schemas.responses import TextContent, ToolCallResult
from app.schemas.user import CurrentUser
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

CONFIDENCE_THRESHOLD = 0.7
MAX_WEB_ITERATIONS = 3

# JSON schema for the forced extraction backstop. Only `confidence` is required;
# the metadata fields are optional so the agent can honestly omit anything it
# could not find rather than being pressured to fabricate a value.
CITATION_EXTRACTION_SCHEMA = {
    "type": "object",
    "properties": {
        "journal": {"type": ["string", "null"]},
        "publisher": {"type": ["string", "null"]},
        "doi": {"type": ["string", "null"]},
        "publish_date": {"type": ["string", "null"]},
        "source_url": {"type": ["string", "null"]},
        "confidence": {"type": "number"},
    },
    "required": ["confidence"],
}

find_citation_function = {
    "name": "find_citation",
    "description": (
        "Produce a bibliographic citation for ONE specific paper. Use this "
        "whenever the user asks for a citation, reference, or bibliography "
        "entry (in APA, MLA, IEEE, Chicago, Harvard, AMA, AAA, or BibTeX). It "
        "resolves any missing publication metadata (journal/venue, publisher, "
        "DOI, date) automatically and returns structured citation data that is "
        "shown to the user as an interactive citation card. Call it once per "
        "paper the user wants cited."
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

_finder: Optional["CitationFinder"] = None


def _get_finder() -> "CitationFinder":
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


CITATION_FINDER_SYSTEM_PROMPT = (
    "You are a bibliographic research assistant. Your job is to find the "
    "missing publication metadata (journal/venue, publisher, DOI, publication "
    "date) for one specific academic paper so it can be cited correctly.\n\n"
    "Use web_search to locate authoritative sources, and web_fetch only when a "
    "search result snippet is not enough. Critically verify that a source "
    "describes THE SAME paper by matching its title and authors.\n\n"
    "Be decisive and efficient — you usually need only ONE or TWO searches. As "
    "soon as a result reveals the venue/publisher/DOI, STOP searching and call "
    "submit_findings; do not keep searching for perfection. You have a strict, "
    "small number of steps. Always finish by calling submit_findings exactly "
    "once: include the fields you are confident about with an honest confidence "
    "score, or a low confidence score if you could not determine them."
)

submit_findings_function = {
    "name": "submit_findings",
    "description": (
        "Report the bibliographic fields you found for this paper. Provide only "
        "fields you are confident about; omit unknown ones. Call this exactly "
        "once when you are done."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "journal": {
                "type": "string",
                "description": "The journal or publication venue name.",
            },
            "publisher": {"type": "string", "description": "The publisher name."},
            "doi": {
                "type": "string",
                "description": "The DOI identifier (no URL prefix).",
            },
            "publish_date": {
                "type": "string",
                "description": "Publication date as YYYY-MM-DD or YYYY.",
            },
            "confidence": {
                "type": "number",
                "description": "Confidence from 0.0 to 1.0 that these values are correct for THIS paper.",
            },
            "source_url": {
                "type": "string",
                "description": "The URL these values were taken from.",
            },
        },
        "required": ["confidence"],
    },
}


class CitationFinder(BaseLLMClient):
    """Agent that renders a citation, recovering missing metadata as needed."""

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

        # 3. Agentic web recovery for whatever is still missing.
        findings = self._run_web_loop(fields, missing, steps)
        filled: dict[str, Any] = {}
        confidence = float(findings.get("confidence") or 0.0) if findings else None
        if findings and confidence is not None and confidence >= CONFIDENCE_THRESHOLD:
            filled = self._write_back(
                db, paper, findings, confidence, current_user, steps
            )
            fields = fields_from_paper(paper)
        elif findings:
            steps.append(
                CitationStep(
                    kind="write_back",
                    detail=f"Findings below confidence threshold ({confidence}); not written back.",
                    data=findings,
                )
            )

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

    def _describe_task(self, fields: CitationFields, missing: list[str]) -> str:
        authors = ", ".join(fields.authors) if fields.authors else "unknown"
        return (
            "Find the missing publication metadata for this paper.\n\n"
            f"- Title: {fields.title or 'unknown'}\n"
            f"- Authors: {authors}\n"
            f"- DOI: {fields.doi or 'unknown'}\n"
            f"- Publication date: {fields.publish_date or 'unknown'}\n"
            f"- Journal/venue: {fields.journal or 'unknown'}\n"
            f"- Publisher: {fields.publisher or 'unknown'}\n\n"
            f"Specifically needed: {', '.join(missing)}.\n"
            "Search for the paper, verify the source matches its title and "
            "authors, then call submit_findings."
        )

    def _run_web_loop(
        self,
        fields: CitationFields,
        missing: list[str],
        steps: list[CitationStep],
    ) -> Optional[dict[str, Any]]:
        function_declarations = [
            web_search_function,
            web_fetch_function,
            submit_findings_function,
        ]
        function_maps = {"web_search": web_search, "web_fetch": web_fetch}
        user_msg = self._describe_task(fields, missing)
        tool_call_results: list[ToolCallResult] = []
        prev_queries: set[str] = set()

        for _ in range(MAX_WEB_ITERATIONS):
            try:
                # Cerebras (OpenAI-compatible) handles multi-turn tool calling
                # cleanly; Gemini 3 additionally requires replaying opaque
                # thought_signatures, which our tool types don't capture.
                resp = self.generate_content(
                    system_prompt=CITATION_FINDER_SYSTEM_PROMPT,
                    contents=[TextContent(text=user_msg)],
                    function_declarations=function_declarations,
                    tool_call_results=tool_call_results or None,
                    model_type=ModelType.DEFAULT,
                    provider=LLMProvider.CEREBRAS,
                    enable_thinking=True,
                )
            except Exception:
                logger.exception("Citation web loop LLM call failed")
                break

            if resp.thinking:
                steps.append(CitationStep(kind="thinking", detail=resp.thinking[:500]))

            if not resp.tool_calls:
                break

            submitted: Optional[dict[str, Any]] = None
            for call in resp.tool_calls:
                name = (call.name or "").lower()
                args = call.args or {}

                if name == "submit_findings":
                    submitted = args
                    steps.append(
                        CitationStep(
                            kind="submit",
                            detail="Agent submitted findings.",
                            data=args,
                        )
                    )
                    continue

                if name not in function_maps:
                    continue

                dedup_key = f"{name}:{args}"
                if dedup_key in prev_queries:
                    continue
                prev_queries.add(dedup_key)

                try:
                    result = function_maps[name](**args)
                except Exception as e:
                    logger.warning("Citation tool %s failed: %s", name, e)
                    result = f"Error: {e}"

                if name == "web_search":
                    steps.append(
                        CitationStep(
                            kind="web_search",
                            detail=f"Searched: {args.get('query', '')}",
                            data={
                                "results": result if isinstance(result, list) else None
                            },
                        )
                    )
                else:
                    steps.append(
                        CitationStep(
                            kind="web_fetch",
                            detail=f"Fetched: {args.get('url', '')}",
                        )
                    )

                tool_call_results.append(
                    ToolCallResult(id=call.id, name=call.name, args=args, result=result)
                )

            if submitted is not None:
                return submitted

        # The model rarely calls submit_findings on its own, so back-stop with a
        # forced structured extraction over everything gathered.
        return self._extract_findings(fields, missing, tool_call_results, steps)

    def _extract_findings(
        self,
        fields: CitationFields,
        missing: list[str],
        tool_call_results: list[ToolCallResult],
        steps: list[CitationStep],
    ) -> Optional[dict[str, Any]]:
        """Forced structured extraction of citation fields from gathered sources."""
        if not tool_call_results:
            return None

        context_chunks = []
        for r in tool_call_results:
            value = r.result
            if not isinstance(value, str):
                value = json.dumps(value, default=str)
            context_chunks.append(f"[{r.name} {r.args}]\n{value[:1500]}")
        context = "\n\n".join(context_chunks)[:6000]

        authors = ", ".join(fields.authors) if fields.authors else "unknown"
        prompt = (
            "Extract bibliographic metadata for this paper from the research "
            "notes below. Only return values you are confident belong to THIS "
            "exact paper (match the title and authors); use null otherwise. "
            "Give an honest overall confidence from 0.0 to 1.0.\n\n"
            f"Title: {fields.title or 'unknown'}\n"
            f"Authors: {authors}\n"
            f"Fields needed: {', '.join(missing)}.\n\n"
            f"Research notes:\n{context}"
        )
        try:
            resp = self.generate_content(
                system_prompt=(
                    "You extract structured bibliographic metadata. Respond only "
                    "with the JSON object matching the schema."
                ),
                contents=[TextContent(text=prompt)],
                schema=CITATION_EXTRACTION_SCHEMA,
                model_type=ModelType.DEFAULT,
                provider=LLMProvider.CEREBRAS,
                enable_thinking=False,
            )
            findings = json.loads(resp.text)
        except Exception:
            logger.exception("Citation extraction failed")
            return None

        # If nothing usable was found, return None rather than a low-signal dict.
        if not any(
            findings.get(f) for f in ("journal", "publisher", "doi", "publish_date")
        ):
            steps.append(
                CitationStep(
                    kind="submit",
                    detail="No matching metadata found in gathered sources.",
                )
            )
            return None

        steps.append(
            CitationStep(
                kind="submit",
                detail="Extracted citation fields from gathered sources.",
                data=findings,
            )
        )
        return findings

    def _write_back(
        self,
        db: Session,
        paper: Paper,
        findings: dict[str, Any],
        confidence: float,
        current_user: CurrentUser,
        steps: list[CitationStep],
    ) -> dict[str, Any]:
        source_url = findings.get("source_url")
        now_iso = datetime.now(timezone.utc).isoformat()

        doi = findings.get("doi")
        if doi:
            doi = extract_doi_from_url(doi) or doi

        publish_date = findings.get("publish_date")
        if publish_date:
            parsed = parse_publication_date(publish_date)
            publish_date = parsed.isoformat() if parsed else None

        candidates = {
            "journal": findings.get("journal"),
            "publisher": findings.get("publisher"),
            "doi": doi,
            "publish_date": publish_date,
        }
        # Never clobber existing values — fill only currently-null fields.
        current = {
            "journal": paper.journal,
            "publisher": paper.publisher,
            "doi": paper.doi,
            "publish_date": paper.publish_date,
        }

        filled: dict[str, Any] = {}
        provenance: Dict[str, Any] = dict(paper.field_provenance or {})  # type: ignore
        for f, value in candidates.items():
            if value and not current.get(f):
                filled[f] = value
                provenance[f] = {
                    "source_url": source_url,
                    "filled_by": "find_citation",
                    "confidence": confidence,
                    "filled_at": now_iso,
                }

        if not filled:
            steps.append(
                CitationStep(
                    kind="write_back",
                    detail="Nothing new to write (fields already populated).",
                )
            )
            return {}

        paper_crud.update(
            db=db,
            db_obj=paper,
            obj_in=PaperUpdate(field_provenance=provenance, **filled),
            user=current_user,
        )
        steps.append(
            CitationStep(
                kind="write_back",
                detail=f"Wrote back {list(filled)} (confidence {confidence}).",
                data=filled,
            )
        )
        return filled

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
