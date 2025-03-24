from markitdown import MarkItDown

md = MarkItDown()

def extract_text_from_pdf(file_path: str) -> str:
    """
    Extract text content from a PDF file.
    """
    try:
        return md.convert(file_path).text_content
    except Exception as e:
        raise ValueError(f"Failed to extract text from PDF: {str(e)}")
    