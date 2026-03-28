"""add paper_passages table

Revision ID: a1b2c3d4e5f6
Revises: d557501d93ab
Create Date: 2026-03-18 12:00:00.000000+00:00

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import TSVECTOR

# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "d557501d93ab"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create paper_passages table with GIN index and tsvector trigger."""
    op.create_table(
        "paper_passages",
        sa.Column(
            "id",
            sa.BigInteger(),
            sa.Identity(always=True),
            primary_key=True,
        ),
        sa.Column(
            "paper_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("papers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("start_line", sa.Integer(), nullable=False),
        sa.Column("end_line", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("ts_vector", TSVECTOR(), nullable=True),
        sa.UniqueConstraint("paper_id", "start_line"),
    )

    op.create_index(
        "ix_paper_passages_ts_vector",
        "paper_passages",
        ["ts_vector"],
        postgresql_using="gin",
    )
    op.create_index(
        "ix_paper_passages_paper_id",
        "paper_passages",
        ["paper_id"],
    )

    # Create trigger function to auto-populate tsvector
    op.execute(
        """
        CREATE FUNCTION paper_passages_tsvector_trigger() RETURNS trigger AS $$
        BEGIN
            NEW.ts_vector := to_tsvector('pg_catalog.english', coalesce(NEW.content, ''));
            RETURN NEW;
        END
        $$ LANGUAGE plpgsql;
    """
    )

    op.execute(
        """
        CREATE TRIGGER paper_passages_tsvectorupdate
            BEFORE INSERT OR UPDATE ON paper_passages
            FOR EACH ROW EXECUTE PROCEDURE paper_passages_tsvector_trigger();
    """
    )


def downgrade() -> None:
    """Drop paper_passages table and related objects."""
    op.execute(
        "DROP TRIGGER IF EXISTS paper_passages_tsvectorupdate ON paper_passages;"
    )
    op.execute("DROP FUNCTION IF EXISTS paper_passages_tsvector_trigger();")
    op.drop_index("ix_paper_passages_ts_vector", table_name="paper_passages")
    op.drop_index("ix_paper_passages_paper_id", table_name="paper_passages")
    op.drop_table("paper_passages")
