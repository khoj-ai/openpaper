import unittest
from unittest.mock import MagicMock, patch

import httpx
from app.helpers import discover as discover_module
from app.helpers.discover import run_discover_pipeline
from app.helpers.exa_search import (
    _is_retryable_exa_error,
    _parse_publication_result,
    search_exa,
)


def publication_payload(**overrides) -> dict:
    """A publication-index result, shaped like the live API returns them."""
    payload = {
        "id": "https://exa.ai/library/publication/abc123",
        "title": "Mamba: Linear-Time Sequence Modeling with Selective State Spaces",
        "url": "https://doi.org/10.48550/arxiv.2312.00752",
        "publishedDate": "2023-12-01T00:00:00.000Z",
        "author": "Albert Gu, Tri Dao",
        "text": "scraped page text",
        "highlights": ["a highlight"],
        "highlightScores": [0.9],
        "favicon": "https://example.org/favicon.ico",
        "summary": "a summary",
        "entities": [
            {
                "type": "publication",
                "properties": {
                    "citationCount": 1025,
                    "abstract": "Foundation models are almost universally based on the Transformer.",
                    "date": "2023-12-01",
                    "doi": "10.48550/arxiv.2312.00752",
                    "authors": [{"name": "Albert Gu"}, {"name": "Tri Dao"}],
                },
            }
        ],
    }
    payload.update(overrides)
    return payload


class TestParsePublicationResult(unittest.TestCase):
    def test_maps_entity_metadata(self) -> None:
        result = _parse_publication_result(publication_payload())

        assert result is not None
        self.assertEqual(result.cited_by_count, 1025)
        self.assertEqual(result.authors, ["Albert Gu", "Tri Dao"])
        self.assertEqual(result.published_date, "2023-12-01T00:00:00.000Z")
        self.assertEqual(result.highlight_scores, [0.9])

    def test_prefers_abstract_over_scraped_text(self) -> None:
        result = _parse_publication_result(publication_payload())

        assert result is not None
        self.assertEqual(
            result.text,
            "Foundation models are almost universally based on the Transformer.",
        )

    def test_falls_back_to_scraped_text_without_abstract(self) -> None:
        payload = publication_payload()
        payload["entities"][0]["properties"].pop("abstract")

        result = _parse_publication_result(payload)

        assert result is not None
        self.assertEqual(result.text, "scraped page text")

    def test_untitled_result_is_dropped(self) -> None:
        self.assertIsNone(_parse_publication_result(publication_payload(title="   ")))
        self.assertIsNone(_parse_publication_result(publication_payload(title=None)))

    def test_web_index_result_without_entity(self) -> None:
        """Half of publication-category results come from the general web index."""
        payload = publication_payload(entities=[])
        payload.pop("publishedDate")

        result = _parse_publication_result(payload)

        assert result is not None
        self.assertEqual(result.authors, ["Albert Gu, Tri Dao"])
        self.assertIsNone(result.cited_by_count)
        self.assertIsNone(result.published_date)
        self.assertEqual(result.text, "scraped page text")

    def test_date_falls_back_to_entity_property(self) -> None:
        payload = publication_payload()
        payload.pop("publishedDate")

        result = _parse_publication_result(payload)

        assert result is not None
        self.assertEqual(result.published_date, "2023-12-01")

    def test_tolerates_malformed_authors(self) -> None:
        payload = publication_payload()
        payload["entities"][0]["properties"]["authors"] = [
            {"name": "Albert Gu"},
            {"id": "no-name-key"},
            "Tri Dao",
        ]

        result = _parse_publication_result(payload)

        assert result is not None
        self.assertEqual(result.authors, ["Albert Gu", "Tri Dao"])

    def test_cited_by_count_ignores_non_numeric(self) -> None:
        payload = publication_payload()
        payload["entities"][0]["properties"]["citationCount"] = "lots"

        result = _parse_publication_result(payload)

        assert result is not None
        self.assertIsNone(result.cited_by_count)


