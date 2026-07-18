"""fix conversable check constraint

The check_conversable_consistency constraint existed only in the model — no
migration ever installed it, and its definition omitted 'project' (which is why
project conversations, which violate it as written, insert fine). Install the
corrected definition that permits project conversations.

Revision ID: 31bf0479a454
Revises: 9919a3e385a0
Create Date: 2026-07-18 00:15:02.675393+00:00

"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "31bf0479a454"
down_revision: Union[str, None] = "9919a3e385a0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CONSTRAINT_NAME = "check_conversable_consistency"

CONSTRAINT_CONDITION = (
    "(conversable_type = 'paper' AND conversable_id IS NOT NULL) OR "
    "(conversable_type = 'project' AND conversable_id IS NOT NULL) OR "
    "(conversable_type = 'everything' AND conversable_id IS NULL)"
)


def upgrade() -> None:
    """Upgrade schema."""
    # Drop-if-exists covers environments where the table was created straight
    # from the models (create_all) and so carries the stale definition.
    op.execute(f"ALTER TABLE conversations DROP CONSTRAINT IF EXISTS {CONSTRAINT_NAME}")
    op.create_check_constraint(
        CONSTRAINT_NAME,
        "conversations",
        CONSTRAINT_CONDITION,
    )


def downgrade() -> None:
    """Downgrade schema."""
    # Restore the pre-migration DB state: no constraint (it only ever lived in
    # the model). Reinstating the stale paper/everything-only definition would
    # break existing project conversations.
    op.drop_constraint(CONSTRAINT_NAME, "conversations", type_="check")
