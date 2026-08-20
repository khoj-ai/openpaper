"""chart jobs can come from a chat turn and plan for themselves

Charts took minutes inline, which held the whole chat turn before a word of the
answer appeared. Chat now queues a job instead, so a job needs to know the turn
that asked for it — that is how the finished chart lands back in the
conversation and gets a deep link — and needs to be allowed to arrive without a
plan, because chat has not planned yet when it queues.

Revision ID: db994ff97eea
Revises: e79fd911cb1e
Create Date: 2026-08-19 20:17:39.699882+00:00

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "db994ff97eea"
down_revision: Union[str, None] = "e79fd911cb1e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

FOREIGN_KEY = "fk_chart_generation_jobs_message_id"


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "chart_generation_jobs", sa.Column("message_id", sa.UUID(), nullable=True)
    )
    # Null means the composer raised it from a dialog; a plan arrives with those
    # and only with those.
    op.alter_column(
        "chart_generation_jobs",
        "plan",
        existing_type=postgresql.JSONB(astext_type=sa.Text()),
        nullable=True,
    )
    op.create_index(
        op.f("ix_chart_generation_jobs_message_id"),
        "chart_generation_jobs",
        ["message_id"],
        unique=False,
    )
    # Named, because autogenerate leaves this to Postgres and then the
    # downgrade has nothing to ask for by name.
    op.create_foreign_key(
        FOREIGN_KEY,
        "chart_generation_jobs",
        "messages",
        ["message_id"],
        ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(FOREIGN_KEY, "chart_generation_jobs", type_="foreignkey")
    op.drop_index(
        op.f("ix_chart_generation_jobs_message_id"),
        table_name="chart_generation_jobs",
    )
    # Jobs raised from chat never had a plan of their own, and the older schema
    # has no way to hold one. They go rather than block the downgrade.
    op.execute("DELETE FROM chart_generation_jobs WHERE plan IS NULL")
    op.alter_column(
        "chart_generation_jobs",
        "plan",
        existing_type=postgresql.JSONB(astext_type=sa.Text()),
        nullable=False,
    )
    op.drop_column("chart_generation_jobs", "message_id")
