import logging
import unittest
from unittest.mock import MagicMock

from app.database.crud.base_crud import CRUDBase
from sqlalchemy.orm.exc import StaleDataError


class _Paper:
    """Stand-in for the model: remove() only needs `id` and the class name."""

    __name__ = "Paper"
    id = MagicMock()


_STALE = StaleDataError(
    "DELETE statement on table 'paper_tag_association' expected to delete "
    "11 row(s); Only 0 were matched."
)


def _db_whose_commit_raises(error: Exception, *, still_present: bool = False):
    """A session whose delete fails, and whose re-read decides which case it was.

    remove() queries once to load the row and again after a StaleDataError to
    see whether it actually went away, so `first` returns the row and then
    either None (deleted) or the row again (still there).
    """
    db = MagicMock()
    row = MagicMock()
    db.query.return_value.filter.return_value.first.side_effect = [
        row,
        row if still_present else None,
    ]
    db.commit.side_effect = error
    return db


class TestRemoveConcurrentDelete(unittest.TestCase):
    def setUp(self) -> None:
        self.crud: CRUDBase = CRUDBase(_Paper)  # type: ignore[arg-type]

    def test_lost_race_rolls_back_and_stays_below_error(self) -> None:
        db = _db_whose_commit_raises(_STALE)

        with self.assertLogs("app.database.crud.base_crud", level="DEBUG") as logs:
            result = self.crud.remove(db, id="paper-1")

        self.assertIsNone(result)
        db.rollback.assert_called_once()
        # ERROR is what the CloudWatch alarm watches; a lost race is not one.
        self.assertEqual([r.levelno for r in logs.records], [logging.WARNING])

    def test_stale_session_with_the_row_still_present_is_an_error(self) -> None:
        # Same exception, but nothing actually got deleted — a session whose
        # view drifted from the database, which is a fault worth alarming on.
        db = _db_whose_commit_raises(_STALE, still_present=True)

        with self.assertLogs("app.database.crud.base_crud", level="DEBUG") as logs:
            result = self.crud.remove(db, id="paper-1")

        self.assertIsNone(result)
        self.assertEqual([r.levelno for r in logs.records], [logging.ERROR])
        self.assertIsNotNone(logs.records[0].exc_info)

    def test_a_failed_re_read_is_treated_as_an_error(self) -> None:
        db = _db_whose_commit_raises(_STALE)
        db.query.return_value.filter.return_value.first.side_effect = [
            MagicMock(),
            RuntimeError("connection gone"),
        ]

        with self.assertLogs("app.database.crud.base_crud", level="DEBUG") as logs:
            result = self.crud.remove(db, id="paper-1")

        self.assertIsNone(result)
        self.assertEqual([r.levelno for r in logs.records], [logging.ERROR])

    def test_a_real_failure_is_still_an_error(self) -> None:
        db = _db_whose_commit_raises(RuntimeError("connection reset"))

        with self.assertLogs("app.database.crud.base_crud", level="DEBUG") as logs:
            result = self.crud.remove(db, id="paper-1")

        self.assertIsNone(result)
        db.rollback.assert_called_once()
        self.assertEqual([r.levelno for r in logs.records], [logging.ERROR])


if __name__ == "__main__":
    unittest.main()
