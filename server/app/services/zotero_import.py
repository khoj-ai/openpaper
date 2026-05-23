import json
import logging
from datetime import datetime, timezone
from io import BytesIO
from typing import Any, Dict, List, Optional, Tuple
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
from app.database.models import RoleType, ZoteroImportSource, ZoteroImportStatus
from app.helpers.parser import (
    extract_pdf_text_and_offsets,
    validate_pdf_content,
    validate_url_and_fetch_pdf,
)
from app.helpers.s3 import s3_service
from app.helpers.subscription_limits import can_user_upload_paper
from app.integrations.zotero_api import ZoteroApiClient
from app.llm.utils import find_offsets
from app.schemas.user import CurrentUser
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


def _parse_zotero_date(date_str: Optional[str]) -> Optional[str]:
    if not date_str:
        return None
    try:
        s = date_str.strip()
        if len(s) >= 10:
            return s[:10]
        if len(s) == 7 and s[4] == "-":
            return s + "-01"
        if len(s) == 4 and s.isdigit():
            return s + "-01-01"
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


async def _resolve_pdf_bytes(
    client: ZoteroApiClient,
    item: Dict[str, Any],
) -> Tuple[Optional[bytes], str, Optional[str], Optional[str], List[Dict[str, Any]]]:
    """
    Returns (pdf_bytes, import_source, attachment_key, source_url, annotations).
    """
    item_key = item.get("key", "")
    data = item.get("data", {})
    children = client.get_children(item_key)
    pdf_attachment = client.find_pdf_attachment(children)

    if pdf_attachment:
        attachment_key = pdf_attachment.get("key", "")
        try:
            pdf_bytes = client.download_attachment_file(attachment_key)
            is_valid, err = await validate_pdf_content(pdf_bytes, source="zotero")
            if is_valid:
                attachment_children = client.get_children(attachment_key)
                annotations = client.get_annotations_for_attachment(attachment_children)
                return (
                    pdf_bytes,
                    ZoteroImportSource.PDF_ATTACHMENT,
                    attachment_key,
                    None,
                    annotations,
                )
            logger.warning(
                "Zotero PDF attachment invalid for %s: %s", item_key, err
            )
        except Exception as e:
            logger.warning(
                "Failed to download Zotero PDF for %s: %s", item_key, e, exc_info=True
            )

    for url in client.resolve_item_urls(data):
        is_valid, pdf_bytes, err = await validate_url_and_fetch_pdf(url)
        if is_valid and pdf_bytes:
            return pdf_bytes, ZoteroImportSource.URL, None, url, []

    return None, ZoteroImportSource.URL, None, None, []


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


