"""add compute_provenance to data table results

Revision ID: fe91a3fb6b99
Revises: db2d180b99c9
Create Date: 2026-07-24 03:18:40.547171+00:00

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "fe91a3fb6b99"
down_revision: Union[str, None] = "db2d180b99c9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "data_table_extraction_results",
        sa.Column(
            "compute_provenance", postgresql.JSONB(astext_type=sa.Text()), nullable=True
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("data_table_extraction_results", "compute_provenance")
