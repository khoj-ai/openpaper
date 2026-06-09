import asyncio
import unittest
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from app.database.models import ZoteroImportSource, ZoteroImportStatus
from app.helpers.paper_search import normalize_doi
from app.services import zotero_import as zotero_import_module
from app.services.zotero_import import (
    _discover_import_candidates,
    _link_zotero_item_to_existing_paper,
    import_batch,
)


class TestNormalizeDoi(unittest.TestCase):
    def test_bare_doi(self) -> None:
        self.assertEqual(normalize_doi("10.1234/abc"), "10.1234/abc")

    def test_doi_url(self) -> None:
        self.assertEqual(
            normalize_doi("https://doi.org/10.1234/abc"),
            "10.1234/abc",
        )

    def test_doi_prefix(self) -> None:
        self.assertEqual(normalize_doi("doi:10.1234/abc"), "10.1234/abc")

    def test_empty(self) -> None:
        self.assertIsNone(normalize_doi(None))
        self.assertIsNone(normalize_doi(""))
        self.assertIsNone(normalize_doi("   "))


class TestLinkZoteroItemToExistingPaper(unittest.IsolatedAsyncioTestCase):
    @patch.object(zotero_import_module, "_sync_item")
    @patch.object(zotero_import_module, "zotero_import_crud")
    @patch.object(
        zotero_import_module,
        "_resolve_zotero_attachment_info",
        return_value=(
            ZoteroImportSource.PDF_ATTACHMENT,
            "ATT1",
            None,
            [{"key": "ANN1", "data": {"annotationText": "hello"}}],
        ),
    )
    async def test_creates_import_row_and_syncs_annotations(
        self,
        mock_resolve: MagicMock,
        mock_import_crud: MagicMock,
        mock_sync_item: MagicMock,
    ) -> None:
        user = MagicMock()
        user.id = uuid4()
        paper = MagicMock()
        paper.id = uuid4()
        import_row = MagicMock()
        mock_import_crud.create.return_value = import_row
        client = MagicMock()
        item = {"key": "ITEM2", "data": {"title": "Paper", "DOI": "10.1234/x"}}

        await _link_zotero_item_to_existing_paper(
            MagicMock(),
            client=client,
            item=item,
            item_key="ITEM2",
            paper=paper,
            user=user,
        )

        mock_import_crud.create.assert_called_once()
        create_kwargs = mock_import_crud.create.call_args.kwargs
        self.assertEqual(create_kwargs["zotero_item_key"], "ITEM2")
        self.assertEqual(create_kwargs["paper_id"], paper.id)
        self.assertEqual(create_kwargs["status"], ZoteroImportStatus.COMPLETED)
        mock_sync_item.assert_called_once()


# Shared decorator stack for tests that exercise the full _import_one_paper
# hand-off to the jobs service. import_batch now resolves the requested item
# keys via _discover_candidates_by_keys, uploads each PDF, creates the paper with
# Zotero metadata, and submits a lightweight (LLM-skipped) job to the worker — so
# the deterministic preview/text extraction lives in the jobs service, not here.
def _patch_import_pipeline(fn):
    # Applied innermost-first, so decorators[0] binds to the first method param.
    # Order here mirrors the test method signatures below.
    decorators = [
        patch.object(
            zotero_import_module.jobs_client,
            "submit_pdf_processing_job",
            return_value="task-123",
        ),
        patch.object(
            zotero_import_module,
            "_upload_pdf_to_s3",
            return_value=("key", "https://example.com/file.pdf"),
        ),
        patch.object(zotero_import_module, "_apply_zotero_tags"),
        patch.object(zotero_import_module, "paper_upload_job_crud"),
        patch.object(zotero_import_module, "paper_crud"),
        patch.object(zotero_import_module, "zotero_import_crud"),
        patch.object(zotero_import_module, "zotero_crud"),
        patch.object(zotero_import_module, "ZoteroApiClient"),
        patch.object(
            zotero_import_module,
            "_compute_max_new_imports",
            return_value=(50, None),
        ),
        patch.object(
            zotero_import_module,
            "_resolve_pdf_bytes",
            new_callable=AsyncMock,
            return_value=(
                b"%PDF",
                ZoteroImportSource.PDF_ATTACHMENT,
                "ATT1",
                None,
                [],
                None,
            ),
        ),
        patch.object(
            zotero_import_module,
            "_link_zotero_item_to_existing_paper",
            new_callable=AsyncMock,
        ),
    ]
    for decorator in decorators:
        fn = decorator(fn)
    return fn


