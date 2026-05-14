"""add project paper index

Revision ID: b7f5658668f6
Revises: c07332ef32e2
Create Date: 2026-05-14 20:48:20.183908+00:00

These join/association tables were created with only a primary key. Postgres
does not auto-index foreign keys, so the hot path for listing a project's
papers (the project access check + the project_paper lookup) was doing
sequential scans that degrade as these tables accumulate every user's rows.

Indexes are built with CREATE INDEX CONCURRENTLY so this is safe to run
against a populated production table without taking a long write lock.

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b7f5658668f6"
down_revision: Union[str, None] = "c07332ef32e2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.get_context().autocommit_block():
        op.create_index(
            "ix_project_paper_paper_id",
            "project_paper",
            ["paper_id"],
            unique=False,
            postgresql_concurrently=True,
            if_not_exists=True,
        )
        op.create_index(
            "ix_project_paper_project_id",
            "project_paper",
            ["project_id"],
            unique=False,
            postgresql_concurrently=True,
            if_not_exists=True,
        )
        op.create_index(
            "ix_project_role_project_id_user_id",
            "project_role",
            ["project_id", "user_id"],
            unique=False,
            postgresql_concurrently=True,
            if_not_exists=True,
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.drop_index(
            "ix_project_role_project_id_user_id",
            table_name="project_role",
            postgresql_concurrently=True,
            if_exists=True,
        )
        op.drop_index(
            "ix_project_paper_project_id",
            table_name="project_paper",
            postgresql_concurrently=True,
            if_exists=True,
        )
        op.drop_index(
            "ix_project_paper_paper_id",
            table_name="project_paper",
            postgresql_concurrently=True,
            if_exists=True,
        )
