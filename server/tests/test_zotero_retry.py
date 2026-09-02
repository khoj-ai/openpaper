import asyncio
import unittest
from unittest.mock import MagicMock, patch

import requests
from app.helpers.http_retry import is_retryable_status, retryable_status_in_message
from app.integrations.zotero_api import (
    MAX_RETRIES,
    ZoteroApiClient,
    ZoteroFileNotStoredError,
)
from app.services.zotero_import import FILE_NOT_STORED_MESSAGE, _resolve_pdf_bytes


def _response(status_code: int, body: str = "") -> MagicMock:
    """A requests.Response stand-in that raises like the real thing."""
    response = MagicMock(spec=requests.Response)
    response.status_code = status_code
    response.text = body
    response.headers = {}
    response.content = b"%PDF-1.4 body"
    if status_code >= 400:
        response.raise_for_status.side_effect = requests.HTTPError(
            f"{status_code} Error for url: https://api.zotero.org/x", response=response
        )
    else:
        response.raise_for_status.return_value = None
    return response


class TestRetryableStatus(unittest.TestCase):
    def test_transient_statuses_are_retryable(self) -> None:
        for code in (429, 500, 502, 503, 504):
            self.assertTrue(is_retryable_status(code), code)

    def test_client_errors_are_not_retryable(self) -> None:
        for code in (400, 401, 403, 404, 409):
            self.assertFalse(is_retryable_status(code), code)

    def test_no_response_is_retryable(self) -> None:
        """A transport failure never produced a status; treat it as transient."""
        self.assertTrue(is_retryable_status(None))

    def test_status_parsed_out_of_message(self) -> None:
        self.assertTrue(retryable_status_in_message("failed with status code 502: x"))
        self.assertFalse(retryable_status_in_message("failed with status code 404: x"))

    def test_unparseable_message_is_undecided(self) -> None:
        self.assertIsNone(retryable_status_in_message("something else entirely"))


class TestZoteroRequestRetries(unittest.TestCase):
    def setUp(self) -> None:
        self.client = ZoteroApiClient(zotero_user_id="123", api_key="k")

    def _run(self, status_code: int):
        with (
            patch.object(self.client._session, "request") as request,
            patch("app.integrations.zotero_api.time.sleep") as sleep,
        ):
            request.return_value = _response(status_code, "Not found")
            with self.assertRaises(requests.HTTPError):
                self.client._request("GET", "https://api.zotero.org/x")
            return request.call_count, sleep.call_count

    def test_404_is_not_retried(self) -> None:
        """The file endpoint 404s for attachments Zotero never stored; retrying
        that only multiplies the latency of a bulk import."""
        calls, sleeps = self._run(404)
        self.assertEqual(calls, 1)
        self.assertEqual(sleeps, 0)

    def test_403_is_not_retried(self) -> None:
        calls, _ = self._run(403)
        self.assertEqual(calls, 1)

    def test_server_error_is_retried(self) -> None:
        calls, _ = self._run(503)
        self.assertEqual(calls, MAX_RETRIES)

    def test_transport_error_is_retried(self) -> None:
        with (
            patch.object(self.client._session, "request") as request,
            patch("app.integrations.zotero_api.time.sleep"),
        ):
            request.side_effect = requests.ConnectionError("connection reset")
            with self.assertRaises(requests.ConnectionError):
                self.client._request("GET", "https://api.zotero.org/x")
            self.assertEqual(request.call_count, MAX_RETRIES)

    def test_rate_limit_is_retried(self) -> None:
        with (
            patch.object(self.client._session, "request") as request,
            patch("app.integrations.zotero_api.time.sleep"),
        ):
            request.return_value = _response(429)
            with self.assertRaises(requests.HTTPError):
                self.client._request("GET", "https://api.zotero.org/x")
            self.assertEqual(request.call_count, MAX_RETRIES)


