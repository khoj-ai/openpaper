"""
Backfill paper metadata (DOI / journal / publisher / publish_date) via the
agentic citation-finding subagent for papers uploaded before the agentic
post-upload step existed (or any paper still missing bibliographic fields).

Each paper is hydrated through `hydrate_paper_metadata(force=True, agentic=True)`,
which runs the deterministic CrossRef/OpenAlex pass first and then the
Exa+Firecrawl+LLM-extraction fallback for whatever is still null. Writes are
confidence-gated and null-only with field_provenance, so existing values are
never clobbered.

Usage:
    python -m app.scripts.backfill_paper_metadata [--limit N] [--dry-run]

This calls external APIs (Exa, Firecrawl, Cerebras) for every candidate paper
and is therefore not cheap — use --limit to bound the run, and prefer running
during off-hours.
"""

import argparse
import logging
import os
import sys
import time

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../")))

from app.database.database import SessionLocal
from app.database.models import Paper
from app.helpers.citations import bibliographic_gaps, fields_from_paper
from app.helpers.metadata_hydration import hydrate_paper_metadata
from sqlalchemy.orm import Session

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


def _candidate_papers(db: Session, limit: int | None) -> list[Paper]:
    # Anything still missing DOI, venue, or publish_date is a candidate.
    q = (
        db.query(Paper)
        .filter(
            (Paper.doi.is_(None))
            | ((Paper.journal.is_(None)) & (Paper.publisher.is_(None)))
            | (Paper.publish_date.is_(None))
        )
        .filter(Paper.title.isnot(None))
        .order_by(Paper.last_accessed_at.desc().nullslast())
    )
    if limit:
        q = q.limit(limit)
    return q.all()


def backfill(limit: int | None = None, dry_run: bool = False) -> None:
    db = SessionLocal()
    try:
        papers = _candidate_papers(db, limit)
        total = len(papers)
        logger.info(f"Found {total} candidate papers with metadata gaps")

        recovered = 0
        unchanged = 0
        errors = 0
        start = time.time()

        for i, paper in enumerate(papers, 1):
            gaps_before = bibliographic_gaps(fields_from_paper(paper))
            title = (paper.title or "")[:80]
            logger.info(
                f"[{i}/{total}] {paper.id}  gaps={gaps_before}  title={title!r}"
            )

            if dry_run:
                continue

            try:
                hydrate_paper_metadata(
                    db=db, paper=paper, user=None, force=True, agentic=True
                )
                db.refresh(paper)
                gaps_after = bibliographic_gaps(fields_from_paper(paper))
                if gaps_after != gaps_before:
                    recovered += 1
                    logger.info(f"   -> filled; remaining gaps: {gaps_after}")
                else:
                    unchanged += 1
                    logger.info("   -> no change")
            except Exception as e:
                errors += 1
                logger.error(f"   -> error: {e}", exc_info=True)

        elapsed = time.time() - start
        logger.info(
            f"Done in {elapsed / 60:.1f}m. "
            f"Recovered: {recovered}, Unchanged: {unchanged}, Errors: {errors}"
        )
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Backfill paper metadata via the agentic citation finder"
    )
    parser.add_argument("--limit", type=int, default=None, help="Max papers to process")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List candidates without calling external APIs or writing",
    )
    args = parser.parse_args()
    backfill(limit=args.limit, dry_run=args.dry_run)
