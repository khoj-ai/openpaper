import io
import logging
import uuid
from datetime import datetime
from typing import Optional, Tuple

import pymupdf
import requests
from PIL import Image
from pypdf import PdfReader

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

MAX_UPLOAD_SIZE_MB = 30
DOCUMENT_PAGE_LIMIT = 800


def get_start_page_from_offset(offsets: dict[int, Tuple[int, int]], offset: int) -> int:
    """
    Get the starting page number for a given text offset.
    """
    # Get last offset to ensure the offset is within bounds
    if not offsets:
        return -1  # Return -1 if no offsets are available
    last_page_num = max(offsets.keys())
    last_offset = offsets[last_page_num][1]
    if offset < 0 or offset >= last_offset:
        return -1  # Return -1 if the offset is out of bounds

    # Iterate through the offsets to find the page number for the given offset
    for page_num, (start, end) in offsets.items():
        if start <= offset < end:
            return page_num

    # Return -1 if no matching page is found. This condition should not occur if the offset is valid. Technically, the code should be unreachable given above checks, but need for completeness.
    return -1


def _detect_pdf_mime_type(pdf_bytes: bytes) -> bool:
    """
    Simple PDF detection without python-magic dependency.
    Returns True if the bytes appear to be a PDF.
    """
    # Check PDF header
    if not pdf_bytes.startswith(b"%PDF-"):
        return False

    # Additional basic checks for PDF structure
    # Look for common PDF markers
    pdf_markers = [b"%%EOF", b"/Type", b"/Catalog", b"xref"]

    # Convert to lowercase for case-insensitive search
    pdf_content = pdf_bytes.lower()

    # Check if at least 2 PDF markers are present
    marker_count = sum(1 for marker in pdf_markers if marker.lower() in pdf_content)

    return marker_count >= 2


async def validate_pdf_content(
    pdf_bytes: bytes, source: str = "upload"
) -> tuple[bool, str]:
    """
    Perform lightweight validation on PDF content.
    Returns (is_valid, error_message).
    """
    try:
        # Check file size
        if len(pdf_bytes) > MAX_UPLOAD_SIZE_MB * 1024 * 1024:
            return False, f"File too large (max {MAX_UPLOAD_SIZE_MB}MB)"

        # Check minimum file size (at least 1KB)
        if len(pdf_bytes) < 1024:
            return False, "File too small to be a valid PDF"

        # Verify it's a PDF using simple detection
        if not _detect_pdf_mime_type(pdf_bytes):
            return False, "File does not appear to be a valid PDF"

        # Try to read PDF structure
        pdf_stream = io.BytesIO(pdf_bytes)
        try:
            reader = PdfReader(pdf_stream)

            # Check if PDF has pages
            if len(reader.pages) == 0:
                return False, "PDF contains no pages"

            # Guard against extremely long PDFs that may exceed LLM context limits
            if len(reader.pages) > DOCUMENT_PAGE_LIMIT:
                return False, f"PDF exceeds the {DOCUMENT_PAGE_LIMIT}-page limit"

            # Check if PDF is encrypted and can't be processed
            if reader.is_encrypted:
                return False, "Encrypted PDFs are not supported"

            # Try to extract text from first page to verify it's readable
            first_page = reader.pages[0]
            text = first_page.extract_text()

            # Check if we can extract any text (even if minimal)
            # Some PDFs might be image-only but still valid
            if len(text.strip()) < 10:
                logger.warning(
                    f"PDF from {source} has minimal text content - might be image-only"
                )
                return False, "PDF appears to have minimal text content"

        except Exception as e:
            return False, f"PDF structure is corrupted or unreadable: {str(e)}"

        return True, ""

    except Exception as e:
        logger.error(f"Error validating PDF: {str(e)}")
        return False, f"Failed to validate PDF: {str(e)}"


