import os
import re
import tempfile
import pymupdf # type: ignore
import pymupdf4llm # type: ignore
from markitdown import MarkItDown
from typing import Dict, Tuple, List
from io import BytesIO
import logging
import uuid
import asyncio
import numpy as np
from PIL import Image # type: ignore

md = MarkItDown()

from src.s3_service import s3_service
from src.schemas import PDFImage
from src.llm_client import fast_llm_client
from src.image_helpers import should_include_image, calculate_image_hash, analyze_image_quality

logger = logging.getLogger(__name__)


def sanitize_string(text: str) -> str:
    """
    Remove NULL bytes and other problematic characters from strings before saving to database
    """
    if text is None:
        return ""

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
            md_text = sanitize_string(md_text)

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
) -> dict[int, list[int]]:
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
            # Technically, we're only returning Tuples, but the List is easier to work with for json serialization
            page_offsets[page_num + 1] = [current_offset, current_offset + page_length]
            current_offset += page_length

    return page_offsets


def generate_pdf_preview(file_path: str) -> Tuple[str, str]:
    """
    Generate a preview image from the first page of a PDF.

    Args:
        file_path: Path to the PDF file

    Returns:
        tuple[str, str]: The S3 object key and preview URL
    """
    try:
        # Open the PDF from file path
        doc = pymupdf.open(file_path)

        if len(doc) == 0:
            raise Exception("PDF has no pages")

        # Get the first page
        page = doc[0]

        # Render page to a pixmap (image)
        # You can adjust the matrix for different resolution/quality
        mat = pymupdf.Matrix(2.0, 2.0)  # 2x zoom for better quality
        pix = page.get_pixmap(matrix=mat) # type: ignore

        # Convert to PIL Image for easier handling
        img_data = pix.tobytes("png")
        img = Image.open(BytesIO(img_data))

        # Optionally resize to a standard preview size
        # This helps keep file sizes reasonable
        max_width = 800
        if img.width > max_width:
            ratio = max_width / img.width
            new_height = int(img.height * ratio)
            img = img.resize((max_width, new_height), Image.Resampling.LANCZOS) # type: ignore

        # Convert back to bytes
        img_buffer = BytesIO()
        img.save(img_buffer, format="PNG", optimize=True)
        img_buffer.seek(0)

        # Create filename for preview
        preview_filename = f"preview-{uuid.uuid4()}.png"

        # Upload to S3
        preview_object_key, preview_url = s3_service.upload_any_file_from_bytes(
            img_buffer.getvalue(),
            preview_filename,
            content_type="image/png",
        )

        doc.close()
        return preview_object_key, preview_url

    except Exception as e:
        logger.error(f"Error generating PDF preview: {str(e)}")
        raise

