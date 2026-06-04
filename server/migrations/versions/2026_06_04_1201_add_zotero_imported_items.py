"""add zotero imported items

Revision ID: e5f6a7b8c9d0
Revises: d4e8f1a2b3c5
Create Date: 2026-05-19 12:00:00.000000+00:00

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "e5f6a7b8c9d0"
down_revision: Union[str, None] = "d4e8f1a2b3c5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "zotero_imported_items",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("zotero_item_key", sa.String(), nullable=False),
        sa.Column("zotero_attachment_key", sa.String(), nullable=True),
        sa.Column("import_source", sa.String(), nullable=False),
        sa.Column("source_url", sa.String(), nullable=True),
        sa.Column("paper_id", sa.UUID(), nullable=True),
        sa.Column("upload_job_id", sa.UUID(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column(
            "annotations_payload",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column("error_message", sa.String(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["paper_id"], ["papers.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["upload_job_id"], ["paper_upload_jobs.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id", "zotero_item_key", name="uq_zotero_import_user_item"
        ),
    )
    op.create_index(
        op.f("ix_zotero_imported_items_upload_job_id"),
        "zotero_imported_items",
        ["upload_job_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_zotero_imported_items_upload_job_id"),
        table_name="zotero_imported_items",
    )
    op.drop_table("zotero_imported_items")
