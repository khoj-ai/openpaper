import unittest
from unittest.mock import MagicMock
from uuid import uuid4

from app.schemas.scope import MentionItem, MentionResult, ScopeItem, ScopeType


class TestScopeItem(unittest.TestCase):
    def test_scope_item_creation_paper(self) -> None:
        item = ScopeItem(type=ScopeType.PAPER, id="paper-123", label="Transformers")
        self.assertEqual(item.type, ScopeType.PAPER)
        self.assertEqual(item.id, "paper-123")
        self.assertEqual(item.label, "Transformers")

    def test_scope_item_creation_project(self) -> None:
        item = ScopeItem(type=ScopeType.PROJECT, id="proj-456", label="NLP Papers")
        self.assertEqual(item.type, ScopeType.PROJECT)
        self.assertEqual(item.id, "proj-456")
        self.assertEqual(item.label, "NLP Papers")

    def test_scope_item_model_dump_returns_type_value(self) -> None:
        item = ScopeItem(type=ScopeType.PAPER, id="p1", label="Paper 1")
        dumped = item.model_dump()
        self.assertEqual(dumped["type"], "paper")
        self.assertEqual(dumped["id"], "p1")
        self.assertEqual(dumped["label"], "Paper 1")


class TestScopeType(unittest.TestCase):
    def test_all_enum_values_present(self) -> None:
        values = {e.value for e in ScopeType}
        self.assertIn("paper", values)
        self.assertIn("project", values)
        self.assertIn("highlight", values)
        self.assertIn("comment", values)

    def test_scope_type_from_string(self) -> None:
        self.assertEqual(ScopeType("paper"), ScopeType.PAPER)
        self.assertEqual(ScopeType("project"), ScopeType.PROJECT)
        self.assertEqual(ScopeType("highlight"), ScopeType.HIGHLIGHT)
        self.assertEqual(ScopeType("comment"), ScopeType.COMMENT)

    def test_invalid_scope_type_raises(self) -> None:
        with self.assertRaises(ValueError):
            ScopeType("invalid_type")


class TestMentionItem(unittest.TestCase):
    def test_mention_item_with_subtitle(self) -> None:
        item = MentionItem(
            type=ScopeType.PAPER,
            id="p1",
            label="Attention Is All You Need",
            subtitle="Vaswani et al.",
        )
        self.assertEqual(item.subtitle, "Vaswani et al.")

    def test_mention_item_without_subtitle(self) -> None:
        item = MentionItem(
            type=ScopeType.PROJECT,
            id="proj-1",
            label="My Project",
        )
        self.assertIsNone(item.subtitle)


class TestMentionResult(unittest.TestCase):
    def test_empty_result(self) -> None:
        result = MentionResult()
        self.assertEqual(result.papers, [])
        self.assertEqual(result.projects, [])
        self.assertEqual(result.highlights, [])
        self.assertEqual(result.comments, [])

    def test_result_with_papers_and_projects(self) -> None:
        paper = MentionItem(type=ScopeType.PAPER, id="p1", label="Paper 1")
        project = MentionItem(type=ScopeType.PROJECT, id="proj-1", label="Project 1")
        result = MentionResult(papers=[paper], projects=[project])
        self.assertEqual(len(result.papers), 1)
        self.assertEqual(len(result.projects), 1)
        self.assertEqual(result.papers[0].label, "Paper 1")
        self.assertEqual(result.projects[0].label, "Project 1")

    def test_result_model_dump(self) -> None:
        paper = MentionItem(type=ScopeType.PAPER, id="p1", label="Paper 1")
        result = MentionResult(papers=[paper])
        dumped = result.model_dump()
        self.assertEqual(dumped["papers"][0]["type"], "paper")
        self.assertEqual(dumped["projects"], [])
        self.assertEqual(dumped["highlights"], [])
        self.assertEqual(dumped["comments"], [])