async def extract_text_and_images_combined(file_path: str, job_id: str) -> Tuple[str, List[PDFImage], Dict[str, str]]:
    """
    Extract text from PDF while replacing images with placeholder IDs.

    Args:
        file_path: Path to the PDF file
        job_id: Job identifier for organizing temporary files

    Returns:
        Tuple[str, List[PDFImage], Dict[str, str]]:
        - Markdown text with image placeholders
        - List of PDFImage objects
        - Mapping of placeholder IDs to local file paths
    """
    try:
        # Create temporary directory for this job
        temp_dir = os.path.join(tempfile.gettempdir(), f"pdf_images_{job_id}")
        os.makedirs(temp_dir, exist_ok=True)

        # Open the PDF
        doc = pymupdf.open(file_path)

        # Storage for extracted data
        pdf_images = []
        placeholder_to_path = {}
        image_hashes = set()  # Track image hashes to avoid duplicates

        # Process each page
        for page_num in range(len(doc)):
            page = doc[page_num]

            # Get all images on this page
            image_list = page.get_images(full=True)

            for img_index, img in enumerate(image_list):
                try:
                    # Extract image data
                    xref = img[0]
                    base_image = doc.extract_image(xref)
                    image_bytes = base_image["image"]
                    image_ext = base_image["ext"]

                    # Check for duplicates
                    image_hash = calculate_image_hash(image_bytes)
                    if image_hash in image_hashes:
                        logger.debug(f"Skipping duplicate image on page {page_num + 1}, index {img_index}")
                        continue
                    image_hashes.add(image_hash)

                    # Analyze image quality
                    quality_metrics = analyze_image_quality(image_bytes)
                    should_include, reason = should_include_image(image_bytes, quality_metrics)

                    # Log detailed information about the decision
                    logger.info(f"Image analysis for page {page_num + 1}, index {img_index}:")
                    logger.info(f"  Size: {quality_metrics.get('width', 0)}x{quality_metrics.get('height', 0)}")
                    logger.info(f"  File size: {len(image_bytes)} bytes")
                    logger.info(f"  Entropy: {quality_metrics.get('entropy', 0):.2f}")
                    logger.info(f"  Edge density: {quality_metrics.get('edge_density', 0):.4f}")
                    logger.info(f"  Text density: {quality_metrics.get('text_density', 0):.4f}")
                    logger.info(f"  Color variance: {quality_metrics.get('color_variance', 0):.1f}")
                    logger.info(f"  Brightness: {quality_metrics.get('avg_brightness', 0):.1f}")
                    logger.info(f"  Decision: {should_include} - {reason}")

                    if not should_include:
                        logger.info(f"Skipping image on page {page_num + 1}, index {img_index}: {reason}")
                        continue

                    # Get image dimensions and other metadata
                    width = quality_metrics.get('width', 0)
                    height = quality_metrics.get('height', 0)

                    logger.info(f"Including image on page {page_num + 1}: {width}x{height}, {len(image_bytes)} bytes, entropy={quality_metrics.get('entropy', 0):.2f}")

                    # Generate placeholder ID
                    placeholder_id = f"IMG_{job_id}_{page_num + 1}_{img_index}_{uuid.uuid4().hex[:8]}"

                    # Create local file path
                    image_filename = f"{placeholder_id}.{image_ext}"
                    local_image_path = os.path.join(temp_dir, image_filename)

                    # Save image to local file
                    with open(local_image_path, "wb") as img_file:
                        img_file.write(image_bytes)

                    # Determine content type
                    content_type_map = {
                        "png": "image/png",
                        "jpg": "image/jpeg",
                        "jpeg": "image/jpeg",
                        "gif": "image/gif",
                        "bmp": "image/bmp",
                        "webp": "image/webp"
                    }
                    content_type = content_type_map.get(image_ext.lower(), "image/png")

                    # Upload to S3
                    s3_object_key, image_url = s3_service.upload_any_file_from_bytes(
                        image_bytes,
                        image_filename,
                        content_type=content_type
                    )

                    # Create PDFImage object
                    pdf_image = PDFImage(
                        placeholder_id=placeholder_id,  # Add this field
                        page_number=page_num + 1,
                        image_index=img_index + 1,
                        s3_object_key=s3_object_key,
                        image_url=image_url,
                        width=int(width),
                        height=int(height),
                        format=image_ext.upper(),
                        size_bytes=len(image_bytes),
                        caption=None  # Will be populated later
                    )
                    pdf_images.append(pdf_image)
                    placeholder_to_path[placeholder_id] = local_image_path

                    # Replace image in PDF with placeholder text
                    # Get image rectangle
                    image_rects = page.get_image_rects(xref) # type: ignore
                    if image_rects:
                        for rect in image_rects:
                            # Remove the image
                            page.delete_image(xref) # type: ignore

                            # Insert placeholder text
                            placeholder_text = f"[{placeholder_id}]"
                            page.insert_text( # type: ignore
                                rect.tl,  # top-left corner
                                placeholder_text,
                                fontsize=8,
                                color=(0, 0, 1)  # Blue color to make it visible
                            )
                            break  # Only replace first occurrence

                except Exception as img_error:
                    logger.warning(f"Failed to extract image {img_index} from page {page_num + 1}: {img_error}")
                    continue

        # Save modified PDF to temporary file
        temp_pdf_path = os.path.join(temp_dir, f"modified_{job_id}.pdf")
        doc.save(temp_pdf_path)
        doc.close()

        # Extract text from modified PDF
        try:
            md_text = md.convert(temp_pdf_path).markdown
            md_text = sanitize_string(md_text)

            if not md_text or not md_text.strip():
                # Fallback to pymupdf4llm
                md_text = pymupdf4llm.to_markdown(temp_pdf_path)
                md_text = sanitize_string(md_text)

        except Exception as text_error:
            logger.warning(f"MarkItDown failed, using pymupdf4llm: {text_error}")
            md_text = pymupdf4llm.to_markdown(temp_pdf_path)
            md_text = sanitize_string(md_text)

        # Clean up temporary PDF
        try:
            os.remove(temp_pdf_path)
        except:
            pass

        # Post-process markdown to clean up image placeholders
        md_text = _clean_image_placeholders(md_text, list(placeholder_to_path.keys()))

        logger.info(f"Extracted {len(pdf_images)} images and text from PDF {file_path}")
        return md_text, pdf_images, placeholder_to_path

    except Exception as e:
        logger.error(f"Error in extract_text_and_images_combined: {str(e)}")
        raise ValueError(f"Failed to extract text and images from PDF: {str(e)}")

