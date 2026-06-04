"""add zotero auto_import_since

Revision ID: 202606041203
Revises: 2026060100001
Create Date: 2026-06-04 12:03:00.000000+00:00

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "202606041203"
down_revision: Union[str, None] = "2026060100001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "zotero_connections",
        sa.Column("auto_import_since", sa.DateTime(timezone=True), nullable=True),
    )
    # Existing users who already imported: window starts at latest import row time.
    op.execute("""
        UPDATE zotero_connections c
        SET auto_import_since = sub.max_created
        FROM (
            SELECT user_id, MAX(created_at) AS max_created
            FROM zotero_imported_items
            WHERE status = 'completed'
            GROUP BY user_id
        ) sub
        WHERE c.user_id = sub.user_id AND c.auto_import_since IS NULL
    """)


def downgrade() -> None:
    op.drop_column("zotero_connections", "auto_import_since")
