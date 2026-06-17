import json
import logging
import time
from typing import Any, Dict, List, Optional

import requests

logger = logging.getLogger(__name__)

ZOTERO_API_BASE = "https://api.zotero.org"
MAX_RETRIES = 3
IMPORTABLE_ITEM_TYPES = ("journalArticle", "conferencePaper", "preprint")


class ZoteroApiClient:
    """Read-only Zotero Web API v3 client."""

    def __init__(self, zotero_user_id: str, api_key: str):
        self.zotero_user_id = zotero_user_id
        self.api_key = api_key
        self._session = requests.Session()
        self._session.headers.update(
            {
                "Zotero-API-Key": api_key,
                "Zotero-API-Version": "3",
            }
        )

    @property
    def _user_base(self) -> str:
        return f"{ZOTERO_API_BASE}/users/{self.zotero_user_id}"

    def _request(
        self,
        method: str,
        url: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        stream: bool = False,
    ) -> requests.Response:
        last_error: Optional[Exception] = None
        for attempt in range(MAX_RETRIES):
            try:
                response = self._session.request(
                    method,
                    url,
                    params=params,
                    timeout=60,
                    allow_redirects=True,
                    stream=stream,
                )
                if response.status_code == 429:
                    retry_after = int(response.headers.get("Retry-After", "2"))
                    logger.warning(
                        "Zotero API rate-limited (429): %s %s; retrying after %ss "
                        "(attempt %d/%d)",
                        method,
                        url,
                        retry_after,
                        attempt + 1,
                        MAX_RETRIES,
                    )
                    # Record an error so a persistent 429 surfaces real context
                    # instead of the generic RuntimeError below.
                    last_error = requests.HTTPError(
                        f"429 Too Many Requests for url: {url}", response=response
                    )
                    time.sleep(retry_after)
                    continue
                backoff = response.headers.get("Backoff")
                if backoff:
                    time.sleep(int(backoff))
                response.raise_for_status()
                return response
            except requests.RequestException as e:
                last_error = e
                # raise_for_status()'s message omits the response body, which is
                # where Zotero explains *why* the call failed — capture it here.
                resp = getattr(e, "response", None)
                status = resp.status_code if resp is not None else "no response"
                body = resp.text[:500] if resp is not None and resp.text else ""
                logger.warning(
                    "Zotero API request failed: %s %s -> %s (attempt %d/%d): %s%s",
                    method,
                    url,
                    status,
                    attempt + 1,
                    MAX_RETRIES,
                    e,
                    f" | body: {body}" if body else "",
                )
                if attempt < MAX_RETRIES - 1:
                    time.sleep(2**attempt)
        logger.error(
            "Zotero API request giving up after %d attempts: %s %s",
            MAX_RETRIES,
            method,
            url,
        )
        raise last_error or RuntimeError("Zotero API request failed")

    def get_top_importable_items(
        self, *, limit: int = 25, start: int = 0
    ) -> List[Dict[str, Any]]:
        url = f"{self._user_base}/items/top"
        params = {
            "limit": min(limit, 100),
            "start": start,
            "sort": "dateModified",
            "direction": "desc",
            "itemType": " || ".join(IMPORTABLE_ITEM_TYPES),
        }
        response = self._request("GET", url, params=params)
        items = response.json()
        if not isinstance(items, list):
            return []
        return [
            item
            for item in items
            if item.get("data", {}).get("itemType") in IMPORTABLE_ITEM_TYPES
        ]

    def get_items_by_keys(self, item_keys: List[str]) -> List[Dict[str, Any]]:
        """Fetch specific Zotero items by their item keys.

        Zotero supports up to 50 keys per request via the itemKey query param.
        """
        if not item_keys:
            return []
        results: List[Dict[str, Any]] = []
        batch_size = 50
        for i in range(0, len(item_keys), batch_size):
            batch = item_keys[i : i + batch_size]
            url = f"{self._user_base}/items"
            params = {"itemKey": ",".join(batch), "limit": len(batch)}
            response = self._request("GET", url, params=params)
            items = response.json()
            if isinstance(items, list):
                results.extend(
                    item
                    for item in items
                    if item.get("data", {}).get("itemType") in IMPORTABLE_ITEM_TYPES
                )
        return results

    def get_children(self, item_key: str) -> List[Dict[str, Any]]:
        url = f"{self._user_base}/items/{item_key}/children"
        response = self._request("GET", url, params={"limit": 100})
        children = response.json()
        return children if isinstance(children, list) else []

    def get_collections(self, *, max_items: int = 3000) -> Dict[str, str]:
        """Return a ``{collection_key: name}`` map for the user's library.

        Used to translate the collection keys carried on each item into
        human-readable names for the import modal's collection filter.
        ``max_items`` caps pagination as a safety bound for unusually large
        libraries.
        """
        result: Dict[str, str] = {}
        url = f"{self._user_base}/collections"
        start = 0
        page_size = 100
        while start < max_items:
            response = self._request(
                "GET", url, params={"limit": page_size, "start": start}
            )
            items = response.json()
            if not isinstance(items, list) or not items:
                break
            for collection in items:
                data = collection.get("data", {}) or {}
                key = collection.get("key") or data.get("key")
                name = (data.get("name") or "").strip()
                if key and name:
                    result[key] = name
            if len(items) < page_size:
                break
            start += page_size
        return result

    def get_pdf_parent_item_keys(self, *, max_items: int = 3000) -> set:
        """Return the set of top-level item keys that have a stored PDF attachment.

        Fetches attachment items in bulk via a single paginated query rather than
        making a per-item ``get_children`` call, so the whole library can be
        classified cheaply before display.

        Only stored PDFs count (``linkMode`` ``imported_file`` / ``imported_url``);
        ``linked_url`` attachments are hyperlinks Zotero's file API cannot return
        as a usable PDF, matching the filter in :meth:`find_pdf_attachment`.

        ``max_items`` caps how many attachments are scanned as a safety bound for
        pathologically large libraries; if hit, some items may be reported as
        lacking a PDF.
        """
        parents: set = set()
        url = f"{self._user_base}/items"
        start = 0
        page_size = 100
        while start < max_items:
            params = {
                "itemType": "attachment",
                "limit": page_size,
                "start": start,
            }
            response = self._request("GET", url, params=params)
            items = response.json()
            if not isinstance(items, list) or not items:
                break
            for item in items:
                data = item.get("data", {})
                parent = data.get("parentItem")
                if not parent:
                    continue
                # Mirror find_pdf_attachment's "stored PDF" predicate so the modal
                # only marks items importable when the import pipeline could
                # actually download a usable PDF from the attachment.
                if not self._attachment_is_pdf(data):
                    continue
                if not self._attachment_is_stored(data):
                    continue
                parents.add(parent)
            if len(items) < page_size:
                break
            start += page_size
        else:
            logger.warning(
                "Zotero PDF attachment scan hit the %d-item cap; some library "
                "items may be reported as having no PDF.",
                max_items,
            )
        return parents

    @staticmethod
    def _attachment_is_pdf(data: Dict[str, Any]) -> bool:
        """True if an attachment's ``data`` describes a PDF (by content type or filename)."""
        content_type = (data.get("contentType") or "").lower()
        filename = (data.get("filename") or "").lower()
        return content_type == "application/pdf" or filename.endswith(".pdf")

    @staticmethod
    def _attachment_is_stored(data: Dict[str, Any]) -> bool:
        """True if the attachment's file is stored in Zotero's cloud (downloadable via API).

        ``linkMode`` ``"imported_file"`` / ``"imported_url"`` are stored copies;
        ``"linked_url"`` / ``"linked_file"`` are mere references the file API cannot
        return as a usable PDF.
        """
        return (data.get("linkMode") or "").lower() in ("imported_file", "imported_url")

    @staticmethod
    def find_pdf_attachment(children: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        """Return the best PDF attachment child, preferring stored files over linked URLs.

        Zotero attachments have a ``linkMode`` field:
        - ``"imported_file"`` / ``"imported_url"`` — file is stored in Zotero's cloud.
        - ``"linked_url"`` — just a hyperlink; no file is stored and Zotero's file
          download API will not return a usable PDF (often redirects to a paywalled page).

        We do two passes: first for stored PDFs, then as a fallback for linked ones.
        """
        stored_pdf: Optional[Dict[str, Any]] = None
        linked_pdf: Optional[Dict[str, Any]] = None

        for child in children:
            data = child.get("data", {})
            if data.get("itemType") != "attachment":
                continue
            if not ZoteroApiClient._attachment_is_pdf(data):
                continue
            if ZoteroApiClient._attachment_is_stored(data):
                if stored_pdf is None:
                    stored_pdf = child
            else:
                if linked_pdf is None:
                    linked_pdf = child

        return stored_pdf or linked_pdf

    def download_attachment_file(self, attachment_key: str) -> bytes:
        url = f"{self._user_base}/items/{attachment_key}/file"
        response = self._request("GET", url, stream=True)
        return response.content

    @staticmethod
    def get_annotations_for_attachment(
        children: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        return [
            child
            for child in children
            if child.get("data", {}).get("itemType") == "annotation"
        ]

    @staticmethod
    def resolve_item_urls(item_data: Dict[str, Any]) -> List[str]:
        urls: List[str] = []
        url = (item_data.get("url") or "").strip()
        if url:
            urls.append(url)
        doi = (item_data.get("DOI") or "").strip()
        if doi:
            if doi.startswith("http"):
                urls.append(doi)
            else:
                urls.append(f"https://doi.org/{doi}")
        return urls