class _ImportPipelineHelpers:
    """Wire up the mocks injected by _patch_import_pipeline into a coherent state."""

    def _configure_mocks(
        self,
        *,
        mock_zotero_crud: MagicMock,
        mock_import_crud: MagicMock,
        mock_paper_crud: MagicMock,
        mock_upload_job_crud: MagicMock,
        mock_client_cls: MagicMock,
        items: list,
    ) -> tuple[MagicMock, MagicMock, MagicMock]:
        user = MagicMock()
        user.id = uuid4()
        mock_zotero_crud.get_by_user_id.return_value = MagicMock(
            zotero_user_id="1", api_key="key"
        )
        mock_import_crud.get_by_item_key.return_value = None

        paper = MagicMock()
        paper.id = uuid4()
        mock_paper_crud.create.return_value = paper
        mock_paper_crud.get.return_value = paper

        upload_job = MagicMock()
        upload_job.id = uuid4()
        mock_upload_job_crud.create.return_value = upload_job

        client = MagicMock()
        mock_client_cls.return_value = client
        client.get_items_by_keys.return_value = items

        return user, paper, client


class TestImportBatchDoiDedup(unittest.IsolatedAsyncioTestCase, _ImportPipelineHelpers):
    def _make_item(self, key: str, doi: str | None = "10.1234/attention") -> dict:
        data: dict = {
            "title": "Attention Is All You Need",
            "itemType": "journalArticle",
        }
        if doi is not None:
            data["DOI"] = doi
        return {"key": key, "data": data}

    @patch.object(
        zotero_import_module,
        "_compute_max_new_imports",
        return_value=(50, None),
    )
    @patch.object(
        zotero_import_module,
        "_link_zotero_item_to_existing_paper",
        new_callable=AsyncMock,
    )
    @patch.object(zotero_import_module, "paper_crud")
    @patch.object(zotero_import_module, "zotero_import_crud")
    @patch.object(zotero_import_module, "zotero_crud")
    @patch.object(zotero_import_module, "ZoteroApiClient")
    async def test_skips_when_doi_matches_existing_paper(
        self,
        mock_client_cls: MagicMock,
        mock_zotero_crud: MagicMock,
        mock_import_crud: MagicMock,
        mock_paper_crud: MagicMock,
        mock_link: AsyncMock,
        mock_max_new: MagicMock,
    ) -> None:
        user = MagicMock()
        user.id = uuid4()
        mock_zotero_crud.get_by_user_id.return_value = MagicMock(
            zotero_user_id="1", api_key="key"
        )
        mock_import_crud.get_by_item_key.return_value = None

        existing_paper = MagicMock()
        existing_paper.id = uuid4()
        mock_paper_crud.get_by_doi_for_user.return_value = existing_paper

        client = MagicMock()
        mock_client_cls.return_value = client
        client.get_items_by_keys.return_value = [self._make_item("ITEM2")]

        result = await import_batch(MagicMock(), user=user, item_keys=["ITEM2"])

        self.assertEqual(result["skipped_already_imported"], 1)
        self.assertEqual(result["imported_count"], 0)
        mock_link.assert_awaited_once()

    @_patch_import_pipeline
    async def test_second_duplicate_doi_in_batch_links_to_first_paper(
        self,
        mock_submit_job: MagicMock,
        mock_upload_pdf: MagicMock,
        mock_tags: MagicMock,
        mock_upload_job_crud: MagicMock,
        mock_paper_crud: MagicMock,
        mock_import_crud: MagicMock,
        mock_zotero_crud: MagicMock,
        mock_client_cls: MagicMock,
        mock_max_new: MagicMock,
        mock_resolve_pdf: AsyncMock,
        mock_link: AsyncMock,
    ) -> None:
        mock_paper_crud.get_by_doi_for_user.return_value = None

        user, paper, _ = self._configure_mocks(
            mock_zotero_crud=mock_zotero_crud,
            mock_import_crud=mock_import_crud,
            mock_paper_crud=mock_paper_crud,
            mock_upload_job_crud=mock_upload_job_crud,
            mock_client_cls=mock_client_cls,
            items=[self._make_item("ITEM1"), self._make_item("ITEM2")],
        )

        result = await import_batch(
            MagicMock(), user=user, item_keys=["ITEM1", "ITEM2"]
        )

        self.assertEqual(result["imported_count"], 1)
        self.assertEqual(result["skipped_already_imported"], 1)
        mock_submit_job.assert_called_once()
        mock_link.assert_awaited_once()
        link_kwargs = mock_link.await_args.kwargs
        self.assertEqual(link_kwargs["paper"], paper)

    @_patch_import_pipeline
    async def test_item_without_doi_still_imports(
        self,
        mock_submit_job: MagicMock,
        mock_upload_pdf: MagicMock,
        mock_tags: MagicMock,
        mock_upload_job_crud: MagicMock,
        mock_paper_crud: MagicMock,
        mock_import_crud: MagicMock,
        mock_zotero_crud: MagicMock,
        mock_client_cls: MagicMock,
        mock_max_new: MagicMock,
        mock_resolve_pdf: AsyncMock,
        mock_link: AsyncMock,
    ) -> None:
        user, _, _ = self._configure_mocks(
            mock_zotero_crud=mock_zotero_crud,
            mock_import_crud=mock_import_crud,
            mock_paper_crud=mock_paper_crud,
            mock_upload_job_crud=mock_upload_job_crud,
            mock_client_cls=mock_client_cls,
            items=[self._make_item("ITEM1", doi=None)],
        )

        result = await import_batch(MagicMock(), user=user, item_keys=["ITEM1"])

        self.assertEqual(result["imported_count"], 1)
        self.assertEqual(result["skipped_already_imported"], 0)
        mock_submit_job.assert_called_once()
        mock_paper_crud.get_by_doi_for_user.assert_not_called()


