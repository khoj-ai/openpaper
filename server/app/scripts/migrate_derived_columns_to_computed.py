"""
Migrate legacy derived-column plans to the computed-column format, so the
retired expression-calculator plan shape can be deprecated from the data
model.

Per data-table job whose column_plan still has legacy derived entries
({label, expression, inputs: {alias: column}}), rewrite each as a computed
entry ({label, kind: "computed", spec, inputs: [column labels]}). The spec is
a deterministic, faithful rendering of the old formula with its alias
bindings spelled out — precise enough for the compute agent to re-derive the
same computation if the table is ever recomputed.

Cell values are NOT touched: they were computed at a point in time and stay
exactly as generated, per-cell derivation blocks included (the UI keeps
rendering those).

Idempotent and resumable: jobs whose plans carry no "expression" entries are
skipped, so a re-run only touches what a previous run left behind.

Usage:
    uv run python -m app.scripts.migrate_derived_columns_to_computed --dry-run
    uv run python -m app.scripts.migrate_derived_columns_to_computed [--limit N] [--user-email X]
"""

import argparse
import logging
import os
import sys
from typing import cast

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../")))

from app.database.database import SessionLocal
from app.database.models import DataTableExtractionJob, User
from sqlalchemy import Text
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


def derived_entry_to_computed(entry: dict) -> dict:
    """Convert one legacy derived plan entry to the computed format.

    The spec is generated, not authored: the exact old formula plus which
    column each alias bound to. Anyone (human or compute agent) can reproduce
    the computation from it without guessing.
    """
    expression = (entry.get("expression") or "").strip()
    inputs_map = entry.get("inputs") or {}
    bindings = "; ".join(
        f'`{alias}` is the "{column}" column' for alias, column in inputs_map.items()
    )
    spec = f"The value of the formula `{expression}`, where {bindings}."
    return {
        "label": entry.get("label", ""),
        "kind": "computed",
        "spec": spec,
        "inputs": list(inputs_map.values()),
    }


def convert_plan(column_plan: list) -> tuple[list, list[dict]]:
    """Return (converted plan, the converted computed entries)."""
    converted_plan = []
    computed_entries = []
    for entry in column_plan:
        # Legacy derived entries carry an expression; kind may be "derived"
        # or absent (rows written before kinds existed).
        if entry.get("expression") and entry.get("kind") != "computed":
            computed = derived_entry_to_computed(entry)
            converted_plan.append(computed)
            computed_entries.append(computed)
        else:
            converted_plan.append(entry)
    return converted_plan, computed_entries


def _legacy_jobs(
    db: Session, limit: int | None, user_email: str | None
) -> list[DataTableExtractionJob]:
    q = (
        db.query(DataTableExtractionJob)
        .filter(DataTableExtractionJob.column_plan.isnot(None))
        .filter(DataTableExtractionJob.column_plan.cast(Text).like("%expression%"))
        .order_by(DataTableExtractionJob.created_at)
    )
    if user_email:
        q = q.join(User, User.id == DataTableExtractionJob.user_id).filter(
            User.email == user_email
        )
    if limit:
        q = q.limit(limit)
    return q.all()


def migrate(dry_run: bool, limit: int | None, user_email: str | None) -> None:
    db = SessionLocal()
    try:
        jobs = _legacy_jobs(db, limit, user_email)
        logger.info(f"Found {len(jobs)} job(s) with legacy derived plan entries")

        converted = failed = 0
        for job in jobs:
            # Old-style Column declarations type as Column[JSONB]; at runtime
            # this is the deserialized list.
            new_plan, computed_entries = convert_plan(cast(list, job.column_plan))
            if not computed_entries:
                continue
            logger.info(
                f"job {job.id} ({job.created_at:%Y-%m-%d}): converting "
                f"{len(computed_entries)} derived column(s)"
            )
            for entry in computed_entries:
                logger.info(f"  -> {entry['label']!r}: {entry['spec']}")
            if dry_run:
                continue

            try:
                setattr(job, "column_plan", new_plan)
                flag_modified(job, "column_plan")
                db.commit()
                converted += 1
            except Exception as e:
                db.rollback()
                failed += 1
                logger.error(f"  job {job.id} failed (rolled back): {e}", exc_info=True)

        logger.info(
            f"Done: {converted} plan(s) converted, {failed} failed"
            + (" (dry run — nothing written)" if dry_run else "")
        )
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run", action="store_true", help="Log what would change, write nothing"
    )
    parser.add_argument("--limit", type=int, default=None, help="Max jobs to touch")
    parser.add_argument(
        "--user-email", default=None, help="Only migrate tables owned by this user"
    )
    args = parser.parse_args()

    migrate(args.dry_run, args.limit, args.user_email)