def _clean_image_placeholders(markdown_text: str, placeholder_ids: List[str]) -> str:
    """
    Clean up image placeholders in markdown text to ensure they're properly formatted.

    Args:
        markdown_text: The raw markdown text
        placeholder_ids: List of placeholder IDs to look for

    Returns:
        str: Cleaned markdown text with properly formatted image placeholders
    """
    cleaned_text = markdown_text

    for placeholder_id in placeholder_ids:
        # Look for various forms of the placeholder that might appear in the text
        patterns = [
            f"\\[{placeholder_id}\\]",
            f"{placeholder_id}",
            f"\\[.*{placeholder_id}.*\\]",
        ]

        for pattern in patterns:
            # Replace with clean placeholder format
            cleaned_text = re.sub(
                pattern,
                f"[{placeholder_id}]",
                cleaned_text,
                flags=re.IGNORECASE
            )

    return cleaned_text

async def extract_captions_for_images(images: List[PDFImage], file_path: str, image_id_to_location: Dict[str, str]) -> List[PDFImage]:
    """
    Extract captions for a list of PDF images using LLM.

    Args:
        images: List of PDFImage objects without captions
        file_path: Path to the original PDF file
        image_id_to_location: Mapping of placeholder_id to local file path

    Returns:
        List[PDFImage]: Images with captions populated
    """
    if not images:
        return images

    # Create file cache for the PDF
    cache_key = None
    try:
        fast_llm_client.refresh_client()
        cache_key = await fast_llm_client.create_file_cache(file_path)
        logger.info(f"Created file cache for caption extraction: {cache_key}")
    except Exception as cache_error:
        logger.warning(f"Failed to create file cache: {cache_error}")
        return images

    async def extract_caption_for_image(pdf_image: PDFImage) -> PDFImage:
        """Extract caption for a single image"""
        try:
            # Get local file path for this image
            if not pdf_image.placeholder_id:
                logger.warning(f"Image {pdf_image.image_index} on page {pdf_image.page_number} has no placeholder ID")
                return pdf_image
            local_image_path = image_id_to_location.get(pdf_image.placeholder_id)
            if not local_image_path:
                logger.warning(f"No local file path found for image {pdf_image.placeholder_id}")
                return pdf_image

            # Read image bytes from local file
            with open(local_image_path, "rb") as f:
                image_bytes = f.read()

            # Determine MIME type
            content_type_map = {
                "PNG": "image/png",
                "JPG": "image/jpeg",
                "JPEG": "image/jpeg",
                "GIF": "image/gif",
                "BMP": "image/bmp",
                "WEBP": "image/webp"
            }
            image_mime_type = content_type_map.get(pdf_image.format, "image/png")

            caption_result = await fast_llm_client.extract_image_captions(
                cache_key=cache_key,
                image_data=image_bytes,
                image_mime_type=image_mime_type
            )

            if caption_result:
                pdf_image.caption = caption_result
                logger.info(f"Extracted caption for image {pdf_image.placeholder_id}: {pdf_image.caption[:100]}...")
            else:
                logger.debug(f"No caption results for image {pdf_image.placeholder_id}")

        except Exception as caption_error:
            logger.warning(f"Failed to extract caption for image {pdf_image.placeholder_id}: {caption_error}")

        return pdf_image

    # Create tasks for parallel caption extraction
    caption_tasks = [extract_caption_for_image(img) for img in images]

    # Run all caption extractions in parallel
    try:
        images_with_captions = await asyncio.gather(*caption_tasks, return_exceptions=False)
        logger.info(f"Completed caption extraction for {len(images_with_captions)} images")
        return images_with_captions
    except Exception as parallel_error:
        logger.error(f"Error during parallel caption extraction: {parallel_error}")
        return images
