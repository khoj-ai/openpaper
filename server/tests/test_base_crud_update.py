"""Writing to a row that another transaction deleted."""

import unittest
import uuid
from unittest.mock import MagicMock

from app.database.crud.base_crud import CRUDBase
from app.database.crud.paper_crud import paper_crud
from app.database.models import Paper
from psycopg2.errors import ForeignKeyViolation, UniqueViolation
from sqlalchemy import inspect
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm.exc import ObjectDeletedError, StaleDataError


class _DeletedRow:
    """A loaded row that, like a row deleted by another transaction, can no
    longer be read once the session rolls back and expires it."""

    user_id = None

    def __init__(self, db: MagicMock) -> None:
        self._db = db

    @property
    def id(self) -> str:
        if self._db.rollback.called:
            raise ObjectDeletedError(inspect(Paper()))
        return "paper-1"


class TestUpdateDeletedRow(unittest.TestCase):
    def test_fails_quietly_without_reading_the_deleted_row(self) -> None:
        crud: CRUDBase = CRUDBase(Paper)  # type: ignore[arg-type]
        db = MagicMock()
        db.commit.side_effect = StaleDataError(
            "UPDATE statement on table 'papers' expected to update 1 row(s); "
            "0 were matched."
        )

        result = crud.update(db, db_obj=_DeletedRow(db), obj_in={"doi": "10.1/x"})

        self.assertIsNone(result)
        db.rollback.assert_called_once()


class TestIndexDeletedPaper(unittest.TestCase):
    def _index(self, driver_error: Exception) -> None:
        db = MagicMock()
        db.execute.side_effect = IntegrityError("INSERT", {}, driver_error)
        paper_crud.index_paper_passages(db, paper_id=uuid.uuid4(), raw_content="text")

    def test_skips_a_paper_that_no_longer_exists(self) -> None:
        self._index(ForeignKeyViolation())

    def test_raises_any_other_integrity_error(self) -> None:
        with self.assertRaises(IntegrityError):
            self._index(UniqueViolation())


if __name__ == "__main__":
    unittest.main()