class TestScopeFiltering(unittest.TestCase):
    def setUp(self) -> None:
        self.paper_a_id = str(uuid4())
        self.paper_b_id = str(uuid4())
        self.paper_c_id = str(uuid4())
        self.project_id = str(uuid4())

        self.mock_paper_a = MagicMock()
        self.mock_paper_a.id = self.paper_a_id
        self.mock_paper_b = MagicMock()
        self.mock_paper_b.id = self.paper_b_id
        self.mock_paper_c = MagicMock()
        self.mock_paper_c.id = self.paper_c_id

        self.all_papers = [self.mock_paper_a, self.mock_paper_b, self.mock_paper_c]

    def test_filter_by_paper_ids(self) -> None:
        """Filtering by paper IDs returns only matching papers."""
        scope = [
            {"type": "paper", "id": self.paper_a_id, "label": "Paper A"},
            {"type": "paper", "id": self.paper_c_id, "label": "Paper C"},
        ]
        from app.schemas.scope import filter_papers_by_scope

        filtered = filter_papers_by_scope(self.all_papers, scope)
        self.assertEqual(len(filtered), 2)
        self.assertIn(self.mock_paper_a, filtered)
        self.assertIn(self.mock_paper_c, filtered)
        self.assertNotIn(self.mock_paper_b, filtered)

    def test_filter_no_scope_returns_all(self) -> None:
        """When scope is None or empty, all papers are returned."""
        from app.schemas.scope import filter_papers_by_scope

        filtered = filter_papers_by_scope(self.all_papers, None)
        self.assertEqual(len(filtered), 3)

        filtered = filter_papers_by_scope(self.all_papers, [])
        self.assertEqual(len(filtered), 3)

    def test_filter_by_project(self) -> None:
        """Filtering by project returns papers belonging to that project."""
        def get_project_papers(project_id: str) -> list:
            return [self.mock_paper_a, self.mock_paper_b]

        scope = [
            {"type": "project", "id": self.project_id, "label": "My Project"},
        ]
        from app.schemas.scope import filter_papers_by_scope

        filtered = filter_papers_by_scope(
            self.all_papers, scope, get_project_papers_fn=get_project_papers
        )
        self.assertEqual(len(filtered), 2)
        self.assertIn(self.mock_paper_a, filtered)
        self.assertIn(self.mock_paper_b, filtered)
        self.assertNotIn(self.mock_paper_c, filtered)

    def test_filter_by_paper_and_project_union(self) -> None:
        """Filtering by both paper and project takes the union."""
        def get_project_papers(project_id: str) -> list:
            return [self.mock_paper_b]

        scope = [
            {"type": "paper", "id": self.paper_a_id, "label": "Paper A"},
            {"type": "project", "id": self.project_id, "label": "My Project"},
        ]
        from app.schemas.scope import filter_papers_by_scope

        filtered = filter_papers_by_scope(
            self.all_papers, scope, get_project_papers_fn=get_project_papers
        )
        self.assertEqual(len(filtered), 2)
        self.assertIn(self.mock_paper_a, filtered)
        self.assertIn(self.mock_paper_b, filtered)
        self.assertNotIn(self.mock_paper_c, filtered)

    def test_empty_scope_returns_empty_list(self) -> None:
        """When scope contains only non-existent IDs, return empty list."""
        scope = [
            {"type": "paper", "id": str(uuid4()), "label": "Non-existent"},
        ]
        from app.schemas.scope import filter_papers_by_scope

        filtered = filter_papers_by_scope(self.all_papers, scope)
        self.assertEqual(len(filtered), 0)

    def test_invalid_scope_item_skipped(self) -> None:
        """Invalid scope items (missing fields) are skipped gracefully."""
        scope = [
            {"type": "paper", "id": self.paper_a_id, "label": "Paper A"},
            {"type": "invalid_type", "id": "x", "label": "Invalid"},
            {"id": "y"},  # missing type
        ]
        from app.schemas.scope import filter_papers_by_scope

        filtered = filter_papers_by_scope(self.all_papers, scope)
        # Only the valid paper scope should apply
        self.assertEqual(len(filtered), 1)
        self.assertIn(self.mock_paper_a, filtered)


if __name__ == "__main__":
    unittest.main()
