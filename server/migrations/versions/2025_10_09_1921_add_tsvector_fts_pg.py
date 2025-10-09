"""add tsvector fts pg

Revision ID: 6dd9fa69fa45
Revises: c003d8a34483
Create Date: 2025-10-09 19:21:56.678821+00:00

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import TSVECTOR

# revision identifiers, used by Alembic.
revision: str = "6dd9fa69fa45"
down_revision: Union[str, None] = "c003d8a34483"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("papers", sa.Column("ts_vector", TSVECTOR(), nullable=True))
    op.create_index(
        "ix_papers_ts_vector",
        "papers",
        ["ts_vector"],
        unique=False,
        postgresql_using="gin",
    )

    trigger_function = sa.DDL(
        """
        CREATE OR REPLACE FUNCTION paper_content_trigger() RETURNS trigger AS $$
        BEGIN
            NEW.ts_vector :=
                setweight(to_tsvector('pg_catalog.english', coalesce(NEW.title,'')), 'A') ||
                setweight(to_tsvector('pg_catalog.english', coalesce(NEW.raw_content,'')), 'D');
            RETURN NEW;
        END
        $$ LANGUAGE plpgsql;
    """
    )
    op.execute(trigger_function)

    trigger = sa.DDL(
        """
        CREATE TRIGGER tsvectorupdate BEFORE INSERT OR UPDATE
        ON papers FOR EACH ROW EXECUTE PROCEDURE paper_content_trigger();
    """
    )
    op.execute(trigger)

    # Populate the ts_vector column for existing rows
    op.execute(
        "UPDATE papers SET ts_vector = setweight(to_tsvector('pg_catalog.english', coalesce(title,'')), 'A') || setweight(to_tsvector('pg_catalog.english', coalesce(raw_content,'')), 'D');"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP TRIGGER IF EXISTS tsvectorupdate ON papers;")
    op.execute("DROP FUNCTION IF EXISTS paper_content_trigger();")
    op.drop_index("ix_papers_ts_vector", table_name="papers")
    op.drop_column("papers", "ts_vector")
