"""rename Document > Paper

Revision ID: e70660c9cdeb
Revises: 4a6c47ad2180
Create Date: 2025-04-25 01:07:32.048237+00:00

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "e70660c9cdeb"
down_revision: Union[str, None] = "4a6c47ad2180"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Rename the main table
    op.rename_table("documents", "papers")

    # Rename foreign key columns in related tables
    op.alter_column("annotations", "document_id", new_column_name="paper_id")
    op.alter_column("conversations", "document_id", new_column_name="paper_id")
    op.alter_column("highlights", "document_id", new_column_name="paper_id")
    op.alter_column("paper_notes", "document_id", new_column_name="paper_id")

    # Drop and recreate foreign key constraints with new names
    # Annotations
    op.drop_constraint(
        "annotations_document_id_fkey", "annotations", type_="foreignkey"
    )
    op.create_foreign_key(
        "annotations_paper_id_fkey",
        "annotations",
        "papers",
        ["paper_id"],
        ["id"],
        ondelete="CASCADE",
    )

    # Conversations
    op.drop_constraint(
        "conversations_document_id_fkey", "conversations", type_="foreignkey"
    )
    op.create_foreign_key(
        "conversations_paper_id_fkey",
        "conversations",
        "papers",
        ["paper_id"],
        ["id"],
        ondelete="CASCADE",
    )

    # Highlights
    op.drop_constraint("highlights_document_id_fkey", "highlights", type_="foreignkey")
    op.create_foreign_key(
        "highlights_paper_id_fkey",
        "highlights",
        "papers",
        ["paper_id"],
        ["id"],
        ondelete="CASCADE",
    )

    # Paper notes
    op.drop_constraint("paper_notes_document_id_key", "paper_notes", type_="unique")
    op.drop_constraint(
        "paper_notes_document_id_fkey", "paper_notes", type_="foreignkey"
    )
    op.create_unique_constraint("paper_notes_paper_id_key", "paper_notes", ["paper_id"])
    op.create_foreign_key(
        "paper_notes_paper_id_fkey",
        "paper_notes",
        "papers",
        ["paper_id"],
        ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    """Downgrade schema."""
    # Rename foreign key columns back in related tables
    op.alter_column("annotations", "paper_id", new_column_name="document_id")
    op.alter_column("conversations", "paper_id", new_column_name="document_id")
    op.alter_column("highlights", "paper_id", new_column_name="document_id")
    op.alter_column("paper_notes", "paper_id", new_column_name="document_id")

    # Drop and recreate foreign key constraints with original names
    # Annotations
    op.drop_constraint("annotations_paper_id_fkey", "annotations", type_="foreignkey")
    op.create_foreign_key(
        "annotations_document_id_fkey",
        "annotations",
        "documents",
        ["document_id"],
        ["id"],
        ondelete="CASCADE",
    )

    # Conversations
    op.drop_constraint(
        "conversations_paper_id_fkey", "conversations", type_="foreignkey"
    )
    op.create_foreign_key(
        "conversations_document_id_fkey",
        "conversations",
        "documents",
        ["document_id"],
        ["id"],
        ondelete="CASCADE",
    )

    # Highlights
    op.drop_constraint("highlights_paper_id_fkey", "highlights", type_="foreignkey")
    op.create_foreign_key(
        "highlights_document_id_fkey",
        "highlights",
        "documents",
        ["document_id"],
        ["id"],
        ondelete="CASCADE",
    )

    # Paper notes
    op.drop_constraint("paper_notes_paper_id_key", "paper_notes", type_="unique")
    op.drop_constraint("paper_notes_paper_id_fkey", "paper_notes", type_="foreignkey")
    op.create_unique_constraint(
        "paper_notes_document_id_key", "paper_notes", ["document_id"]
    )
    op.create_foreign_key(
        "paper_notes_document_id_fkey",
        "paper_notes",
        "documents",
        ["document_id"],
        ["id"],
        ondelete="CASCADE",
    )

    # Rename the main table back
    op.rename_table("papers", "documents")
