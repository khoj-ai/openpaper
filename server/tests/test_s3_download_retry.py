"""Downloading a paper's PDF from S3 when the connection breaks off.

botocore retries a GetObject request that fails, but hands the body back unread,
so a body that breaks off mid-read reaches the caller as-is. download_bytes
fetches such a body once more, and leaves failed requests to botocore.
"""

import io
import unittest
from unittest.mock import MagicMock

from app.helpers.s3 import S3Service
from botocore.exceptions import ConnectionClosedError
from botocore.response import StreamingBody
from urllib3.exceptions import ProtocolError

PDF = b"%PDF-1.7 a whole paper"


class BrokenStream(io.RawIOBase):
    """A response body whose peer hangs up partway through."""

    def read(self, *args):
        raise ProtocolError("peer closed connection without sending complete body")


class DownloadRetryTest(unittest.TestCase):
    def setUp(self):
        self.service = S3Service.__new__(S3Service)
        self.service.bucket_name = "papers"
        self.service.s3_client = MagicMock()

    def test_a_body_that_breaks_off_is_fetched_once_more(self):
        # botocore raises a different error for a body whose peer hangs up and
        # for one that ends short of its Content-Length.
        broken_bodies = {
            "hangs up": lambda: StreamingBody(BrokenStream(), len(PDF)),
            "ends short": lambda: StreamingBody(io.BytesIO(PDF[:8]), len(PDF)),
        }
        for case, broken_body in broken_bodies.items():
            with self.subTest(case):
                self.service.s3_client.get_object.reset_mock()
                self.service.s3_client.get_object.side_effect = [
                    {"Body": broken_body()},
                    {"Body": StreamingBody(io.BytesIO(PDF), len(PDF))},
                ]

                self.assertEqual(self.service.download_bytes("paper.pdf"), PDF)
                self.assertEqual(self.service.s3_client.get_object.call_count, 2)

    def test_a_failed_request_is_left_to_botocore(self):
        # botocore has already spent its own retries by the time this surfaces.
        self.service.s3_client.get_object.side_effect = ConnectionClosedError(
            endpoint_url="https://papers.s3.amazonaws.com/paper.pdf"
        )

        with self.assertRaises(ConnectionClosedError):
            self.service.download_bytes("paper.pdf")
        self.assertEqual(self.service.s3_client.get_object.call_count, 1)


if __name__ == "__main__":
    unittest.main()