class TestSearchExaDispatch(unittest.TestCase):
    @patch("app.helpers.exa_search.EXA_API_KEY", "test-key")
    @patch("app.helpers.exa_search.httpx.post")
    def test_publication_index_sends_no_domain_or_date_filter(self, mock_post) -> None:
        mock_post.return_value = MagicMock(
            status_code=200,
            json=lambda: {"results": [publication_payload()]},
            raise_for_status=lambda: None,
        )

        results = search_exa(
            "long sequence modeling",
            num_results=10,
            domains=["arxiv.org"],
            start_published_date="2025-01-01",
            use_publication_index=True,
        )

        payload = mock_post.call_args.kwargs["json"]
        self.assertEqual(payload["category"], "publication")
        # Exa rejects domain filters outright here, and honors date filters only
        # for results that carry a date — so neither may be sent.
        self.assertNotIn("includeDomains", payload)
        self.assertNotIn("startPublishedDate", payload)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].cited_by_count, 1025)

    @patch("app.helpers.exa_search.EXA_API_KEY", "test-key")
    @patch("app.helpers.exa_search.Exa")
    def test_web_index_is_the_default(self, mock_exa) -> None:
        mock_exa.return_value.search_and_contents.return_value = MagicMock(results=[])

        search_exa("long sequence modeling", start_published_date="2025-01-01")

        params = mock_exa.return_value.search_and_contents.call_args.kwargs
        self.assertEqual(params["category"], "research paper")
        self.assertEqual(params["start_published_date"], "2025-01-01")


class TestRetryClassification(unittest.TestCase):
    def _status_error(self, code: int) -> httpx.HTTPStatusError:
        request = httpx.Request("POST", "https://api.exa.ai/search")
        response = httpx.Response(code, request=request)
        return httpx.HTTPStatusError("boom", request=request, response=response)

    def test_transient_status_is_retryable(self) -> None:
        self.assertTrue(_is_retryable_exa_error(self._status_error(503)))
        self.assertTrue(_is_retryable_exa_error(self._status_error(429)))

    def test_client_error_is_not_retryable(self) -> None:
        """A rejected domain filter returns 400 and will never succeed on retry."""
        self.assertFalse(_is_retryable_exa_error(self._status_error(400)))

    def test_transport_error_is_retryable(self) -> None:
        self.assertTrue(_is_retryable_exa_error(httpx.ConnectTimeout("timed out")))

    def test_sdk_value_error_status_is_parsed(self) -> None:
        self.assertTrue(
            _is_retryable_exa_error(
                ValueError("Request failed with status code 502: x")
            )
        )
        self.assertFalse(
            _is_retryable_exa_error(
                ValueError("Request failed with status code 400: x")
            )
        )


class TestDiscoverRouting(unittest.IsolatedAsyncioTestCase):
    async def _run(self, **kwargs) -> dict:
        with (
            patch.object(discover_module, "decompose_query", return_value=["sub one"]),
            patch.object(discover_module, "search_exa", return_value=[]) as mock_search,
        ):
            async for _ in run_discover_pipeline("a question", **kwargs):
                pass
        return mock_search.call_args.kwargs

    async def test_unfiltered_search_uses_publication_index(self) -> None:
        kwargs = await self._run()
        self.assertTrue(kwargs["use_publication_index"])

    async def test_source_filter_falls_back_to_web_index(self) -> None:
        kwargs = await self._run(sources=["arxiv"])
        self.assertFalse(kwargs["use_publication_index"])
        self.assertEqual(kwargs["domains"], ["arxiv.org"])

    async def test_year_filter_falls_back_to_web_index(self) -> None:
        kwargs = await self._run(year_filter="last_year")
        self.assertFalse(kwargs["use_publication_index"])
        self.assertIsNotNone(kwargs["start_published_date"])

    async def test_unrecognized_source_still_uses_publication_index(self) -> None:
        """Unknown keys yield no domains, so there is nothing to filter on."""
        kwargs = await self._run(sources=["not-a-source"])
        self.assertTrue(kwargs["use_publication_index"])

    async def test_openalex_path_does_not_touch_exa(self) -> None:
        with (
            patch.object(discover_module, "decompose_query", return_value=["sub one"]),
            patch.object(discover_module, "search_exa") as mock_exa,
            patch.object(
                discover_module, "search_openalex", return_value=[]
            ) as mock_openalex,
        ):
            async for _ in run_discover_pipeline("a question", sources=["openalex"]):
                pass

        mock_exa.assert_not_called()
        mock_openalex.assert_called_once()


if __name__ == "__main__":
    unittest.main()
