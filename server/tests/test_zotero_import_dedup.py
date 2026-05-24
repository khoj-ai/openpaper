import unittest
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from app.database.models import ZoteroImportSource, ZoteroImportStatus
from app.helpers.paper_search import normalize_doi
from app.services import zotero_import as zotero_import_module
from app.services.zotero_import import (
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


class TestImportBatchDoiDedup(unittest.IsolatedAsyncioTestCase):
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
        client.get_top_importable_items.side_effect = [
            [self._make_item("ITEM2")],
            [],
        ]

        result = await import_batch(MagicMock(), user=user, limit=50)

        self.assertEqual(result["skipped_already_imported"], 1)
        self.assertEqual(result["imported_count"], 0)
        mock_link.assert_awaited_once()

    @patch.object(zotero_import_module, "apply_zotero_annotations")
    @patch.object(zotero_import_module, "_apply_zotero_tags")
    @patch.object(zotero_import_module, "generate_pdf_preview_from_bytes")
    @patch.object(zotero_import_module, "extract_pdf_page_dimensions")
    @patch.object(zotero_import_module, "extract_pdf_text_and_offsets")
    @patch.object(zotero_import_module, "s3_service")
    @patch.object(zotero_import_module, "paper_upload_job_crud")
    @patch.object(zotero_import_module, "paper_crud")
    @patch.object(zotero_import_module, "zotero_import_crud")
    @patch.object(zotero_import_module, "zotero_crud")
    @patch.object(zotero_import_module, "ZoteroApiClient")
    @patch.object(zotero_import_module, "can_user_upload_paper", return_value=(True, None))
    @patch.object(
        zotero_import_module,
        "_resolve_pdf_bytes",
        new_callable=AsyncMock,
        return_value=(b"%PDF", ZoteroImportSource.PDF_ATTACHMENT, "ATT1", None, []),
    )
    @patch.object(
        zotero_import_module,
        "_link_zotero_item_to_existing_paper",
        new_callable=AsyncMock,
    )
    async def test_second_duplicate_doi_in_batch_links_to_first_paper(
        self,
        mock_link: AsyncMock,
        mock_resolve_pdf: AsyncMock,
        mock_can_upload: MagicMock,
        mock_client_cls: MagicMock,
        mock_zotero_crud: MagicMock,
        mock_import_crud: MagicMock,
        mock_paper_crud: MagicMock,
        mock_upload_job_crud: MagicMock,
        mock_s3: MagicMock,
        mock_extract_text: MagicMock,
        mock_extract_dims: MagicMock,
        mock_preview: MagicMock,
        mock_tags: MagicMock,
        mock_apply_ann: MagicMock,
    ) -> None:
        user = MagicMock()
        user.id = uuid4()
        mock_zotero_crud.get_by_user_id.return_value = MagicMock(
            zotero_user_id="1", api_key="key"
        )
        mock_import_crud.get_by_item_key.return_value = None
        mock_paper_crud.get_by_doi_for_user.return_value = None

        paper = MagicMock()
        paper.id = uuid4()
        mock_paper_crud.create.return_value = paper
        mock_paper_crud.get.return_value = paper

        upload_job = MagicMock()
        upload_job.id = uuid4()
        mock_upload_job_crud.create.return_value = upload_job

        mock_s3.upload_file = AsyncMock(return_value=("key", "https://example.com/file.pdf"))
        mock_extract_text.return_value = ("text", {1: [0, 4]})
        mock_extract_dims.return_value = {}
        mock_preview.return_value = ("preview-key", "https://example.com/preview.png")

        client = MagicMock()
        mock_client_cls.return_value = client
        client.get_top_importable_items.side_effect = [
            [self._make_item("ITEM1"), self._make_item("ITEM2")],
            [],
        ]

        result = await import_batch(MagicMock(), user=user, limit=50)

        self.assertEqual(result["imported_count"], 1)
        self.assertEqual(result["skipped_already_imported"], 1)
        mock_link.assert_awaited_once()
        link_kwargs = mock_link.await_args.kwargs
        self.assertEqual(link_kwargs["paper"], paper)

    @patch.object(zotero_import_module, "apply_zotero_annotations")
    @patch.object(zotero_import_module, "_apply_zotero_tags")
    @patch.object(zotero_import_module, "generate_pdf_preview_from_bytes")
    @patch.object(zotero_import_module, "extract_pdf_page_dimensions")
    @patch.object(zotero_import_module, "extract_pdf_text_and_offsets")
    @patch.object(zotero_import_module, "s3_service")
    @patch.object(zotero_import_module, "paper_upload_job_crud")
    @patch.object(zotero_import_module, "paper_crud")
    @patch.object(zotero_import_module, "zotero_import_crud")
    @patch.object(zotero_import_module, "zotero_crud")
    @patch.object(zotero_import_module, "ZoteroApiClient")
    @patch.object(zotero_import_module, "can_user_upload_paper", return_value=(True, None))
    @patch.object(
        zotero_import_module,
        "_resolve_pdf_bytes",
        new_callable=AsyncMock,
        return_value=(b"%PDF", ZoteroImportSource.PDF_ATTACHMENT, "ATT1", None, []),
    )
    async def test_item_without_doi_still_imports(
        self,
        mock_resolve_pdf: AsyncMock,
        mock_can_upload: MagicMock,
        mock_client_cls: MagicMock,
        mock_zotero_crud: MagicMock,
        mock_import_crud: MagicMock,
        mock_paper_crud: MagicMock,
        mock_upload_job_crud: MagicMock,
        mock_s3: MagicMock,
        mock_extract_text: MagicMock,
        mock_extract_dims: MagicMock,
        mock_preview: MagicMock,
        mock_tags: MagicMock,
        mock_apply_ann: MagicMock,
    ) -> None:
        user = MagicMock()
        user.id = uuid4()
        mock_zotero_crud.get_by_user_id.return_value = MagicMock(
            zotero_user_id="1", api_key="key"
        )
        mock_import_crud.get_by_item_key.return_value = None

        paper = MagicMock()
        paper.id = uuid4()
        mock_paper_crud.create.return_value = paper

        upload_job = MagicMock()
        upload_job.id = uuid4()
        mock_upload_job_crud.create.return_value = upload_job

        mock_s3.upload_file = AsyncMock(return_value=("key", "https://example.com/file.pdf"))
        mock_extract_text.return_value = ("text", {1: [0, 4]})
        mock_extract_dims.return_value = {}
        mock_preview.return_value = ("preview-key", "https://example.com/preview.png")

        client = MagicMock()
        mock_client_cls.return_value = client
        client.get_top_importable_items.side_effect = [
            [self._make_item("ITEM1", doi=None)],
            [],
        ]

        result = await import_batch(MagicMock(), user=user, limit=50)

        self.assertEqual(result["imported_count"], 1)
        self.assertEqual(result["skipped_already_imported"], 0)
        mock_paper_crud.get_by_doi_for_user.assert_not_called()


if __name__ == "__main__":
    unittest.main()
