"""add zotero sync fields

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-05-24 12:00:00.000000+00:00

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f6a7b8c9d0e1"
down_revision: Union[str, None] = "e5f6a7b8c9d0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "highlights",
        sa.Column("zotero_annotation_key", sa.String(), nullable=True),
    )
    op.create_index(
        "uq_highlight_paper_zotero_annotation_key",
        "highlights",
        ["paper_id", "zotero_annotation_key"],
        unique=True,
        postgresql_where=sa.text("zotero_annotation_key IS NOT NULL"),
    )
    op.add_column(
        "zotero_imported_items",
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("zotero_imported_items", "last_synced_at")
    op.drop_index(
        "uq_highlight_paper_zotero_annotation_key",
        table_name="highlights",
    )
    op.drop_column("highlights", "zotero_annotation_key")
