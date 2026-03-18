"""
Backfill paper_passages table from existing papers.

Usage:
    python -m app.scripts.backfill_paper_passages [--batch-size 100] [--dry-run]
"""

import argparse
import logging
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../")))

from app.database.crud.paper_crud import paper_crud
from app.database.database import SessionLocal
from sqlalchemy import text

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


def backfill(batch_size: int = 100, dry_run: bool = False) -> None:
    db = SessionLocal()
    try:
        # Get total count of papers with raw_content
        total = db.execute(
            text("SELECT COUNT(*) FROM papers WHERE raw_content IS NOT NULL")
        ).scalar()
        logger.info(f"Found {total} papers with raw_content")

        offset = 0
        indexed = 0
        skipped = 0

        while offset < total:
            rows = db.execute(
                text(
                    """
                    SELECT id, raw_content
                    FROM papers
                    WHERE raw_content IS NOT NULL
                    ORDER BY id
                    LIMIT :limit OFFSET :offset
                """
                ),
                {"limit": batch_size, "offset": offset},
            ).fetchall()

            if not rows:
                break

            for paper_id, raw_content in rows:
                if dry_run:
                    passages = paper_crud.build_passages(raw_content)
                    logger.info(
                        f"[DRY RUN] Paper {paper_id}: would index {len(passages)} passages"
                    )
                    skipped += 1
                else:
                    paper_crud.index_paper_passages(
                        db, paper_id=paper_id, raw_content=raw_content
                    )
                    indexed += 1

            if not dry_run:
                db.commit()

            offset += batch_size
            logger.info(f"Progress: {offset}/{total}")

        logger.info(
            f"Backfill complete. Indexed: {indexed}, Skipped (dry-run): {skipped}"
        )
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Backfill paper_passages table")
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    backfill(batch_size=args.batch_size, dry_run=args.dry_run)
