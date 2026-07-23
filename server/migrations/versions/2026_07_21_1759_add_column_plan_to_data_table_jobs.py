"""add column_plan to data table jobs

Revision ID: db2d180b99c9
Revises: 31bf0479a454
Create Date: 2026-07-21 17:59:03.109866+00:00

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "db2d180b99c9"
down_revision: Union[str, None] = "31bf0479a454"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "data_table_extraction_jobs",
        sa.Column(
            "column_plan", postgresql.JSONB(astext_type=sa.Text()), nullable=True
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("data_table_extraction_jobs", "column_plan")
