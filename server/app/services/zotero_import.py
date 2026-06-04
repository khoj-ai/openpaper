import asyncio
import json
import logging
import re
from datetime import datetime, timezone
from io import BytesIO
from typing import Any, Dict, List, Literal, Optional, Tuple, TypedDict
from uuid import UUID

from app.database.crud.annotation_crud import AnnotationCreate, annotation_crud
from app.database.crud.highlight_crud import HighlightCreate, highlight_crud
from app.database.crud.paper_crud import PaperCreate, PaperUpdate, paper_crud
from app.database.crud.paper_tag_crud import PaperTagCreate, paper_tag_crud
from app.database.crud.paper_upload_crud import (
    PaperUploadJobCreate,
    paper_upload_job_crud,
)
from app.database.crud.zotero_crud import zotero_crud
from app.database.crud.zotero_import_crud import zotero_import_crud
from app.database.database import SessionLocal
from app.database.models import Paper, RoleType, ZoteroImportedItem, ZoteroImportSource, ZoteroImportStatus
from app.helpers.paper_search import normalize_doi, normalize_paper_title
from app.helpers.parser import (
    extract_pdf_page_dimensions,
    extract_pdf_text_and_offsets,
    generate_pdf_preview_from_bytes,
    validate_pdf_content,
    validate_url_and_fetch_pdf,
)
from app.helpers.s3 import s3_service
from app.helpers.subscription_limits import (
    can_user_upload_paper,
    get_remaining_paper_upload_slots,
)
from app.integrations.zotero_api import ZoteroApiClient
from app.llm.utils import find_offsets
from app.schemas.user import CurrentUser
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

ZOTERO_IMPORT_CONCURRENCY = 10


class ImportOneResult(TypedDict, total=False):
    status: Literal["imported", "error"]
    zotero_item_key: str
    paper_id: str
    upload_job_id: str
    import_source: str
    title: Optional[str]
    error: str
    imported_via_url: bool


def _parse_zotero_date(date_str: Optional[str]) -> Optional[str]:
    if not date_str:
        return None
    try:
        s = date_str.strip()
        # ISO format: starts with YYYY-MM-DD
        iso_match = re.match(r"^(\d{4}-\d{2}-\d{2})", s)
        if iso_match:
            return iso_match.group(1)
        # ISO partial: YYYY-MM
        if len(s) == 7 and s[4] == "-":
            return s + "-01"
        # Bare 4-digit year
        if len(s) == 4 and s.isdigit():
            return s + "-01-01"
        # Human-readable date (e.g. "August 3, 2025"): extract 4-digit year
        year_match = re.search(r"\b(\d{4})\b", s)
        if year_match:
            return year_match.group(1) + "-01-01"
    except Exception:
        pass
    return None


def _zotero_creators_to_authors(creators: List[Dict[str, Any]]) -> List[str]:
    authors: List[str] = []
    for creator in creators:
        if creator.get("creatorType") not in ("author", None):
            continue
        first = (creator.get("firstName") or "").strip()
        last = (creator.get("lastName") or "").strip()
        name = (creator.get("name") or "").strip()
        if name:
            authors.append(name)
        elif first or last:
            authors.append(f"{first} {last}".strip())
    return authors


def _map_zotero_color(hex_color: Optional[str]) -> str:
    if not hex_color:
        return "yellow"
    hex_color = hex_color.lower().lstrip("#")
    if len(hex_color) != 6:
        return "yellow"
    try:
        r = int(hex_color[0:2], 16)
        g = int(hex_color[2:4], 16)
        b = int(hex_color[4:6], 16)
    except ValueError:
        return "yellow"
    best = "yellow"
    best_dist = float("inf")
    palette = {
        "yellow": (255, 235, 59),
        "green": (76, 175, 80),
        "blue": (33, 150, 243),
        "pink": (233, 30, 99),
        "purple": (156, 39, 176),
    }
    for name, (pr, pg, pb) in palette.items():
        dist = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2
        if dist < best_dist:
            best_dist = dist
            best = name
    return best


def _page_from_annotation(data: Dict[str, Any]) -> Optional[int]:
    page_label = data.get("annotationPageLabel")
    if page_label:
        try:
            return int(str(page_label).strip())
        except ValueError:
            pass
    position_raw = data.get("annotationPosition")
    if position_raw:
        try:
            position = (
                json.loads(position_raw)
                if isinstance(position_raw, str)
                else position_raw
            )
            page_index = position.get("pageIndex")
            if page_index is not None:
                return int(page_index) + 1
        except (json.JSONDecodeError, TypeError, ValueError):
            pass
    return None