class TestFailureLogging(unittest.TestCase):
    """A failure we choose not to retry still has to stay analyzable."""

    def setUp(self) -> None:
        self.client = ZoteroApiClient(zotero_user_id="123", api_key="k")

    def _capture(self, status_code: int, **kwargs):
        with (
            patch.object(self.client._session, "request") as request,
            patch("app.integrations.zotero_api.time.sleep"),
            self.assertLogs("app.integrations.zotero_api", level="INFO") as logs,
        ):
            request.return_value = _response(status_code, "Not found")
            with self.assertRaises(requests.HTTPError):
                self.client._request("GET", "https://api.zotero.org/x", **kwargs)
            return logs.records

    def test_expected_status_logs_at_info(self) -> None:
        records = self._capture(404, expected_statuses=frozenset({404}))
        self.assertEqual([r.levelname for r in records], ["INFO"])

    def test_unexpected_client_error_stays_a_warning(self) -> None:
        records = self._capture(404)
        self.assertEqual([r.levelname for r in records], ["WARNING"])

    def test_no_error_level_record_for_a_404(self) -> None:
        """The give-up ERROR is for exhausted retries, not for a 404."""
        records = self._capture(404, expected_statuses=frozenset({404}))
        self.assertNotIn("ERROR", [r.levelname for r in records])

    def test_status_is_recorded_as_a_structured_field(self) -> None:
        record = self._capture(404, expected_statuses=frozenset({404}))[0]
        self.assertEqual(record.zotero_status, 404)
        self.assertEqual(record.zotero_url, "https://api.zotero.org/x")

    def test_non_retryable_failure_does_not_claim_more_attempts(self) -> None:
        message = self._capture(404, expected_statuses=frozenset({404}))[0].getMessage()
        self.assertIn("not retryable", message)
        self.assertNotIn("attempt 1/3", message)

    def test_retryable_failure_still_counts_attempts(self) -> None:
        records = self._capture(503)
        self.assertIn("attempt 1/3", records[0].getMessage())
        # Exhausting the retries is a real failure and keeps its ERROR.
        self.assertEqual(records[-1].levelname, "ERROR")


class TestDownloadAttachmentFile(unittest.TestCase):
    def setUp(self) -> None:
        self.client = ZoteroApiClient(zotero_user_id="123", api_key="k")

    def test_404_becomes_file_not_stored(self) -> None:
        with (
            patch.object(self.client._session, "request") as request,
            patch("app.integrations.zotero_api.time.sleep"),
        ):
            request.return_value = _response(404, "Not found")
            with self.assertRaises(ZoteroFileNotStoredError):
                self.client.download_attachment_file("ATT1")

    def test_other_errors_are_not_reinterpreted(self) -> None:
        """A 403 is a real access problem, not a missing-file condition."""
        with (
            patch.object(self.client._session, "request") as request,
            patch("app.integrations.zotero_api.time.sleep"),
        ):
            request.return_value = _response(403, "Forbidden")
            with self.assertRaises(requests.HTTPError):
                self.client.download_attachment_file("ATT1")

    def test_success_returns_content(self) -> None:
        with patch.object(self.client._session, "request") as request:
            request.return_value = _response(200)
            self.assertEqual(
                self.client.download_attachment_file("ATT1"), b"%PDF-1.4 body"
            )


class TestResolvePdfBytesFailureReason(unittest.TestCase):
    def _resolve(self, download_side_effect):
        client = MagicMock()
        client.get_children.return_value = []
        client.find_pdf_attachment.return_value = {
            "key": "ATT1",
            "data": {"linkMode": "imported_file", "contentType": "application/pdf"},
        }
        client.download_attachment_file.side_effect = download_side_effect
        # No URLs to fall back to, so the attachment reason is what survives.
        client.resolve_item_urls.return_value = []
        return asyncio.run(_resolve_pdf_bytes(client, {"key": "ITEM1", "data": {}}))

    def test_not_stored_reports_storage_guidance(self) -> None:
        _, _, _, _, _, failure_reason = self._resolve(ZoteroFileNotStoredError("ATT1"))
        self.assertEqual(failure_reason, FILE_NOT_STORED_MESSAGE)
        # The reason has to name a recovery, not just the failure.
        self.assertIn("In Zotero", failure_reason)

    def test_other_failures_keep_the_generic_reason(self) -> None:
        _, _, _, _, _, failure_reason = self._resolve(RuntimeError("boom"))
        self.assertEqual(failure_reason, "PDF attachment download failed.")


if __name__ == "__main__":
    unittest.main()
