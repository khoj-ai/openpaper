"""index the passages of existing zotero imports

Revision ID: 9b8653fb667e
Revises: bddc4c530ce4
Create Date: 2026-10-30 17:07:09.696196+00:00

"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "9b8653fb667e"
down_revision: Union[str, None] = "bddc4c530ce4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Index Zotero imports with no passages, in 5-line windows 3 lines apart.

    FOR KEY SHARE keeps a concurrent delete from failing this insert's foreign
    key check.
    """
    op.execute(
        r"""
        WITH unindexed AS (
            SELECT p.id, string_to_array(p.raw_content, E'\n') AS lines
            FROM papers p
            WHERE p.raw_content IS NOT NULL
              AND EXISTS (
                SELECT 1 FROM zotero_imported_items z WHERE z.paper_id = p.id
              )
              AND NOT EXISTS (
                SELECT 1 FROM paper_passages pp WHERE pp.paper_id = p.id
              )
            FOR KEY SHARE OF p
        )
        INSERT INTO paper_passages (paper_id, start_line, end_line, content)
        SELECT
            u.id,
            start_line,
            LEAST(start_line + 4, cardinality(u.lines)),
            array_to_string(u.lines[start_line : start_line + 4], E'\n')
        FROM unindexed u, generate_series(1, cardinality(u.lines), 3) AS start_line
        ON CONFLICT (paper_id, start_line) DO NOTHING
        """
    )


def downgrade() -> None:
    """Keep the passages: they're correct for the schema either way."""
    pass
