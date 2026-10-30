"""index the passages of existing forks

Revision ID: bddc4c530ce4
Revises: e80732dedcab
Create Date: 2026-10-30 16:56:05.949224+00:00

"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "bddc4c530ce4"
down_revision: Union[str, None] = "e80732dedcab"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Index forks with no passages, in 5-line windows 3 lines apart.

    Forks are the papers without an upload job. parent_paper_id can't identify
    them: deleting the parent clears it. FOR KEY SHARE keeps a concurrent delete
    from failing this insert's foreign key check.
    """
    op.execute(
        r"""
        WITH unindexed AS (
            SELECT p.id, string_to_array(p.raw_content, E'\n') AS lines
            FROM papers p
            WHERE p.upload_job_id IS NULL
              AND p.raw_content IS NOT NULL
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