class TestImportBatchNoTitleDedup(
    unittest.IsolatedAsyncioTestCase, _ImportPipelineHelpers
):
    """Title-based dedup was intentionally dropped: zotero_item_key handles
    re-imports and DOI handles genuine duplicates. Two same-title items without a
    matching DOI should both import rather than being silently collapsed."""

    TITLE = "Attention Is All You Need"

    def _make_item(self, key: str) -> dict:
        return {
            "key": key,
            "data": {"title": self.TITLE, "itemType": "journalArticle"},
        }

    @_patch_import_pipeline
    async def test_same_title_without_doi_imports_both(
        self,
        mock_submit_job: MagicMock,
        mock_upload_pdf: MagicMock,
        mock_tags: MagicMock,
        mock_upload_job_crud: MagicMock,
        mock_paper_crud: MagicMock,
        mock_import_crud: MagicMock,
        mock_zotero_crud: MagicMock,
        mock_client_cls: MagicMock,
        mock_max_new: MagicMock,
        mock_resolve_pdf: AsyncMock,
        mock_link: AsyncMock,
    ) -> None:
        mock_paper_crud.get_by_doi_for_user.return_value = None

        user, _, _ = self._configure_mocks(
            mock_zotero_crud=mock_zotero_crud,
            mock_import_crud=mock_import_crud,
            mock_paper_crud=mock_paper_crud,
            mock_upload_job_crud=mock_upload_job_crud,
            mock_client_cls=mock_client_cls,
            items=[self._make_item("ITEM1"), self._make_item("ITEM2")],
        )

        result = await import_batch(
            MagicMock(), user=user, item_keys=["ITEM1", "ITEM2"]
        )

        self.assertEqual(result["imported_count"], 2)
        self.assertEqual(result["skipped_already_imported"], 0)
        self.assertEqual(mock_submit_job.call_count, 2)
        mock_link.assert_not_awaited()


