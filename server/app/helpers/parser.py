import io
import logging
from typing import Tuple

import PyPDF2
import requests
from PyPDF2 import PdfReader

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


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
        # Check file size (e.g., max 50MB)
        if len(pdf_bytes) > 50 * 1024 * 1024:
            return False, "File too large (max 50MB)"

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
            if size_mb > 50:
                return False, b"", "File too large (max 50MB)"
            if size_mb < 0.001:  # Less than 1KB
                return False, b"", "File too small to be a valid PDF"

        # Now download the actual content
        response = requests.get(str(url), timeout=30)
        response.raise_for_status()

        pdf_bytes = response.content

        # Validate the downloaded content
        is_valid, error_msg = await validate_pdf_content(pdf_bytes, "URL")
        if not is_valid:
            return False, b"", error_msg

        return True, pdf_bytes, ""

    except requests.exceptions.RequestException as e:
        return False, b"", f"Failed to download PDF from URL: {str(e)}"
    except Exception as e:
        return False, b"", f"Error processing URL: {str(e)}"
