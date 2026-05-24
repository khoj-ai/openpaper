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
                    time.sleep(retry_after)
                    continue
                backoff = response.headers.get("Backoff")
                if backoff:
                    time.sleep(int(backoff))
                response.raise_for_status()
                return response
            except requests.RequestException as e:
                last_error = e
                if attempt < MAX_RETRIES - 1:
                    time.sleep(2**attempt)
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

    def get_children(self, item_key: str) -> List[Dict[str, Any]]:
        url = f"{self._user_base}/items/{item_key}/children"
        response = self._request("GET", url, params={"limit": 100})
        children = response.json()
        return children if isinstance(children, list) else []

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
            content_type = (data.get("contentType") or "").lower()
            filename = (data.get("filename") or "").lower()
            if content_type != "application/pdf" and not filename.endswith(".pdf"):
                continue
            link_mode = (data.get("linkMode") or "").lower()
            if link_mode in ("imported_file", "imported_url"):
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
