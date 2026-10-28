"""paper upload jobs record why they failed

Revision ID: e80732dedcab
Revises: 8c89f2444587
Create Date: 2026-10-28 18:00:57.947261+00:00

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e80732dedcab"
down_revision: Union[str, None] = "8c89f2444587"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "paper_upload_jobs", sa.Column("error_message", sa.String(), nullable=True)
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("paper_upload_jobs", "error_message")
