"""paper store summary citations

Revision ID: 4c8dd22b9782
Revises: 14609a4c3aff
Create Date: 2025-06-17 21:50:49.654752+00:00

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "4c8dd22b9782"
down_revision: Union[str, None] = "14609a4c3aff"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # ### commands auto generated by Alembic - please adjust! ###
    op.add_column(
        "papers",
        sa.Column(
            "summary_citations", postgresql.JSONB(astext_type=sa.Text()), nullable=True
        ),
    )
    # ### end Alembic commands ###


def downgrade() -> None:
    """Downgrade schema."""
    # ### commands auto generated by Alembic - please adjust! ###
    op.drop_column("papers", "summary_citations")
    # ### end Alembic commands ###