async def validate_url_and_fetch_pdf(url: str) -> tuple[bool, bytes, str]:
    """
    Validate URL and fetch PDF content with additional checks.
    Returns (is_valid, pdf_bytes, error_message).
    """
    try:
        # Make HEAD request first to check content type without downloading
        head_response = requests.head(str(url), timeout=10, allow_redirects=True)

        # Check if we were redirected to a non-PDF URL
        if head_response.url != str(url):
            logger.info(f"URL redirected from {url} to {head_response.url}")

        # Check content type
        content_type = head_response.headers.get("content-type", "").lower()
        if "application/pdf" not in content_type and "pdf" not in content_type:
            # Some servers don't set correct content-type, so we'll still try
            logger.warning(f"URL content-type is {content_type}, not application/pdf")

        # Check content length if available
        content_length = head_response.headers.get("content-length")
        if content_length:
            size_mb = int(content_length) / (1024 * 1024)
            if size_mb > MAX_UPLOAD_SIZE_MB:
                return False, b"", f"File too large (max {MAX_UPLOAD_SIZE_MB}MB)"
            if size_mb < 0.001:  # Less than 1KB
                return False, b"", "File too small to be a valid PDF"

        # Stream the download with a running size cap so we bail out early
        # on servers that don't return a content-length header.
        max_bytes = MAX_UPLOAD_SIZE_MB * 1024 * 1024
        response = requests.get(str(url), timeout=30, stream=True)
        response.raise_for_status()

        chunks: list[bytes] = []
        total = 0
        for chunk in response.iter_content(chunk_size=65536):
            total += len(chunk)
            if total > max_bytes:
                response.close()
                return False, b"", f"File too large (max {MAX_UPLOAD_SIZE_MB}MB)"
            chunks.append(chunk)
        pdf_bytes = b"".join(chunks)

        # Validate the downloaded content
        is_valid, error_msg = await validate_pdf_content(pdf_bytes, "URL")
        if not is_valid:
            return False, b"", error_msg

        return True, pdf_bytes, ""

    except requests.exceptions.RequestException as e:
        return False, b"", f"Failed to download PDF from URL: {str(e)}"
    except Exception as e:
        return False, b"", f"Error processing URL: {str(e)}"


def generate_pdf_preview_from_bytes(
    pdf_bytes: bytes,
) -> Tuple[Optional[str], Optional[str]]:
    """
    Render the first page of a PDF to a PNG preview and upload to S3.
    Returns (preview_object_key, preview_url) or (None, None) on failure.
    """
    from app.helpers.s3 import s3_service

    try:
        doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
        if len(doc) == 0:
            return None, None

        page = doc[0]
        mat = pymupdf.Matrix(2.0, 2.0)
        pix = page.get_pixmap(matrix=mat)  # type: ignore[attr-defined]
        img = Image.open(io.BytesIO(pix.tobytes("png")))

        max_width = 800
        if img.width > max_width:
            ratio = max_width / img.width
            new_height = int(img.height * ratio)
            img = img.resize((max_width, new_height), Image.Resampling.LANCZOS)

        img_buffer = io.BytesIO()
        img.save(img_buffer, format="PNG", optimize=True)
        img_buffer.seek(0)

        preview_filename = f"preview-{uuid.uuid4()}.png"
        preview_object_key, preview_url = s3_service.upload_any_file_from_bytes(
            img_buffer.getvalue(),
            preview_filename,
            content_type="image/png",
        )
        doc.close()
        return preview_object_key, preview_url
    except Exception as e:
        logger.warning("Failed to generate PDF preview: %s", e)
        return None, None


def extract_pdf_page_dimensions(pdf_bytes: bytes) -> dict[int, tuple[float, float]]:
    """Return {page_index: (width_pts, height_pts)} for every page in the PDF."""
    try:
        doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
        dims = {i: (page.rect.width, page.rect.height) for i, page in enumerate(doc)}
        doc.close()
        return dims
    except Exception as e:
        logger.warning("Failed to extract PDF page dimensions: %s", e)
        return {}


def extract_pdf_text_and_offsets(
    pdf_bytes: bytes,
) -> Tuple[str, dict[int, list[int]]]:
    """
    Extract plain text from a PDF along with a {page_number: [start, end]} offset
    map suitable for storage in `Paper.page_offset_map`. Pages with no extractable
    text are skipped. Used by callers (e.g. Zotero import) that already have
    authoritative metadata and only need deterministic text for annotation
    offset matching.
    """
    reader = PdfReader(io.BytesIO(pdf_bytes))
    parts: list[str] = []
    page_offsets: dict[int, list[int]] = {}
    current = 0
    for idx, page in enumerate(reader.pages):
        try:
            text = page.extract_text() or ""
        except Exception as e:
            logger.warning("Failed to extract text from page %s: %s", idx + 1, e)
            text = ""
        text = text.replace("\x00", "")
        if not text:
            continue
        parts.append(text)
        page_offsets[idx + 1] = [current, current + len(text)]
        current += len(text)
    return "".join(parts), page_offsets


def parse_publication_date(date_str: str) -> datetime | None:
    """Parse publication date string in various formats (yyyy-mm-dd, yyyy-mm, yyyy)."""
    if not date_str:
        return None

    formats = ["%Y-%m-%d", "%Y-%m", "%Y"]
    for fmt in formats:
        try:
            return datetime.strptime(date_str, fmt)
        except ValueError:
            continue
    return None
