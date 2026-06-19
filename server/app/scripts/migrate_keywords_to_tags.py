"""
Migrate existing papers' extracted keywords into user tags.

For every paper that has keywords, each keyword becomes a tag owned by the
paper's user. Matching is case-insensitive and trimmed, so a keyword that
matches a tag the user already has is reused rather than duplicated. After the
tags are applied, the paper's ``keywords`` array is cleared so the data lives
only on the tags (destructive).

Idempotent: re-running is a no-op since migrated papers no longer have
keywords. Tag application itself only adds missing associations.

Usage:
    python -m app.scripts.migrate_keywords_to_tags [--batch-size 200] [--limit N] [--dry-run]
"""

import argparse
import logging
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../")))

from app.database.crud.paper_tag_crud import paper_tag_crud
from app.database.database import SessionLocal
from app.database.models import Paper
from sqlalchemy import func

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


def migrate(
    batch_size: int = 200, limit: int | None = None, dry_run: bool = False
) -> None:
    db = SessionLocal()
    try:
        base = (
            db.query(Paper.id, Paper.user_id, Paper.keywords)
            .filter(
                Paper.keywords.isnot(None),
                func.coalesce(func.array_length(Paper.keywords, 1), 0) > 0,
                Paper.user_id.isnot(None),
            )
            .order_by(Paper.id)
        )

        total = base.count()
        if limit is not None:
            total = min(total, limit)
        logger.info(
            "Found %d papers with keywords to migrate%s",
            total,
            " (dry run)" if dry_run else "",
        )

        processed = 0
        papers_tagged = 0
        papers_cleared = 0
        associations_created = 0
        errors = 0
        last_id = None

        while True:
            if limit is not None and processed >= limit:
                break
            page = batch_size
            if limit is not None:
                page = min(batch_size, limit - processed)

            # Keyset pagination on id: real runs clear keywords, so processed
            # papers drop out of the filter and offset paging would skip rows.
            query = base
            if last_id is not None:
                query = query.filter(Paper.id > last_id)
            rows = query.limit(page).all()
            if not rows:
                break

            for paper_id, user_id, keywords in rows:
                try:
                    created = paper_tag_crud.apply_keyword_tags(
                        db,
                        paper_id=paper_id,
                        keywords=keywords or [],
                        user_id=user_id,
                        commit=False,
                    )
                    # Tags now carry the keyword data; drop them from the paper.
                    db.query(Paper).filter(Paper.id == paper_id).update(
                        {Paper.keywords: None}, synchronize_session=False
                    )
                    if dry_run:
                        db.rollback()
                    else:
                        db.commit()
                    associations_created += created
                    papers_cleared += 1
                    if created > 0:
                        papers_tagged += 1
                except Exception as e:
                    db.rollback()
                    errors += 1
                    logger.error("Failed to migrate paper %s: %s", paper_id, e)

            processed += len(rows)
            last_id = rows[-1][0]
            logger.info(
                "Progress: %d/%d papers processed (%d tagged, %d cleared, %d associations, %d errors)",
                processed,
                total,
                papers_tagged,
                papers_cleared,
                associations_created,
                errors,
            )

        logger.info(
            "Done. Processed %d papers; %d gained tags; %d %s keywords cleared; "
            "%d associations %s; %d errors.",
            processed,
            papers_tagged,
            papers_cleared,
            "would have" if dry_run else "had",
            associations_created,
            "would be created" if dry_run else "created",
            errors,
        )
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Migrate paper keywords into reusable user tags."
    )
    parser.add_argument("--batch-size", type=int, default=200)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    migrate(batch_size=args.batch_size, limit=args.limit, dry_run=args.dry_run)