async def import_batch(
    db: Session,
    *,
    user: CurrentUser,
    limit: int = 5,
) -> Dict[str, Any]:
    """
    Import journal articles and conference papers directly from Zotero.

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

    imported: List[Dict[str, Any]] = []
    errors: List[Dict[str, str]] = []
    skipped_already_imported = 0
    imported_via_url = 0
    start = 0
    page_size = 25

    while len(imported) < limit:
        items = client.get_top_importable_items(limit=page_size, start=start)
        if not items:
            break
        start += page_size

        for item in items:
            if len(imported) >= limit:
                break

            item_key = item.get("key", "")
            if not item_key:
                continue

            # Skip ghost/broken Zotero records that have no title and no URL/DOI.
            # These are unimportable and should not count as failures.
            item_data = item.get("data", {})
            if not (item_data.get("title") or "").strip() and not (item_data.get("DOI") or "").strip() and not (item_data.get("url") or "").strip():
                logger.debug("Skipping Zotero item %s: no title, DOI, or URL", item_key)
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

                # Stale row: previously failed, or completed but the paper has
                # since been deleted from the user's library. Drop it and retry.
                db.delete(existing_import)
                db.commit()

            can_upload, upload_err = can_user_upload_paper(db, user)
            if not can_upload:
                errors.append(
                    {"zotero_item_key": item_key, "error": upload_err or "Upload limit"}
                )
                break

            pdf_bytes, import_source, attachment_key, source_url, annotations = (
                await _resolve_pdf_bytes(client, item)
            )
            if not pdf_bytes:
                errors.append(
                    {
                        "zotero_item_key": item_key,
                        "error": "No PDF available from attachment or URL",
                    }
                )
                continue

            paper_upload_job = paper_upload_job_crud.create(
                db=db,
                obj_in=PaperUploadJobCreate(
                    started_at=datetime.now(timezone.utc)
                ),
                user=user,
            )
            if not paper_upload_job or not paper_upload_job.id:
                errors.append(
                    {"zotero_item_key": item_key, "error": "Failed to create upload job"}
                )
                continue

            upload_job_id = str(paper_upload_job.id)
            try:
                safe_filename = f"zotero-{item_key}.pdf"
                s3_object_key, file_url = await s3_service.upload_file(
                    BytesIO(pdf_bytes), safe_filename
                )

                try:
                    raw_text, page_offset_map = extract_pdf_text_and_offsets(pdf_bytes)
                except Exception as e:
                    logger.warning(
                        "Server-side PDF text extraction failed for %s: %s",
                        item_key,
                        e,
                    )
                    raw_text, page_offset_map = "", {}

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

                doi = data.get("DOI")
                if doi:
                    paper_crud.update(
                        db=db,
                        db_obj=paper,
                        obj_in=PaperUpdate(doi=doi),
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
                    [a.get("data", {}) for a in annotations] if annotations else None
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

                # Apply highlights/annotations inline; this also flips the
                # ZoteroImportedItem row to COMPLETED on success.
                apply_zotero_annotations(
                    db=db,
                    upload_job_id=upload_job_id,
                    paper_id=str(paper.id),
                    user=user,
                )

                if import_source == ZoteroImportSource.URL:
                    imported_via_url += 1

                imported.append(
                    {
                        "zotero_item_key": item_key,
                        "paper_id": str(paper_id),
                        "upload_job_id": upload_job_id,
                        "import_source": import_source,
                        "title": data.get("title"),
                    }
                )
            except Exception as e:
                logger.error(
                    "Zotero import failed for item %s: %s",
                    item_key,
                    e,
                    exc_info=True,
                )
                paper_upload_job_crud.mark_as_failed(
                    db=db, job_id=upload_job_id, user=user
                )
                errors.append({"zotero_item_key": item_key, "error": str(e)})

        if len(items) < page_size:
            break

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

        for ann_data in import_row.annotations_payload:
            if not isinstance(ann_data, dict):
                continue
            raw_text = (ann_data.get("annotationText") or "").strip()
            comment = (ann_data.get("annotationComment") or "").strip()
            if not raw_text and not comment:
                continue

            start_offset: Optional[int] = None
            end_offset: Optional[int] = None
            if raw_text and raw_content:
                so, eo = find_offsets(raw_text, raw_content)
                if so >= 0 and eo >= 0:
                    start_offset = so
                    end_offset = eo

            page_number = _page_from_annotation(ann_data)
            if (
                page_number is None
                and start_offset is not None
                and raw_file.page_offsets
            ):
                from app.helpers.parser import get_start_page_from_offset

                page_number = get_start_page_from_offset(
                    raw_file.page_offsets, start_offset
                )

            position = None
            pos_raw = ann_data.get("annotationPosition")
            if pos_raw:
                try:
                    position = (
                        json.loads(pos_raw) if isinstance(pos_raw, str) else pos_raw
                    )
                except json.JSONDecodeError:
                    position = None

            highlight = highlight_crud.create(
                db,
                obj_in=HighlightCreate(
                    paper_id=UUID(paper_id),
                    raw_text=raw_text or comment[:200] if comment else "",
                    start_offset=start_offset,
                    end_offset=end_offset,
                    page_number=page_number,
                    position=position,
                    role=RoleType.USER,
                    color=_map_zotero_color(ann_data.get("annotationColor")),
                ),
                user=user,
            )
            if not highlight or not highlight.id:
                continue

            if comment:
                annotation_crud.create(
                    db,
                    obj_in=AnnotationCreate(
                        paper_id=UUID(paper_id),
                        highlight_id=UUID(str(highlight.id)),
                        content=comment,
                        role=RoleType.USER,
                    ),
                    user=user,
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
