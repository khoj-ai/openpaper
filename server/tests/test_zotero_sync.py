import json
import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch
from uuid import UUID, uuid4

from app.database.models import ZoteroImportSource, ZoteroImportStatus
from app.services import zotero_import as zotero_import_module
from app.services.zotero_import import (
    _normalize_payload_item,
    _page_from_annotation,
    _serialize_annotations_payload,
    _sync_item,
    sync_batch,
)


class TestZoteroAnnotationPayload(unittest.TestCase):
    def test_serialize_annotations_payload_keeps_keys(self) -> None:
        payload = _serialize_annotations_payload(
            [
                {"key": "ANN1", "data": {"annotationText": "hello"}},
                {"key": "", "data": {"annotationText": "skip me"}},
            ]
        )
        self.assertEqual(
            payload,
            [{"key": "ANN1", "data": {"annotationText": "hello"}}],
        )

    def test_normalize_payload_item_new_format(self) -> None:
        result = _normalize_payload_item(
            {"key": "ANN1", "data": {"annotationText": "hello"}}
        )
        self.assertEqual(result, ("ANN1", {"annotationText": "hello"}))

    def test_normalize_payload_item_legacy_data_only_without_key(self) -> None:
        self.assertIsNone(
            _normalize_payload_item({"annotationText": "legacy", "annotationType": "highlight"})
        )

    def test_page_from_annotation_prefers_pdf_page_index_over_printed_label(self) -> None:
        data = {
            "annotationPageLabel": "583",
            "annotationPosition": json.dumps({"pageIndex": 0, "rects": [[0, 0, 1, 1]]}),
        }
        self.assertEqual(_page_from_annotation(data), 1)


class TestZoteroSyncItem(unittest.TestCase):
    def setUp(self) -> None:
        self.paper_id = uuid4()
        self.import_row = MagicMock()
        self.import_row.paper_id = self.paper_id
        self.import_row.zotero_item_key = "ITEM1"
        self.import_row.zotero_attachment_key = "ATT1"

        self.paper = MagicMock()
        self.paper.id = self.paper_id
        self.paper.s3_object_key = "uploads/test.pdf"

        self.user = MagicMock()
        self.client = MagicMock()

    @patch.object(zotero_import_module, "zotero_import_crud")
    @patch.object(zotero_import_module, "highlight_crud")
    @patch.object(zotero_import_module, "paper_crud")
    def test_sync_appends_new_annotation(
        self,
        mock_paper_crud: MagicMock,
        mock_highlight_crud: MagicMock,
        mock_import_crud: MagicMock,
    ) -> None:
        mock_paper_crud.get.return_value = self.paper
        mock_paper_crud.read_raw_document_content.return_value = MagicMock(
            raw_content="hello world",
            page_offsets={1: (0, 11)},
        )
        mock_highlight_crud.get_zotero_annotation_keys_for_paper.return_value = set()
        self.client.get_children.return_value = []
        self.client.get_annotations_for_attachment.return_value = [
            {
                "key": "ANN1",
                "data": {
                    "annotationType": "highlight",
                    "annotationText": "hello",
                    "annotationPosition": '{"pageIndex": 0, "rects": [[0,0,1,1]]}',
                },
            }
        ]

        with patch.object(
            zotero_import_module, "_get_page_dims_for_paper", return_value={0: (612.0, 792.0)}
        ), patch.object(
            zotero_import_module,
            "_try_backfill_or_apply_annotation",
            return_value=True,
        ) as mock_apply:
            result = _sync_item(
                MagicMock(),
                client=self.client,
                import_row=self.import_row,
                user=self.user,
            )

        self.assertEqual(result["new_annotations_count"], 1)
        mock_apply.assert_called_once()
        mock_import_crud.update_after_sync.assert_called_once()

    @patch.object(zotero_import_module, "zotero_import_crud")
    @patch.object(zotero_import_module, "highlight_crud")
    @patch.object(zotero_import_module, "paper_crud")
    def test_sync_is_idempotent(
        self,
        mock_paper_crud: MagicMock,
        mock_highlight_crud: MagicMock,
        mock_import_crud: MagicMock,
    ) -> None:
        mock_paper_crud.get.return_value = self.paper
        mock_highlight_crud.get_zotero_annotation_keys_for_paper.return_value = {"ANN1"}
        self.client.get_children.return_value = []
        self.client.get_annotations_for_attachment.return_value = [
            {"key": "ANN1", "data": {"annotationType": "highlight", "annotationText": "hello"}}
        ]

        with patch.object(
            zotero_import_module, "_try_backfill_or_apply_annotation"
        ) as mock_apply:
            result = _sync_item(
                MagicMock(),
                client=self.client,
                import_row=self.import_row,
                user=self.user,
            )

        self.assertEqual(result["new_annotations_count"], 0)
        mock_apply.assert_not_called()
        mock_import_crud.update_after_sync.assert_called_once()

    @patch.object(zotero_import_module, "highlight_crud")
    def test_backfill_sets_key_without_creating_highlight(
        self, mock_highlight_crud: MagicMock
    ) -> None:
        db = MagicMock()
        candidate = MagicMock()
        mock_highlight_crud.find_backfill_candidate.return_value = candidate

        applied = zotero_import_module._try_backfill_or_apply_annotation(
            db,
            paper_id=self.paper_id,
            user=self.user,
            zotero_annotation_key="ANN1",
            ann_data={"annotationType": "highlight", "annotationText": "hello"},
            raw_content="hello world",
            page_offsets={1: (0, 11)},
        )

        self.assertTrue(applied)
        mock_highlight_crud.set_zotero_annotation_key.assert_called_once_with(
            db,
            highlight=candidate,
            zotero_annotation_key="ANN1",
        )


class TestZoteroImportCrudFilters(unittest.TestCase):
    def test_list_syncable_excludes_url_imports(self) -> None:
        from app.database.crud.zotero_import_crud import zotero_import_crud

        db = MagicMock()
        query = db.query.return_value
        join = query.join.return_value
        filter_result = join.filter.return_value
        order = filter_result.order_by.return_value
        order.limit.return_value.all.return_value = []

        user_id = uuid4()
        zotero_import_crud.list_syncable_by_user(db, user_id=user_id, limit=10)

        join.filter.assert_called_once()
        filter_args = join.filter.call_args[0]
        self.assertTrue(len(filter_args) > 0)


class TestSyncBatch(unittest.IsolatedAsyncioTestCase):
    @patch.object(zotero_import_module, "_sync_item")
    @patch.object(zotero_import_module, "zotero_import_crud")
    @patch.object(zotero_import_module, "zotero_crud")
    async def test_sync_batch_aggregates_results(
        self,
        mock_zotero_crud: MagicMock,
        mock_import_crud: MagicMock,
        mock_sync_item: MagicMock,
    ) -> None:
        mock_zotero_crud.get_by_user_id.return_value = MagicMock(
            zotero_user_id="123", api_key="key"
        )
        import_row = MagicMock(zotero_item_key="ITEM1")
        mock_import_crud.list_syncable_by_user.return_value = [import_row]
        mock_sync_item.return_value = {
            "zotero_item_key": "ITEM1",
            "paper_id": str(uuid4()),
            "new_annotations_count": 2,
        }

        result = await sync_batch(MagicMock(), user=MagicMock(), limit=50)

        self.assertEqual(result["synced_papers_count"], 1)
        self.assertEqual(result["new_annotations_count"], 2)


if __name__ == "__main__":
    unittest.main()
