import io
import json
import logging
import os
import unittest
from typing import Callable
from unittest.mock import patch

from app.logging_config import configure_logging


class TestConfigureLogging(unittest.TestCase):
    def setUp(self) -> None:
        root = logging.getLogger()
        handlers, level = root.handlers[:], root.level
        self.addCleanup(lambda: root.setLevel(level))
        self.addCleanup(lambda: root.handlers.__setitem__(slice(None), handlers))

    def _emit(self, log_something: Callable[[logging.Logger], None]) -> str:
        stream = io.StringIO()
        with patch.dict(os.environ, {"LOG_FORMAT": "json"}), patch(
            "sys.stderr", stream
        ):
            configure_logging()
            log_something(logging.getLogger("app.tests.sample"))
        return stream.getvalue()

    def test_wins_over_a_basic_config_from_an_imported_module(self) -> None:
        logging.basicConfig(level=logging.INFO)

        output = self._emit(lambda log: log.error("boom"))

        self.assertEqual(len(output.splitlines()), 1)
        self.assertEqual(json.loads(output)["message"], "boom")

    def test_keeps_an_exception_in_the_record_that_raised_it(self) -> None:
        def raise_and_log(log: logging.Logger) -> None:
            try:
                raise ValueError("bad doi")
            except ValueError:
                log.exception("lookup failed")

        output = self._emit(raise_and_log)

        self.assertEqual(len(output.splitlines()), 1)
        record = json.loads(output)
        self.assertEqual(record["level"], "ERROR")
        self.assertEqual(record["service"], "server")
        self.assertIn("ValueError: bad doi", record["exception"])


if __name__ == "__main__":
    unittest.main()
