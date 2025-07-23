"""conversation base

Revision ID: 410d489451b5
Revises: 3ea97371f5fc
Create Date: 2025-07-16 17:34:25.481430+00:00

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "410d489451b5"
down_revision: Union[str, None] = "3ea97371f5fc"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "conversations", sa.Column("conversable_id", sa.UUID(), nullable=True)
    )
    op.add_column(
        "conversations",
        sa.Column(
            "conversable_type", sa.String(), nullable=False, server_default="paper"
        ),
    )

    # Backfill the data for existing conversations
    op.execute(
        """
               UPDATE conversations SET conversable_id = paper_id,
               conversable_type = 'paper'
               WHERE paper_id IS NOT NULL;
               """
    )

    # The server_default is no longer needed after the backfill, so we remove it.
    op.alter_column("conversations", "conversable_type", server_default=None)

    # Add a check constraint to ensure conversable_id is only set when conversable_type is 'paper'
    op.create_check_constraint(
        "check_conversable_id_paper",
        "conversations",
        "conversable_type = 'paper' AND conversable_id IS NOT NULL OR conversable_type != 'paper'",
    )

    # Clean up the old column and constraint
    op.drop_constraint(
        "conversations_paper_id_fkey", "conversations", type_="foreignkey"
    )
    op.drop_column("conversations", "paper_id")


def downgrade() -> None:
    """Downgrade schema."""
    # Make the paper_id column non-nullable to start with, until we can safely repopulate paper_id from conversable_id
    op.add_column(
        "conversations",
        sa.Column("paper_id", sa.UUID(), autoincrement=False, nullable=True),
    )

    # Reset `paper_id` from `conversable_id` and `conversable_type`
    op.execute(
        """
    UPDATE conversations SET paper_id = conversable_id
    WHERE conversable_type = 'paper';
    """
    )

    op.drop_constraint("check_conversable_id_paper", "conversations", type_="check")

    # Drop any rows that are not `conversable_type = 'paper'`
    op.execute(
        """
    DELETE FROM conversations
    WHERE conversable_type != 'paper';
    """
    )

    op.alter_column("conversations", "paper_id", nullable=False)

    op.create_foreign_key(
        "conversations_paper_id_fkey",
        "conversations",
        "papers",
        ["paper_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_column("conversations", "conversable_type")
    op.drop_column("conversations", "conversable_id")
    # ### end Alembic commands ###
