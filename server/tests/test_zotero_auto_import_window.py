import unittest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from app.services import zotero_import as zotero_import_module
from app.services.zotero_import import (
    _parse_zotero_date_added,
    auto_import_new_papers,
)


class TestParseZoteroDateAdded(unittest.TestCase):
    def test_parses_z_suffix(self) -> None:
        result = _parse_zotero_date_added("2024-06-01T10:15:30Z")
        self.assertIsNotNone(result)
        assert result is not None
        self.assertEqual(result.year, 2024)
        self.assertEqual(result.month, 6)

    def test_returns_none_for_invalid(self) -> None:
        self.assertIsNone(_parse_zotero_date_added("not-a-date"))


class TestAutoImportWindow(unittest.IsolatedAsyncioTestCase):
    @patch.object(zotero_import_module, "import_batch", new_callable=AsyncMock)
    @patch.object(zotero_import_module, "list_library")
    @patch.object(zotero_import_module, "zotero_crud")
    @patch.object(zotero_import_module, "can_user_upload_paper", return_value=(True, None))
    @patch.object(
        zotero_import_module, "get_remaining_paper_upload_slots", return_value=10
    )
    async def test_skips_items_before_auto_import_since(
        self,
        _mock_slots: MagicMock,
        _mock_can_upload: MagicMock,
        mock_zotero_crud: MagicMock,
        mock_list_library: MagicMock,
        mock_import_batch: AsyncMock,
    ) -> None:
        since = datetime(2025, 6, 1, tzinfo=timezone.utc)
        connection = MagicMock()
        connection.auto_import_since = since
        mock_zotero_crud.get_by_user_id.return_value = connection

        mock_list_library.return_value = {
            "items": [
                {
                    "zotero_item_key": "OLD1",
                    "already_imported": False,
                    "date_added": datetime(2020, 1, 1, tzinfo=timezone.utc),
                },
                {
                    "zotero_item_key": "NEW1",
                    "already_imported": False,
                    "date_added": datetime(2025, 7, 1, tzinfo=timezone.utc),
                },
            ],
            "remaining_slots": 10,
        }
        mock_import_batch.return_value = {"imported_count": 1}

        user = MagicMock()
        user.id = uuid4()
        db = MagicMock()

        result = await auto_import_new_papers(db, user=user)

        mock_import_batch.assert_awaited_once()
        keys = mock_import_batch.await_args.kwargs["item_keys"]
        self.assertEqual(keys, ["NEW1"])
        self.assertEqual(result["auto_imported_count"], 1)

    @patch.object(zotero_import_module, "list_library")
    @patch.object(zotero_import_module, "zotero_crud")
    async def test_skips_when_no_auto_import_since(
        self,
        mock_zotero_crud: MagicMock,
        mock_list_library: MagicMock,
    ) -> None:
        connection = MagicMock()
        connection.auto_import_since = None
        mock_zotero_crud.get_by_user_id.return_value = connection

        user = MagicMock()
        user.id = uuid4()
        db = MagicMock()

        result = await auto_import_new_papers(db, user=user)

        mock_list_library.assert_not_called()
        self.assertEqual(result["auto_imported_count"], 0)


if __name__ == "__main__":
    unittest.main()
