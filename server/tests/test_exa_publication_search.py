import unittest
from unittest.mock import MagicMock, patch

import httpx
from app.helpers import discover as discover_module
from app.helpers import openalex_search as openalex_module
from app.helpers.discover import run_discover_pipeline
from app.helpers.exa_search import (
    ExaResult,
    _is_retryable_exa_error,
    _parse_publication_result,
    search_exa,
)
from app.helpers.openalex_search import (
    OpenAlexWorkMetadata,
    fetch_metadata_by_doi,
    normalize_openalex_doi,
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
                    "type": "preprint",
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
        self.assertEqual(result.publication_type, "preprint")

    def test_publication_type_absent_without_entity(self) -> None:
        result = _parse_publication_result(publication_payload(entities=[]))

        assert result is not None
        self.assertIsNone(result.publication_type)

    def test_publication_type_serialized_for_client(self) -> None:
        payload = _parse_publication_result(publication_payload())

        assert payload is not None
        self.assertEqual(payload.to_dict()["publication_type"], "preprint")

    def test_venue_is_left_for_openalex_to_supply(self) -> None:
        """Exa exposes no venue on publication entities; it arrives via hydration."""
        result = _parse_publication_result(publication_payload())

        assert result is not None
        self.assertIsNone(result.source)
        self.assertIn("source", result.to_dict())

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


class TestExtractDoi(unittest.TestCase):
    def test_prefers_entity_doi(self) -> None:
        result = _parse_publication_result(publication_payload())

        assert result is not None
        self.assertEqual(result.doi, "10.48550/arxiv.2312.00752")

    def test_recovers_doi_from_doi_org_url(self) -> None:
        payload = publication_payload(url="https://doi.org/10.1038/s41467-023-40601-6")
        payload["entities"][0]["properties"].pop("doi")

        result = _parse_publication_result(payload)

        assert result is not None
        self.assertEqual(result.doi, "10.1038/s41467-023-40601-6")

    def test_ignores_non_doi_urls(self) -> None:
        payload = publication_payload(url="https://www.nature.com/articles/s41467-1")
        payload["entities"][0]["properties"].pop("doi")

        result = _parse_publication_result(payload)

        assert result is not None
        self.assertIsNone(result.doi)

    def test_normalizes_case(self) -> None:
        payload = publication_payload()
        payload["entities"][0]["properties"]["doi"] = "10.1038/S41467-ABC"

        result = _parse_publication_result(payload)

        assert result is not None
        self.assertEqual(result.doi, "10.1038/s41467-abc")


class TestNormalizeOpenAlexDoi(unittest.TestCase):
    def test_strips_url_and_scheme_prefixes(self) -> None:
        for value in (
            "https://doi.org/10.1038/abc",
            "http://doi.org/10.1038/abc",
            "doi:10.1038/abc",
            "10.1038/ABC",
            "  10.1038/abc  ",
        ):
            self.assertEqual(normalize_openalex_doi(value), "10.1038/abc")

    def test_empty(self) -> None:
        self.assertIsNone(normalize_openalex_doi(None))
        self.assertIsNone(normalize_openalex_doi(""))


class TestHydrateFromOpenAlex(unittest.TestCase):
    def _result(self, **kwargs) -> ExaResult:
        defaults = dict(
            title="A paper", url="https://doi.org/10.1038/abc", doi="10.1038/abc"
        )
        defaults.update(kwargs)
        return ExaResult(**defaults)

    @patch.object(discover_module, "fetch_metadata_by_doi")
    def test_fills_missing_fields(self, mock_fetch) -> None:
        mock_fetch.return_value = {
            "10.1038/abc": OpenAlexWorkMetadata(
                source="Nature Communications",
                cited_by_count=116,
                institutions=["ETH Zurich"],
            )
        }

        [result] = discover_module._hydrate_from_openalex([self._result()])

        self.assertEqual(result.source, "Nature Communications")
        self.assertEqual(result.cited_by_count, 116)
        self.assertEqual(result.institutions, ["ETH Zurich"])

    @patch.object(discover_module, "fetch_metadata_by_doi")
    def test_does_not_overwrite_values_exa_supplied(self, mock_fetch) -> None:
        mock_fetch.return_value = {
            "10.1038/abc": OpenAlexWorkMetadata(source="Wrong", cited_by_count=1)
        }

        [result] = discover_module._hydrate_from_openalex(
            [self._result(source="Nature", cited_by_count=999)]
        )

        self.assertEqual(result.source, "Nature")
        self.assertEqual(result.cited_by_count, 999)

    @patch.object(discover_module, "fetch_metadata_by_doi")
    def test_zero_citations_is_not_treated_as_missing(self, mock_fetch) -> None:
        """0 is a real citation count and must not be overwritten by OpenAlex."""
        mock_fetch.return_value = {
            "10.1038/abc": OpenAlexWorkMetadata(cited_by_count=42)
        }

        [result] = discover_module._hydrate_from_openalex(
            [self._result(cited_by_count=0)]
        )

        self.assertEqual(result.cited_by_count, 0)

    @patch.object(discover_module, "fetch_metadata_by_doi")
    def test_skips_lookup_when_no_dois(self, mock_fetch) -> None:
        results = discover_module._hydrate_from_openalex([self._result(doi=None)])

        mock_fetch.assert_not_called()
        self.assertIsNone(results[0].source)

    @patch.object(discover_module, "fetch_metadata_by_doi")
    def test_unmatched_doi_leaves_result_untouched(self, mock_fetch) -> None:
        mock_fetch.return_value = {}

        [result] = discover_module._hydrate_from_openalex([self._result()])

        self.assertIsNone(result.source)
        self.assertEqual(result.institutions, [])


class TestFetchMetadataByDoi(unittest.TestCase):
    @patch.object(openalex_module, "_request_with_retry")
    def test_lookup_is_bounded_so_a_stall_cannot_hold_the_stream(
        self, mock_request
    ) -> None:
        """Enrichment must fail fast; the shared defaults would allow a ~30s stall."""
        mock_request.return_value = MagicMock(json=lambda: {"results": []})

        fetch_metadata_by_doi(["10.1038/abc"])

        kwargs = mock_request.call_args.kwargs
        self.assertEqual(kwargs["max_retries"], 1)
        self.assertLessEqual(kwargs["timeout"], 5)

    @patch.object(openalex_module, "_request_with_retry")
    def test_network_failure_degrades_to_no_metadata(self, mock_request) -> None:
        mock_request.side_effect = RuntimeError("openalex unreachable")

        self.assertEqual(fetch_metadata_by_doi(["10.1038/abc"]), {})

    @patch.object(openalex_module, "_request_with_retry")
    def test_batches_large_doi_sets(self, mock_request) -> None:
        mock_request.return_value = MagicMock(json=lambda: {"results": []})

        fetch_metadata_by_doi([f"10.1000/{i}" for i in range(95)])

        self.assertEqual(mock_request.call_count, 3)

    @patch.object(openalex_module, "_request_with_retry")
    def test_no_request_without_dois(self, mock_request) -> None:
        self.assertEqual(fetch_metadata_by_doi([None, "", "  "]), {})
        mock_request.assert_not_called()

    @patch.object(openalex_module, "_request_with_retry")
    def test_maps_venue_citations_and_institutions(self, mock_request) -> None:
        mock_request.return_value = MagicMock(
            json=lambda: {
                "results": [
                    {
                        "doi": "https://doi.org/10.1038/ABC",
                        "cited_by_count": 116,
                        "primary_location": {
                            "source": {"display_name": "Nature Communications"}
                        },
                        "authorships": [
                            {"institutions": [{"display_name": "ETH Zurich"}]},
                            {"institutions": [{"display_name": "ETH Zurich"}]},
                        ],
                    }
                ]
            }
        )

        metadata = fetch_metadata_by_doi(["10.1038/abc"])

        self.assertEqual(metadata["10.1038/abc"].source, "Nature Communications")
        self.assertEqual(metadata["10.1038/abc"].cited_by_count, 116)
        # Repeated affiliations collapse to one entry.
        self.assertEqual(metadata["10.1038/abc"].institutions, ["ETH Zurich"])


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
