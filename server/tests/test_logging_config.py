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

    def _emit(self, log_something: Callable[[logging.Logger], None], **env: str) -> str:
        stream = io.StringIO()
        # Pinned rather than left to the ambient environment, so a developer
        # running the suite with DEBUG set still exercises the JSON format.
        with patch.dict(os.environ, {"DEBUG": "False", **env}), patch(
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

    def test_drops_health_probe_access_records(self) -> None:
        def log_access(_: logging.Logger) -> None:
            # The shape uvicorn logs access lines in.
            access = logging.getLogger("uvicorn.access")
            line = '%s - "%s %s HTTP/%s" %d'
            access.info(line, "10.0.0.1:1", "GET", "/api/health", "1.1", 200)
            access.info(line, "10.0.0.1:2", "GET", "/api/paper?id=1", "1.1", 200)

        output = self._emit(log_access)

        messages = [json.loads(line)["message"] for line in output.splitlines()]
        self.assertEqual(len(messages), 1)
        self.assertIn("/api/paper", messages[0])

    def test_keeps_non_access_records_on_the_access_logger(self) -> None:
        output = self._emit(lambda _: logging.getLogger("uvicorn.access").info("boom"))

        self.assertEqual(json.loads(output)["message"], "boom")

    def test_debug_swaps_in_the_readable_text_format(self) -> None:
        output = self._emit(lambda log: log.error("boom"), DEBUG="True")

        self.assertIn("[ERROR] app.tests.sample: boom", output)


if __name__ == "__main__":
    unittest.main()
