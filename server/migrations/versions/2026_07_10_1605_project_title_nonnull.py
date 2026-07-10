"""project title nonnull

Revision ID: c1ec0bdd6f34
Revises: 9919a3e385a0
Create Date: 2026-07-10 16:05:06.931204+00:00

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c1ec0bdd6f34"
down_revision: Union[str, None] = "9919a3e385a0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Name the untitled projects before the constraint can reject them.
    op.execute("UPDATE project SET title = 'Untitled' WHERE title IS NULL")
    op.alter_column("project", "title", existing_type=sa.String(), nullable=False)


def downgrade() -> None:
    """Downgrade schema."""
    # The backfilled 'Untitled' titles are left in place: they are
    # indistinguishable from titles a user actually chose.
    op.alter_column("project", "title", existing_type=sa.String(), nullable=True)