class TestDiscoverImportCandidates(unittest.IsolatedAsyncioTestCase):
    def _make_item(self, key: str) -> dict:
        return {
            "key": key,
            "data": {
                "title": f"Paper {key}",
                "itemType": "journalArticle",
            },
        }

    @patch.object(
        zotero_import_module, "_compute_max_new_imports", return_value=(1, None)
    )
    @patch.object(zotero_import_module, "zotero_import_crud")
    @patch.object(zotero_import_module, "paper_crud")
    async def test_caps_candidates_at_upload_slots(
        self,
        mock_paper_crud: MagicMock,
        mock_import_crud: MagicMock,
        mock_max_new: MagicMock,
    ) -> None:
        user = MagicMock()
        user.id = uuid4()
        mock_import_crud.get_by_item_key.return_value = None
        mock_paper_crud.get_by_doi_for_user.return_value = None
        mock_paper_crud.get_by_normalized_title_for_user.return_value = None

        client = MagicMock()
        client.get_top_importable_items.side_effect = [
            [self._make_item("A"), self._make_item("B")],
            [],
        ]

        candidates, deferred, skipped, errors = await _discover_import_candidates(
            MagicMock(),
            client=client,
            user=user,
            limit=50,
        )

        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0]["key"], "A")
        self.assertEqual(deferred, [])
        self.assertEqual(skipped, 0)
        self.assertEqual(errors, [])


class TestImportBatchParallel(unittest.IsolatedAsyncioTestCase):
    @patch.object(zotero_import_module, "_import_one_paper", new_callable=AsyncMock)
    @patch.object(
        zotero_import_module,
        "_discover_candidates_by_keys",
        new_callable=AsyncMock,
    )
    @patch.object(zotero_import_module, "zotero_crud")
    async def test_runs_gather_over_discovered_candidates(
        self,
        mock_zotero_crud: MagicMock,
        mock_discover: AsyncMock,
        mock_import_one: AsyncMock,
    ) -> None:
        user = MagicMock()
        user.id = uuid4()
        mock_zotero_crud.get_by_user_id.return_value = MagicMock(
            zotero_user_id="1", api_key="key"
        )

        items = [
            {"key": "A", "data": {"title": "A"}},
            {"key": "B", "data": {"title": "B"}},
            {"key": "C", "data": {"title": "C"}},
        ]
        mock_discover.return_value = (items, [], 0, [])

        async def fake_import(item, **kwargs):
            key = item["key"]
            return {
                "status": "processing",
                "zotero_item_key": key,
                "paper_id": f"paper-{key}",
                "upload_job_id": f"job-{key}",
                "import_source": ZoteroImportSource.PDF_ATTACHMENT,
                "title": item["data"]["title"],
            }

        mock_import_one.side_effect = fake_import

        gather_sizes: list[int] = []
        real_gather = asyncio.gather

        async def track_gather(*coros, **kwargs):
            gather_sizes.append(len(coros))
            return await real_gather(*coros, **kwargs)

        with patch(
            "app.services.zotero_import.asyncio.gather",
            side_effect=track_gather,
        ):
            result = await import_batch(
                MagicMock(), user=user, item_keys=["A", "B", "C"]
            )

        self.assertEqual(gather_sizes, [3])
        self.assertEqual(result["imported_count"], 3)
        self.assertEqual(mock_import_one.await_count, 3)


if __name__ == "__main__":
    unittest.main()
