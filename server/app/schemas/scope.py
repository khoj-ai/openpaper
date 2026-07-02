from __future__ import annotations

import enum
from typing import Callable, List, Optional

from pydantic import BaseModel


class ScopeType(str, enum.Enum):
    PAPER = "paper"
    PROJECT = "project"
    HIGHLIGHT = "highlight"
    COMMENT = "comment"


class ScopeItem(BaseModel):
    type: ScopeType
    id: str
    label: str

    def model_dump(self, **kwargs):
        d = super().model_dump(**kwargs)
        d["type"] = self.type.value
        return d


class MentionItem(BaseModel):
    type: ScopeType
    id: str
    label: str
    subtitle: Optional[str] = None


class MentionResult(BaseModel):
    papers: List[MentionItem] = []
    projects: List[MentionItem] = []
    highlights: List[MentionItem] = []
    comments: List[MentionItem] = []


def filter_papers_by_scope(
    all_papers: list,
    scope: Optional[List[dict]],
    get_project_papers_fn: Optional[Callable] = None,
) -> list:
    """Filter papers based on scope constraints.

    Supports paper IDs and project IDs. When projects are scoped, all
    papers belonging to those projects are included. Returns the full
    paper list when scope is empty/None (backward compatible).

    Args:
        all_papers: Full list of paper ORM objects.
        scope: List of scope item dicts with type/id/label.
        get_project_papers_fn: Optional callable that takes a project ID
            (as a string) and returns a list of papers. Required when
            scope includes projects.

    Returns:
        Filtered list of papers.
    """
    if not scope:
        return all_papers

    allowed_paper_ids: set = set()
    paper_ids_from_projects: set = set()

    for item in scope:
        try:
            parsed = ScopeItem.model_validate(item)
        except Exception:
            continue

        if parsed.type == ScopeType.PAPER:
            allowed_paper_ids.add(parsed.id)
        elif parsed.type == ScopeType.PROJECT and get_project_papers_fn:
            project_papers = get_project_papers_fn(parsed.id)
            for p in project_papers:
                paper_ids_from_projects.add(str(p.id))

    allowed_paper_ids |= paper_ids_from_projects

    if not allowed_paper_ids:
        return []

    return [p for p in all_papers if str(p.id) in allowed_paper_ids]