def _convert_zotero_position(ann_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Convert a Zotero annotationPosition (PDF-point coordinate space) into the
    ScaledPosition dict that react-pdf-highlighter-extended consumes.

    Zotero format:
        { "pageIndex": 0, "rects": [[x1,y1,x2,y2], ...] }  (y=0 at bottom)

    ScaledPosition format (usePdfCoordinates=true lets the viewer handle the
    y-axis flip internally):
        {
          "boundingRect": {"x1":…,"y1":…,"x2":…,"y2":…,"width":…,"height":…,"pageNumber":1},
          "rects": [...same shape...],
          "usePdfCoordinates": true
        }

    Page width/height (required by the viewer) are read from the _page_width /
    _page_height keys that import_batch embeds in each annotation dict.
    """
    pos_raw = ann_data.get("annotationPosition")
    if not pos_raw:
        return None
    try:
        position = json.loads(pos_raw) if isinstance(pos_raw, str) else pos_raw
    except (json.JSONDecodeError, TypeError):
        return None

    page_index = position.get("pageIndex", 0)
    page_number = page_index + 1
    raw_rects = position.get("rects") or []
    if not raw_rects:
        return None

    page_w = float(ann_data.get("_page_width") or 0)
    page_h = float(ann_data.get("_page_height") or 0)

    rects: List[Dict[str, Any]] = []
    for r in raw_rects:
        try:
            if isinstance(r, (list, tuple)) and len(r) >= 4:
                x1, y1, x2, y2 = float(r[0]), float(r[1]), float(r[2]), float(r[3])
            elif isinstance(r, dict):
                x1 = float(r.get("x", r.get("x1", 0)))
                y1 = float(r.get("y", r.get("y1", 0)))
                x2 = x1 + float(r.get("width", 0)) if "width" in r else float(r.get("x2", 0))
                y2 = y1 + float(r.get("height", 0)) if "height" in r else float(r.get("y2", 0))
            else:
                continue
        except (TypeError, ValueError):
            continue
        rects.append({
            "x1": x1, "y1": y1, "x2": x2, "y2": y2,
            "width": page_w, "height": page_h,
            "pageNumber": page_number,
        })

    if not rects:
        return None

    bounding = {
        "x1": min(r["x1"] for r in rects),
        "y1": min(r["y1"] for r in rects),
        "x2": max(r["x2"] for r in rects),
        "y2": max(r["y2"] for r in rects),
        "width": page_w,
        "height": page_h,
        "pageNumber": page_number,
    }
    return {"boundingRect": bounding, "rects": rects, "usePdfCoordinates": True}


def _serialize_annotations_payload(
    annotations: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    return [
        {"key": ann.get("key", ""), "data": ann.get("data", {})}
        for ann in annotations
        if ann.get("key")
    ]


def _normalize_payload_item(
    item: Dict[str, Any],
) -> Optional[Tuple[str, Dict[str, Any]]]:
    if not isinstance(item, dict):
        return None
    if "data" in item and item.get("key"):
        data = item.get("data")
        if isinstance(data, dict):
            return str(item["key"]), data
    if item.get("annotationType") is not None or item.get("annotationText") is not None:
        key = item.get("key") or item.get("annotationKey")
        if key:
            return str(key), item
    return None


def _embed_page_dims_in_annotation_data(
    ann_data: Dict[str, Any],
    page_dims: Dict[int, Tuple[float, float]],
) -> None:
    pos_raw = ann_data.get("annotationPosition")
    if not pos_raw:
        return
    try:
        pos = json.loads(pos_raw) if isinstance(pos_raw, str) else pos_raw
        idx = pos.get("pageIndex", 0)
    except (json.JSONDecodeError, TypeError, AttributeError):
        idx = 0
    w, h = page_dims.get(idx, (0.0, 0.0))
    ann_data["_page_width"] = w
    ann_data["_page_height"] = h


def _get_page_dims_for_paper(paper: Paper) -> Dict[int, Tuple[float, float]]:
    if not paper.s3_object_key:
        return {}
    try:
        pdf_bytes = s3_service.download_bytes(str(paper.s3_object_key))
        return extract_pdf_page_dimensions(pdf_bytes)
    except Exception as e:
        logger.warning(
            "Failed to download PDF for page dimensions (paper %s): %s",
            paper.id,
            e,
        )
        return {}


def _apply_single_zotero_annotation(
    db: Session,
    *,
    paper_id: UUID,
    user: CurrentUser,
    zotero_annotation_key: str,
    ann_data: Dict[str, Any],
    raw_content: str,
    page_offsets: Optional[Dict[int, Tuple[int, int]]],
) -> bool:
    """Create a highlight (+ optional comment) for one Zotero annotation. Returns True if created."""
    ann_type = (ann_data.get("annotationType") or "highlight").lower()

    if ann_type == "ink":
        return False

    raw_text = (ann_data.get("annotationText") or "").strip()
    comment = (ann_data.get("annotationComment") or "").strip()

    is_text_annotation = ann_type in ("highlight", "underline")
    if ann_type == "note":
        if not comment:
            return False
        raw_text = ""
    elif ann_type == "image":
        raw_text = ""
    elif is_text_annotation and not raw_text and not comment:
        return False

    start_offset: Optional[int] = None
    end_offset: Optional[int] = None
    if raw_text and raw_content:
        so, eo = find_offsets(raw_text, raw_content)
        if so >= 0 and eo >= 0:
            start_offset = so
            end_offset = eo

    page_number = _page_from_annotation(ann_data)
    if page_number is None and start_offset is not None and page_offsets:
        from app.helpers.parser import get_start_page_from_offset

        page_number = get_start_page_from_offset(page_offsets, start_offset)

    position = _convert_zotero_position(ann_data)

    highlight = highlight_crud.create(
        db,
        obj_in=HighlightCreate(
            paper_id=paper_id,
            raw_text=raw_text,
            start_offset=start_offset,
            end_offset=end_offset,
            page_number=page_number,
            position=position,
            role=RoleType.USER,
            color=_map_zotero_color(ann_data.get("annotationColor")),
            zotero_annotation_key=zotero_annotation_key,
        ),
        user=user,
    )
    if not highlight or not highlight.id:
        return False

    if comment:
        annotation_crud.create(
            db,
            obj_in=AnnotationCreate(
                paper_id=paper_id,
                highlight_id=UUID(str(highlight.id)),
                content=comment,
                role=RoleType.USER,
            ),
            user=user,
        )
    return True


def _try_backfill_or_apply_annotation(
    db: Session,
    *,
    paper_id: UUID,
    user: CurrentUser,
    zotero_annotation_key: str,
    ann_data: Dict[str, Any],
    raw_content: str,
    page_offsets: Optional[Dict[int, Tuple[int, int]]],
) -> bool:
    """
    Backfill an existing highlight's Zotero key when possible; otherwise create a new one.
    Returns True when a key was backfilled or a new highlight was created.
    """
    ann_type = (ann_data.get("annotationType") or "highlight").lower()
    if ann_type == "ink":
        return False

    raw_text = (ann_data.get("annotationText") or "").strip()
    comment = (ann_data.get("annotationComment") or "").strip()
    if ann_type == "note":
        if not comment:
            return False
        raw_text = ""
    elif ann_type == "image":
        raw_text = ""
    elif ann_type in ("highlight", "underline") and not raw_text and not comment:
        return False

    page_number = _page_from_annotation(ann_data)
    candidate = highlight_crud.find_backfill_candidate(
        db,
        paper_id=paper_id,
        raw_text=raw_text,
        page_number=page_number,
    )
    if candidate:
        highlight_crud.set_zotero_annotation_key(
            db,
            highlight=candidate,
            zotero_annotation_key=zotero_annotation_key,
        )
        return True

    return _apply_single_zotero_annotation(
        db,
        paper_id=paper_id,
        user=user,
        zotero_annotation_key=zotero_annotation_key,
        ann_data=ann_data,
        raw_content=raw_content,
        page_offsets=page_offsets,
    )


async def _resolve_pdf_bytes(
    client: ZoteroApiClient,
    item: Dict[str, Any],
) -> Tuple[Optional[bytes], str, Optional[str], Optional[str], List[Dict[str, Any]], Optional[str]]:
    """
    Returns (pdf_bytes, import_source, attachment_key, source_url, annotations, failure_reason).
    failure_reason is set when pdf_bytes is None, describing why the PDF could not be retrieved.
    """
    item_key = item.get("key", "")
    data = item.get("data", {})
    children = await asyncio.to_thread(client.get_children, item_key)
    pdf_attachment = client.find_pdf_attachment(children)

    failure_reason: Optional[str] = None

    if pdf_attachment:
        attachment_key = pdf_attachment.get("key", "")
        link_mode = (pdf_attachment.get("data", {}).get("linkMode") or "").lower()
        if link_mode == "linked_file":
            failure_reason = (
                "PDF is a linked local file and cannot be accessed via the Zotero API. "
                "In Zotero, right-click the attachment and choose \"Store Copy of File\"."
            )
        elif link_mode == "linked_url":
            failure_reason = (
                "PDF is a linked URL (e.g. a paywalled journal page) and cannot be downloaded directly. "
                "In Zotero, attach the PDF file itself instead of a URL."
            )
        else:
            try:
                pdf_bytes = await asyncio.to_thread(
                    client.download_attachment_file, attachment_key
                )
                is_valid, err = await validate_pdf_content(pdf_bytes, source="zotero")
                if is_valid:
                    attachment_children = await asyncio.to_thread(
                        client.get_children, attachment_key
                    )
                    annotations = client.get_annotations_for_attachment(attachment_children)
                    return (
                        pdf_bytes,
                        ZoteroImportSource.PDF_ATTACHMENT,
                        attachment_key,
                        None,
                        annotations,
                        None,
                    )
                logger.warning(
                    "Zotero PDF attachment invalid for %s: %s", item_key, err
                )
                failure_reason = f"PDF attachment could not be validated: {err}"
            except Exception as e:
                logger.warning(
                    "Failed to download Zotero PDF for %s: %s", item_key, e, exc_info=True
                )
                failure_reason = "PDF attachment download failed."
    else:
        failure_reason = "No PDF attached to this item in Zotero."

    urls = list(client.resolve_item_urls(data))
    for url in urls:
        is_valid, pdf_bytes, err = await validate_url_and_fetch_pdf(url)
        if is_valid and pdf_bytes:
            return pdf_bytes, ZoteroImportSource.URL, None, url, [], None

    if urls:
        failure_reason = (
            "Could not download a PDF from the item's URL. "
            "The page may require authentication or does not link to a PDF directly."
        )

    return None, ZoteroImportSource.URL, None, None, [], failure_reason


def _resolve_zotero_attachment_info(
    client: ZoteroApiClient,
    item: Dict[str, Any],
) -> Tuple[str, Optional[str], Optional[str], List[Dict[str, Any]]]:
    """Return attachment metadata and annotations without downloading the PDF."""
    item_key = item.get("key", "")
    data = item.get("data", {})
    children = client.get_children(item_key)
    pdf_attachment = client.find_pdf_attachment(children)

    if pdf_attachment:
        attachment_key = pdf_attachment.get("key", "")
        attachment_children = client.get_children(attachment_key)
        annotations = client.get_annotations_for_attachment(attachment_children)
        return (
            ZoteroImportSource.PDF_ATTACHMENT,
            attachment_key or None,
            None,
            annotations,
        )

    urls = client.resolve_item_urls(data)
    source_url = urls[0] if urls else None
    return ZoteroImportSource.URL, None, source_url, []


async def _link_zotero_item_to_existing_paper(
    db: Session,
    *,
    client: ZoteroApiClient,
    item: Dict[str, Any],
    item_key: str,
    paper: Paper,
    user: CurrentUser,
) -> None:
    """Link a Zotero item to an existing paper and merge any new annotations."""
    import_source, attachment_key, source_url, annotations = (
        _resolve_zotero_attachment_info(client, item)
    )
    annotation_payload = (
        _serialize_annotations_payload(annotations) if annotations else None
    )

    import_row = zotero_import_crud.create(
        db,
        user_id=user.id,
        zotero_item_key=item_key,
        import_source=import_source,
        zotero_attachment_key=attachment_key,
        source_url=source_url,
        paper_id=UUID(str(paper.id)),
        annotations_payload=annotation_payload,
        status=ZoteroImportStatus.COMPLETED,
    )

    if (
        import_source == ZoteroImportSource.PDF_ATTACHMENT
        and attachment_key
        and annotations
    ):
        _sync_item(db, client=client, import_row=import_row, user=user)


def _apply_zotero_tags(
    db: Session,
    *,
    paper_id: UUID,
    tags_data: List[Dict[str, Any]],
    user: "CurrentUser",
) -> None:
    for tag_entry in tags_data:
        if not isinstance(tag_entry, dict):
            continue
        tag_name = (tag_entry.get("tag") or "").strip()
        if not tag_name:
            continue
        try:
            tag = paper_tag_crud.get_by_name(db, name=tag_name, user=user)
            if not tag:
                tag = paper_tag_crud.create(
                    db, obj_in=PaperTagCreate(name=tag_name), user=user
                )
            paper_tag_crud.add_tag_to_paper(
                db, paper_id=paper_id, tag_id=tag.id, user=user
            )
        except Exception as e:
            logger.warning(
                "Failed to apply Zotero tag '%s' to paper %s: %s",
                tag_name,
                paper_id,
                e,
            )


def _compute_max_new_imports(
    db: Session, user: CurrentUser, limit: int
) -> Tuple[int, Optional[str]]:
    """Return how many new papers can be imported and an error if at upload limit."""
    can_upload, upload_err = can_user_upload_paper(db, user)
    if not can_upload:
        return 0, upload_err

    remaining = get_remaining_paper_upload_slots(db, user)
    return min(limit, remaining), None


async def _discover_import_candidates(
    db: Session,
    *,
    client: ZoteroApiClient,
    user: CurrentUser,
    limit: int,
) -> Tuple[
    List[Dict[str, Any]],
    List[Tuple[Dict[str, Any], str, str]],
    int,
    List[Dict[str, str]],
]:
    """
    Sequential scan of Zotero items: skip/link/dedup, then collect import candidates.

    Returns (candidates, deferred_links, skipped_already_imported, errors).
    deferred_links entries are (item, item_key, first_item_key_in_batch).
    """
    candidates: List[Dict[str, Any]] = []
    deferred_links: List[Tuple[Dict[str, Any], str, str]] = []
    errors: List[Dict[str, str]] = []
    skipped_already_imported = 0
    batch_doi_claimed: Dict[str, str] = {}
    batch_title_claimed: Dict[str, str] = {}
    start = 0
    page_size = 25
    upload_limit_hit = False

    max_new, upload_err = _compute_max_new_imports(db, user, limit)

    while len(candidates) < max_new and not upload_limit_hit:
        items = client.get_top_importable_items(limit=page_size, start=start)
        if not items:
            break
        start += page_size

        for item in items:
            if len(candidates) >= max_new:
                break

            item_key = item.get("key", "")
            if not item_key:
                continue

            item_data = item.get("data", {})
            if (
                not (item_data.get("title") or "").strip()
                and not (item_data.get("DOI") or "").strip()
                and not (item_data.get("url") or "").strip()
            ):
                logger.debug(
                    "Skipping Zotero item %s: no title, DOI, or URL", item_key
                )
                continue

            existing_import = zotero_import_crud.get_by_item_key(
                db, user_id=user.id, zotero_item_key=item_key
            )
            if existing_import:
                paper_still_exists = False
                if existing_import.paper_id:
                    linked_paper = paper_crud.get(
                        db, id=str(existing_import.paper_id), user=user
                    )
                    paper_still_exists = bool(linked_paper)

                if (
                    existing_import.status == ZoteroImportStatus.COMPLETED
                    and paper_still_exists
                ):
                    skipped_already_imported += 1
                    continue

                db.delete(existing_import)
                db.commit()

            doi = normalize_doi(item_data.get("DOI"))
            if doi:
                target_paper = paper_crud.get_by_doi_for_user(
                    db, user_id=user.id, doi=doi
                )
                if target_paper:
                    await _link_zotero_item_to_existing_paper(
                        db,
                        client=client,
                        item=item,
                        item_key=item_key,
                        paper=target_paper,
                        user=user,
                    )
                    skipped_already_imported += 1
                    continue

                if doi in batch_doi_claimed:
                    deferred_links.append(
                        (item, item_key, batch_doi_claimed[doi])
                    )
                    skipped_already_imported += 1
                    continue

            norm_title = normalize_paper_title(item_data.get("title"))
            if norm_title:
                target_paper = paper_crud.get_by_normalized_title_for_user(
                    db,
                    user_id=user.id,
                    title=str(item_data.get("title") or ""),
                )
                if target_paper:
                    await _link_zotero_item_to_existing_paper(
                        db,
                        client=client,
                        item=item,
                        item_key=item_key,
                        paper=target_paper,
                        user=user,
                    )
                    skipped_already_imported += 1
                    continue

                if norm_title in batch_title_claimed:
                    deferred_links.append(
                        (item, item_key, batch_title_claimed[norm_title])
                    )
                    skipped_already_imported += 1
                    continue

            if len(candidates) >= max_new:
                if max_new == 0 and upload_err:
                    errors.append(
                        {
                            "zotero_item_key": item_key,
                            "error": upload_err or "Upload limit",
                        }
                    )
                    upload_limit_hit = True
                break

            if max_new == 0:
                errors.append(
                    {
                        "zotero_item_key": item_key,
                        "error": upload_err or "Upload limit",
                    }
                )
                upload_limit_hit = True
                break

            if doi:
                batch_doi_claimed[doi] = item_key
            if norm_title:
                batch_title_claimed[norm_title] = item_key

            candidates.append(item)

        if len(items) < page_size:
            break

    return candidates, deferred_links, skipped_already_imported, errors


async def _import_one_paper(
    item: Dict[str, Any],
    *,
    user: CurrentUser,
    zotero_user_id: str,
    api_key: str,
) -> ImportOneResult:
    """Import a single Zotero item using its own DB session and Zotero client."""
    item_key = item.get("key", "")
    db = SessionLocal()
    client = ZoteroApiClient(zotero_user_id=zotero_user_id, api_key=api_key)
    upload_job_id: Optional[str] = None

    try:
        pdf_bytes, import_source, attachment_key, source_url, annotations, failure_reason = (
            await _resolve_pdf_bytes(client, item)
        )
        if not pdf_bytes:
            return {
                "status": "error",
                "zotero_item_key": item_key,
                "error": failure_reason or "No PDF available from attachment or URL",
            }

        paper_upload_job = paper_upload_job_crud.create(
            db=db,
            obj_in=PaperUploadJobCreate(started_at=datetime.now(timezone.utc)),
            user=user,
        )
        if not paper_upload_job or not paper_upload_job.id:
            return {
                "status": "error",
                "zotero_item_key": item_key,
                "error": "Failed to create upload job",
            }

        upload_job_id = str(paper_upload_job.id)
        safe_filename = f"zotero-{item_key}.pdf"
        s3_object_key, file_url = await asyncio.to_thread(
            _upload_pdf_to_s3, pdf_bytes, safe_filename
        )

        try:
            raw_text, page_offset_map = await asyncio.to_thread(
                extract_pdf_text_and_offsets, pdf_bytes
            )
        except Exception as e:
            logger.warning(
                "Server-side PDF text extraction failed for %s: %s",
                item_key,
                e,
            )
            raw_text, page_offset_map = "", {}

        try:
            page_dims = await asyncio.to_thread(
                extract_pdf_page_dimensions, pdf_bytes
            )
        except Exception as e:
            logger.warning(
                "Failed to extract page dimensions for %s: %s", item_key, e
            )
            page_dims = {}

        for ann in annotations:
            d = ann.get("data", {})
            pos_raw = d.get("annotationPosition")
            if pos_raw:
                try:
                    pos = (
                        json.loads(pos_raw)
                        if isinstance(pos_raw, str)
                        else pos_raw
                    )
                    idx = pos.get("pageIndex", 0)
                except (json.JSONDecodeError, TypeError, AttributeError):
                    idx = 0
                w, h = page_dims.get(idx, (0.0, 0.0))
                d["_page_width"] = w
                d["_page_height"] = h

        _, preview_url = await asyncio.to_thread(
            generate_pdf_preview_from_bytes, pdf_bytes
        )

        data = item.get("data", {})
        authors = _zotero_creators_to_authors(data.get("creators") or [])
        publish_date = _parse_zotero_date(data.get("date"))

        paper = paper_crud.create(
            db=db,
            obj_in=PaperCreate(
                file_url=file_url,
                s3_object_key=s3_object_key,
                upload_job_id=upload_job_id,
                raw_content=raw_text or None,
                page_offset_map=page_offset_map or None,
                preview_url=preview_url,
                title=data.get("title") or None,
                authors=authors or None,
                abstract=data.get("abstractNote") or None,
                publish_date=publish_date,
                size_in_kb=len(pdf_bytes) // 1024,
            ),
            user=user,
        )
        if not paper or not paper.id:
            raise Exception("Failed to create paper record after S3 upload")

        doi_value = data.get("DOI")
        if doi_value:
            paper_crud.update(
                db=db,
                db_obj=paper,
                obj_in=PaperUpdate(doi=doi_value),
                user=user,
            )

        paper_upload_job_crud.mark_as_completed(
            db=db, job_id=upload_job_id, user=user
        )

        paper_id = UUID(str(paper.id))

        _apply_zotero_tags(
            db,
            paper_id=paper_id,
            tags_data=data.get("tags") or [],
            user=user,
        )
        annotation_payload = (
            _serialize_annotations_payload(annotations) if annotations else None
        )

        zotero_import_crud.create(
            db,
            user_id=user.id,
            zotero_item_key=item_key,
            import_source=import_source,
            zotero_attachment_key=attachment_key,
            source_url=source_url,
            paper_id=paper_id,
            upload_job_id=UUID(upload_job_id),
            annotations_payload=annotation_payload,
            status=ZoteroImportStatus.PROCESSING,
        )

        apply_zotero_annotations(
            db=db,
            upload_job_id=upload_job_id,
            paper_id=str(paper.id),
            user=user,
        )

        return {
            "status": "imported",
            "zotero_item_key": item_key,
            "paper_id": str(paper_id),
            "upload_job_id": upload_job_id,
            "import_source": import_source,
            "title": data.get("title"),
            "imported_via_url": import_source == ZoteroImportSource.URL,
        }
    except Exception as e:
        logger.error(
            "Zotero import failed for item %s: %s",
            item_key,
            e,
            exc_info=True,
        )
        if upload_job_id:
            paper_upload_job_crud.mark_as_failed(
                db=db, job_id=upload_job_id, user=user
            )
        return {
            "status": "error",
            "zotero_item_key": item_key,
            "error": str(e),
        }
    finally:
        db.close()


def _upload_pdf_to_s3(pdf_bytes: bytes, safe_filename: str) -> Tuple[str, str]:
    """Run async S3 upload from a worker thread (boto3 blocks the event loop)."""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(
            s3_service.upload_file(BytesIO(pdf_bytes), safe_filename)
        )
    finally:
        loop.close()


def list_library(
    db: Session,
    *,
    user: CurrentUser,
    limit: int = 100,
) -> Dict[str, Any]:
    """
    Fetch and annotate importable items from the user's Zotero library.

    Returns up to `limit` items sorted by dateModified (Zotero default), each
    annotated with an `already_imported` flag.
    """
    connection = zotero_crud.get_by_user_id(db, user_id=user.id)
    if not connection:
        raise ValueError("Zotero account not connected")

    client = ZoteroApiClient(
        zotero_user_id=connection.zotero_user_id,
        api_key=connection.api_key,
    )

    items: List[Dict[str, Any]] = []
    page_size = 25
    start = 0
    while len(items) < limit:
        batch = client.get_top_importable_items(limit=page_size, start=start)
        if not batch:
            break
        items.extend(batch[: limit - len(items)])
        if len(batch) < page_size:
            break
        start += page_size

    imported_keys: set = set(
        row.zotero_item_key
        for row in db.query(ZoteroImportedItem.zotero_item_key)
        .join(Paper, ZoteroImportedItem.paper_id == Paper.id)
        .filter(
            ZoteroImportedItem.user_id == user.id,
            ZoteroImportedItem.status == ZoteroImportStatus.COMPLETED,
            ZoteroImportedItem.paper_id.isnot(None),
        )
        .all()
    )

    result = []
    for item in items:
        data = item.get("data", {})
        item_key = item.get("key", "")
        creators = data.get("creators") or []
        authors: List[str] = []
        for c in creators:
            if c.get("creatorType") not in ("author", None):
                continue
            first = (c.get("firstName") or "").strip()
            last = (c.get("lastName") or "").strip()
            name = (c.get("name") or "").strip()
            if name:
                authors.append(name)
            elif first or last:
                authors.append(f"{first} {last}".strip())

        item_type = data.get("itemType", "")
        venue = (
            data.get("publicationTitle")
            or data.get("proceedingsTitle")
            or data.get("conferenceName")
            or data.get("repository")
            or None
        )
        result.append(
            {
                "zotero_item_key": item_key,
                "title": (data.get("title") or "").strip(),
                "authors": authors,
                "date": _parse_zotero_date(data.get("date")),
                "item_type": item_type,
                "venue": venue,
                "already_imported": item_key in imported_keys,
            }
        )

    remaining = get_remaining_paper_upload_slots(db, user)
    return {"items": result, "remaining_slots": remaining}


async def _discover_candidates_by_keys(
    db: Session,
    *,
    client: ZoteroApiClient,
    user: CurrentUser,
    item_keys: List[str],
) -> Tuple[
    List[Dict[str, Any]],
    List[Tuple[Dict[str, Any], str, str]],
    int,
    List[Dict[str, str]],
]:
    """
    Resolve specific Zotero item keys into import candidates.

    Mirrors the dedup/linking logic of _discover_import_candidates but targets
    only the caller-specified keys instead of scanning the full library.
    Returns (candidates, deferred_links, skipped_already_imported, errors).
    """
    candidates: List[Dict[str, Any]] = []
    deferred_links: List[Tuple[Dict[str, Any], str, str]] = []
    errors: List[Dict[str, str]] = []
    skipped_already_imported = 0
    batch_doi_claimed: Dict[str, str] = {}
    batch_title_claimed: Dict[str, str] = {}

    max_new, upload_err = _compute_max_new_imports(db, user, len(item_keys))
    if max_new == 0:
        for key in item_keys:
            errors.append({"zotero_item_key": key, "error": upload_err or "Upload limit"})
        return candidates, deferred_links, skipped_already_imported, errors

    items = client.get_items_by_keys(item_keys)

    for item in items:
        if len(candidates) >= max_new:
            break

        item_key = item.get("key", "")
        if not item_key:
            continue

        item_data = item.get("data", {})
        if (
            not (item_data.get("title") or "").strip()
            and not (item_data.get("DOI") or "").strip()
            and not (item_data.get("url") or "").strip()
        ):
            continue

        existing_import = zotero_import_crud.get_by_item_key(
            db, user_id=user.id, zotero_item_key=item_key
        )
        if existing_import:
            paper_still_exists = False
            if existing_import.paper_id:
                linked_paper = paper_crud.get(
                    db, id=str(existing_import.paper_id), user=user
                )
                paper_still_exists = bool(linked_paper)

            if (
                existing_import.status == ZoteroImportStatus.COMPLETED
                and paper_still_exists
            ):
                skipped_already_imported += 1
                continue

            db.delete(existing_import)
            db.commit()

        doi = normalize_doi(item_data.get("DOI"))
        if doi:
            target_paper = paper_crud.get_by_doi_for_user(
                db, user_id=user.id, doi=doi
            )
            if target_paper:
                await _link_zotero_item_to_existing_paper(
                    db,
                    client=client,
                    item=item,
                    item_key=item_key,
                    paper=target_paper,
                    user=user,
                )
                skipped_already_imported += 1
                continue

            if doi in batch_doi_claimed:
                deferred_links.append((item, item_key, batch_doi_claimed[doi]))
                skipped_already_imported += 1
                continue

        norm_title = normalize_paper_title(item_data.get("title"))
        if norm_title:
            target_paper = paper_crud.get_by_normalized_title_for_user(
                db,
                user_id=user.id,
                title=str(item_data.get("title") or ""),
            )
            if target_paper:
                await _link_zotero_item_to_existing_paper(
                    db,
                    client=client,
                    item=item,
                    item_key=item_key,
                    paper=target_paper,
                    user=user,
                )
                skipped_already_imported += 1
                continue

            if norm_title in batch_title_claimed:
                deferred_links.append((item, item_key, batch_title_claimed[norm_title]))
                skipped_already_imported += 1
                continue

        if doi:
            batch_doi_claimed[doi] = item_key
        if norm_title:
            batch_title_claimed[norm_title] = item_key

        candidates.append(item)

    return candidates, deferred_links, skipped_already_imported, errors


async def import_batch(
    db: Session,
    *,
    user: CurrentUser,
    item_keys: List[str],
) -> Dict[str, Any]:
    """
    Import the specified Zotero items by key.

    Zotero already provides authoritative metadata (title, authors, abstract, DOI,
    publish date, tags, annotations), so this path skips the Celery jobs worker and
    the LLM extraction step entirely. We upload the PDF to S3, extract text + page
    offsets server-side for annotation offset matching, persist the paper with
    Zotero metadata, and apply highlights inline.
    """
    connection = zotero_crud.get_by_user_id(db, user_id=user.id)
    if not connection:
        raise ValueError("Zotero account not connected")

    client = ZoteroApiClient(
        zotero_user_id=connection.zotero_user_id,
        api_key=connection.api_key,
    )

    candidates, deferred_links, skipped_already_imported, errors = (
        await _discover_candidates_by_keys(
            db, client=client, user=user, item_keys=item_keys
        )
    )

    imported: List[Dict[str, Any]] = []
    imported_via_url = 0

    if candidates:
        sem = asyncio.Semaphore(ZOTERO_IMPORT_CONCURRENCY)

        async def run_one(item: Dict[str, Any]) -> ImportOneResult:
            async with sem:
                return await _import_one_paper(
                    item,
                    user=user,
                    zotero_user_id=connection.zotero_user_id,
                    api_key=connection.api_key,
                )

        raw_results = await asyncio.gather(
            *[run_one(item) for item in candidates],
            return_exceptions=True,
        )

        item_key_to_paper_id: Dict[str, str] = {}
        for i, raw in enumerate(raw_results):
            if isinstance(raw, BaseException):
                item_key = candidates[i].get("key", "")
                logger.error(
                    "Unexpected Zotero import failure for %s: %s",
                    item_key,
                    raw,
                    exc_info=True,
                )
                errors.append(
                    {
                        "zotero_item_key": item_key,
                        "error": str(raw),
                    }
                )
                continue

            if raw.get("status") == "error":
                errors.append(
                    {
                        "zotero_item_key": raw["zotero_item_key"],
                        "error": raw.get("error") or "Import failed",
                    }
                )
                continue

            imported.append(
                {
                    "zotero_item_key": raw["zotero_item_key"],
                    "paper_id": raw["paper_id"],
                    "upload_job_id": raw["upload_job_id"],
                    "import_source": raw["import_source"],
                    "title": raw.get("title"),
                }
            )
            if raw.get("imported_via_url"):
                imported_via_url += 1
            item_key_to_paper_id[raw["zotero_item_key"]] = raw["paper_id"]

        for item, item_key, first_item_key in deferred_links:
            first_paper_id = item_key_to_paper_id.get(first_item_key)
            if not first_paper_id:
                continue
            paper = paper_crud.get(db, id=first_paper_id, user=user)
            if not paper:
                continue
            await _link_zotero_item_to_existing_paper(
                db,
                client=client,
                item=item,
                item_key=item_key,
                paper=paper,
                user=user,
            )

    return {
        "imported": imported,
        "imported_count": len(imported),
        "imported_via_url": imported_via_url,
        "skipped_already_imported": skipped_already_imported,
        "errors": errors,
    }


def apply_zotero_annotations(
    db: Session,
    *,
    upload_job_id: str,
    paper_id: str,
    user: CurrentUser,
) -> None:
    import_row = zotero_import_crud.get_by_upload_job_id(
        db, upload_job_id=UUID(upload_job_id)
    )
    if not import_row:
        return

    if import_row.import_source == ZoteroImportSource.URL or not import_row.annotations_payload:
        zotero_import_crud.update_status(
            db,
            item=import_row,
            status=ZoteroImportStatus.COMPLETED,
            paper_id=UUID(paper_id),
        )
        return

    try:
        raw_file = paper_crud.read_raw_document_content(
            db, paper_id=paper_id, current_user=user
        )
        raw_content = raw_file.raw_content or ""
        page_offsets = raw_file.page_offsets

        for payload_item in import_row.annotations_payload:
            normalized = _normalize_payload_item(payload_item)
            if not normalized:
                continue
            zotero_key, ann_data = normalized
            _apply_single_zotero_annotation(
                db,
                paper_id=UUID(paper_id),
                user=user,
                zotero_annotation_key=zotero_key,
                ann_data=ann_data,
                raw_content=raw_content,
                page_offsets=page_offsets,
            )

        zotero_import_crud.update_status(
            db,
            item=import_row,
            status=ZoteroImportStatus.COMPLETED,
            paper_id=UUID(paper_id),
        )
    except Exception as e:
        logger.error(
            "Failed to apply Zotero annotations for job %s: %s",
            upload_job_id,
            e,
            exc_info=True,
        )
        zotero_import_crud.update_status(
            db,
            item=import_row,
            status=ZoteroImportStatus.FAILED,
            error_message=str(e),
            paper_id=UUID(paper_id),
        )


def _sync_item(
    db: Session,
    *,
    client: ZoteroApiClient,
    import_row: ZoteroImportedItem,
    user: CurrentUser,
) -> Dict[str, Any]:
    paper_id = import_row.paper_id
    if not paper_id or not import_row.zotero_attachment_key:
        raise ValueError("Import row is missing paper or attachment key")

    paper = paper_crud.get(db, id=str(paper_id), user=user)
    if not paper:
        raise ValueError("Linked paper no longer exists")

    attachment_children = client.get_children(import_row.zotero_attachment_key)
    remote_annotations = client.get_annotations_for_attachment(attachment_children)
    existing_keys = highlight_crud.get_zotero_annotation_keys_for_paper(
        db, paper_id=UUID(str(paper_id))
    )

    missing_annotations = [
        ann
        for ann in remote_annotations
        if ann.get("key") and ann["key"] not in existing_keys
    ]

    new_annotations_count = 0
    if missing_annotations:
        page_dims = _get_page_dims_for_paper(paper)
        raw_file = paper_crud.read_raw_document_content(
            db, paper_id=str(paper_id), current_user=user
        )
        raw_content = raw_file.raw_content or ""
        page_offsets = raw_file.page_offsets

        for ann in missing_annotations:
            zotero_key = str(ann["key"])
            ann_data = dict(ann.get("data") or {})
            _embed_page_dims_in_annotation_data(ann_data, page_dims)
            if _try_backfill_or_apply_annotation(
                db,
                paper_id=UUID(str(paper_id)),
                user=user,
                zotero_annotation_key=zotero_key,
                ann_data=ann_data,
                raw_content=raw_content,
                page_offsets=page_offsets,
            ):
                new_annotations_count += 1

    zotero_import_crud.update_after_sync(
        db,
        item=import_row,
        annotations_payload=_serialize_annotations_payload(remote_annotations),
        last_synced_at=datetime.now(timezone.utc),
    )

    return {
        "zotero_item_key": import_row.zotero_item_key,
        "paper_id": str(paper_id),
        "new_annotations_count": new_annotations_count,
    }


async def sync_batch(
    db: Session,
    *,
    user: CurrentUser,
    limit: int = 50,
) -> Dict[str, Any]:
    """Append-only sync of new Zotero annotations for already-imported PDF papers."""
    connection = zotero_crud.get_by_user_id(db, user_id=user.id)
    if not connection:
        raise ValueError("Zotero account not connected")

    client = ZoteroApiClient(
        zotero_user_id=connection.zotero_user_id,
        api_key=connection.api_key,
    )

    syncable = zotero_import_crud.list_syncable_by_user(
        db, user_id=user.id, limit=limit
    )

    synced: List[Dict[str, Any]] = []
    errors: List[Dict[str, str]] = []
    new_annotations_count = 0

    for import_row in syncable:
        try:
            result = _sync_item(
                db, client=client, import_row=import_row, user=user
            )
            synced.append(result)
            new_annotations_count += result["new_annotations_count"]
        except Exception as e:
            logger.error(
                "Zotero sync failed for item %s: %s",
                import_row.zotero_item_key,
                e,
                exc_info=True,
            )
            errors.append(
                {"zotero_item_key": import_row.zotero_item_key, "error": str(e)}
            )

    unique_paper_ids = {r["paper_id"] for r in synced if r.get("paper_id")}

    return {
        "synced": synced,
        "synced_papers_count": len(unique_paper_ids),
        "synced_zotero_items_count": len(synced),
        "new_annotations_count": new_annotations_count,
        "errors": errors,
    }


async def auto_import_new_papers(
    db: Session,
    *,
    user: CurrentUser,
) -> Dict[str, Any]:
    """
    For Researcher-plan users: detect Zotero library items not yet tracked in
    zotero_imported_items and import them automatically, subject to the user's
    remaining paper upload slots.
    """
    library = list_library(db, user=user, limit=100)
    new_keys = [
        item["zotero_item_key"]
        for item in library["items"]
        if not item["already_imported"]
    ]

    if not new_keys:
        return {"auto_imported_count": 0, "skipped_limit_reached": False}

    can_upload, _ = can_user_upload_paper(db, user)
    if not can_upload:
        logger.info(
            "auto_import_new_papers: upload limit reached for user %s, skipping %d items",
            user.id,
            len(new_keys),
        )
        return {"auto_imported_count": 0, "skipped_limit_reached": True}

    remaining = get_remaining_paper_upload_slots(db, user)
    keys_to_import = new_keys[:remaining]

    if not keys_to_import:
        return {"auto_imported_count": 0, "skipped_limit_reached": True}

    result = await import_batch(db, user=user, item_keys=keys_to_import)
    return {
        "auto_imported_count": result.get("imported_count", 0),
        "skipped_limit_reached": len(new_keys) > len(keys_to_import),
    }
