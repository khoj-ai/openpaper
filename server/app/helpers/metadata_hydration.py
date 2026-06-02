"""Shared paper metadata hydration.

Resolves a paper's DOI and enriches journal/publisher/publish_date from external
APIs (CrossRef / OpenAlex via paper_search). This is the single seam used by:

- GET /paper (lazy, on read)
- post_process_paper (background, after upload)
- the find_citation agent (forced, when a citation is requested)

Writes are best-effort and gated by `attempted_metadata_at` so we don't re-hit
external APIs on every read; pass force=True to bypass the cache window.
"""

import logging
from datetime import datetime, timezone
from typing import Any, Optional

from app.database.crud.paper_crud import PaperUpdate, paper_crud
from app.database.models import Paper
from app.helpers.citations import bibliographic_gaps, fields_from_paper
from app.helpers.paper_search import get_doi, get_enriched_data
from app.helpers.parser import parse_publication_date
from app.llm.citation_recovery import get_recovery_agent
from app.schemas.user import CurrentUser
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

CHECK_METADATA_INTERVAL_DAYS = 30


def _is_metadata_cache_stale(paper: Paper) -> bool:
    attempted_at = paper.attempted_metadata_at
    if not attempted_at:
        return True
    return (
        datetime.now(timezone.utc) - attempted_at
    ).days >= CHECK_METADATA_INTERVAL_DAYS


def hydrate_paper_metadata(
    *,
    db: Session,
    paper: Paper,
    user: Optional[CurrentUser] = None,
    force: bool = False,
    agentic: bool = False,
    agentic_steps: Optional[list[Any]] = None,
) -> Paper:
    """Resolve DOI + enrich journal/publisher/publish_date for a paper.

    Mutates and returns the paper. No-op (returns paper unchanged) when the
    metadata cache is still fresh and force is False. Swallows external API
    errors so callers on a hot path are never broken by lookup failures.

    When `agentic=True`, after the deterministic CrossRef/OpenAlex pass leaves
    bibliographic gaps, the citation subagent runs an Exa+Firecrawl+LLM
    extraction fallback (confidence-gated, null-only write-back with
    field_provenance). This is expensive — only enable on background/off-hot
    paths (e.g. post-upload, backfill scripts), never on synchronous reads.
    """
    if not force and not _is_metadata_cache_stale(paper):
        return paper

    try:
        if not paper.doi and paper.title:
            doi = get_doi(
                str(paper.title),
                list(paper.authors) if paper.authors else None,
            )
            if doi:
                updated = paper_crud.update(
                    db=db, db_obj=paper, obj_in=PaperUpdate(doi=doi), user=user
                )
                if updated:
                    paper = updated

        if paper.doi and not paper.journal and not paper.publisher:
            enriched = get_enriched_data(str(paper.doi))
            if enriched:
                publish_datetime = (
                    parse_publication_date(enriched.publication_date)
                    if enriched.publication_date
                    else paper.publish_date
                )
                updated = paper_crud.update(
                    db=db,
                    db_obj=paper,
                    obj_in=PaperUpdate(
                        journal=enriched.journal,
                        publisher=enriched.publisher,
                        publish_date=(
                            publish_datetime.isoformat() if publish_datetime else None
                        ),
                    ),
                    user=user,
                )
                if updated:
                    paper = updated

        if agentic and bibliographic_gaps(fields_from_paper(paper)):
            paper, _, _ = get_recovery_agent().recover_metadata(
                db=db, paper=paper, user=user, steps=agentic_steps
            )
    except Exception:
        logger.exception(
            "Error hydrating metadata for paper %s", paper.id, exc_info=True
        )
    finally:
        # Stamp the attempt regardless of outcome so we respect the cache window.
        try:
            updated = paper_crud.update(
                db=db,
                db_obj=paper,
                obj_in=PaperUpdate(attempted_metadata_at=datetime.now(timezone.utc)),
                user=user,
            )
            if updated:
                paper = updated
        except Exception:
            db.rollback()
            logger.exception(
                "Error stamping attempted_metadata_at for paper %s",
                paper.id,
                exc_info=True,
            )

    return paper
