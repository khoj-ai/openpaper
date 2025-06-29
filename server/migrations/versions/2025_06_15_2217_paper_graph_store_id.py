"""paper graph store id

Revision ID: 14609a4c3aff
Revises: 3e0f601dfe87
Create Date: 2025-06-15 22:17:13.119309+00:00

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "14609a4c3aff"
down_revision: Union[str, None] = "3e0f601dfe87"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # ### commands auto generated by Alembic - please adjust! ###
    op.add_column("papers", sa.Column("doi", sa.String(), nullable=True))
    op.add_column("papers", sa.Column("open_alex_id", sa.String(), nullable=True))
    # ### end Alembic commands ###


def downgrade() -> None:
    """Downgrade schema."""
    # ### commands auto generated by Alembic - please adjust! ###
    op.drop_column("papers", "open_alex_id")
    op.drop_column("papers", "doi")
    # ### end Alembic commands ###
