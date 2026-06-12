"""Agentic recovery of missing paper metadata.

A small LLM loop that runs `web_search` (Exa) + `web_fetch` (Firecrawl) over
a paper's bibliographic details, falls back to a forced structured-output
extraction, and writes back any null fields it can confidently fill (with
field_provenance). Reusable from any codepath that already has a Paper row
(chat, post-upload background, backfill).

This module deliberately does NOT depend on `app.helpers.metadata_hydration` so
the chain `metadata_hydration → citation_recovery` is a clean DAG (the
higher-level `app.llm.citation_agent` imports both).
"""

import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from app.database.crud.paper_crud import PaperUpdate, paper_crud
from app.database.models import Paper
from app.helpers.citations import CitationFields, bibliographic_gaps, fields_from_paper
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
from app.schemas.citation import CitationStep
from app.schemas.responses import TextContent, ToolCallResult
from app.schemas.user import CurrentUser
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

CONFIDENCE_THRESHOLD = 0.7
MAX_WEB_ITERATIONS = 3

# JSON schema for the forced extraction backstop. Strict mode (OpenAI/Cerebras)
# requires every property to be in `required` AND additionalProperties=false; we
# preserve the honest "couldn't find this" semantics by making the metadata
# fields nullable — the model must mention each key but can set it to null.
CITATION_EXTRACTION_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "journal": {"type": ["string", "null"]},
        "publisher": {"type": ["string", "null"]},
        "doi": {"type": ["string", "null"]},
        "publish_date": {"type": ["string", "null"]},
        "source_url": {"type": ["string", "null"]},
        "confidence": {"type": "number"},
    },
    "required": [
        "journal",
        "publisher",
        "doi",
        "publish_date",
        "source_url",
        "confidence",
    ],
}

RECOVERY_SYSTEM_PROMPT = (
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


class MetadataRecoveryAgent(BaseLLMClient):
    """Web-search + extraction agent that fills missing paper metadata."""

    def recover_metadata(
        self,
        *,
        db: Session,
        paper: Paper,
        user: Optional[CurrentUser] = None,
        missing_hint: Optional[list[str]] = None,
        steps: Optional[list[CitationStep]] = None,
    ) -> tuple[Paper, dict[str, Any], Optional[float]]:
        """Agentic fallback that tries to fill the paper's missing metadata.

        Confidence-gated, null-only write-back with `field_provenance`. Pass
        `missing_hint` to focus the search on specific fields; otherwise we
        derive a style-agnostic list of bibliographic gaps from the paper.
        `steps` collects the trajectory when the caller wants to surface it.

        Returns: (paper, filled_fields, confidence). `filled_fields` is empty
        when nothing was written.
        """
        fields = fields_from_paper(paper)
        gaps = missing_hint if missing_hint is not None else bibliographic_gaps(fields)
        captured = steps if steps is not None else []
        if not gaps:
            return paper, {}, None

        findings = self._run_web_loop(fields, gaps, captured)
        if not findings:
            return paper, {}, None

        confidence = float(findings.get("confidence") or 0.0)
        if confidence < CONFIDENCE_THRESHOLD:
            captured.append(
                CitationStep(
                    kind="write_back",
                    detail=f"Findings below confidence threshold ({confidence}); not written back.",
                    data=findings,
                )
            )
            return paper, {}, confidence

        filled = self._write_back(db, paper, findings, confidence, user, captured)
        return paper, filled, confidence

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
                    system_prompt=RECOVERY_SYSTEM_PROMPT,
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

                # Canonicalize args so semantically identical calls dedup
                # regardless of key ordering or whitespace from the model.
                try:
                    args_key = json.dumps(args, sort_keys=True, default=str)
                except (TypeError, ValueError):
                    args_key = str(args)
                dedup_key = f"{name}:{args_key}"
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
        current_user: Optional[CurrentUser],
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


_recovery_agent: Optional[MetadataRecoveryAgent] = None


def get_recovery_agent() -> MetadataRecoveryAgent:
    """Lazy singleton — avoids constructing provider clients until first use."""
    global _recovery_agent
    if _recovery_agent is None:
        _recovery_agent = MetadataRecoveryAgent()
    return _recovery_agent
