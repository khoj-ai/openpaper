from typing import Tuple

import pymupdf
import pymupdf4llm
from markitdown import MarkItDown

md = MarkItDown()


def sanitize_string(text: str) -> str:
    """
    Remove NULL bytes and other problematic characters from strings before saving to database
    """
    if text is None:
        return None

    # Remove NULL bytes
    return text.replace("\x00", "")


def extract_text_from_pdf(file_path: str) -> str:
    """
    Extract text content from a PDF file.
    """

    def is_valid_text(text: str) -> bool:
        """
        Check if the extracted text is valid (not empty or whitespace).
        """
        return bool(
            text
            and text.strip()
            and text.split("\n") != [""]
            and text.split(" ") != [""]
        )

    try:
        md_text = md.convert(file_path).markdown
        md_text = sanitize_string(md_text)
        if not is_valid_text(md_text):
            # Fallback to pymupdf4llm if MarkItDown fails
            md_text = pymupdf4llm.to_markdown(file_path)

        if not is_valid_text(md_text):
            # If both methods fail, raise an error
            raise ValueError("No text found in the PDF file.")

        return md_text
    except Exception as e:
        try:
            # Attempt to extract text using pymupdf4llm
            md_text = pymupdf4llm.to_markdown(file_path)
            md_text = sanitize_string(md_text)
            if not is_valid_text(md_text):
                raise ValueError("No text found in the PDF file.")
            return md_text
        except Exception as e:
            # If both methods fail, raise an error
            raise ValueError(f"Failed to extract text from PDF: {str(e)}")


def map_pages_to_text_offsets(
    pdf_file_path: str,
) -> dict[int, tuple[int, int]]:
    """
    Map each page of the PDF to its corresponding text offsets.
    """
    doc = pymupdf.open(pdf_file_path)
    page_offsets = {}
    current_offset = 0

    for page_num in range(len(doc)):
        page = doc[page_num]
        page_text = page.get_text("text")  # type: ignore
        page_length = len(page_text)

        if page_length > 0:
            page_offsets[page_num + 1] = (current_offset, current_offset + page_length)
            current_offset += page_length

    return page_offsets


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
