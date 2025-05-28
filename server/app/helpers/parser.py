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
        md_text = md.convert(file_path).text_content
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
