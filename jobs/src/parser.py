import os
import re
import tempfile
import pymupdf # type: ignore
import pymupdf4llm # type: ignore
from markitdown import MarkItDown
from typing import Dict, Tuple, List, Union
from io import BytesIO
import logging
import uuid
import asyncio
import numpy as np
from PIL import Image, ImageStat # type: ignore
import hashlib

md = MarkItDown()

from src.s3_service import s3_service
from src.schemas import PDFImage
from src.llm_client import fast_llm_client

logger = logging.getLogger(__name__)

def _calculate_image_hash(image_bytes: bytes) -> str:
    """Calculate MD5 hash of image bytes for duplicate detection"""
    return hashlib.md5(image_bytes).hexdigest()

def _is_image_mostly_empty(image_bytes: bytes, threshold: float = 0.95) -> bool:
    """
    Check if an image is mostly empty (black, white, or single color).

    Args:
        image_bytes: Raw image bytes
        threshold: Threshold for considering image as mostly empty (0.0 to 1.0)

    Returns:
        bool: True if image is mostly empty/uniform
    """
    try:
        # Open image with PIL
        img = Image.open(BytesIO(image_bytes))

        # Convert to RGB if not already
        if img.mode != 'RGB':
            img = img.convert('RGB')  # type: ignore

        # Calculate image statistics
        stat = ImageStat.Stat(img)

        # Get the standard deviation for each channel
        stddev = stat.stddev

        # If all channels have very low standard deviation, it's mostly uniform
        avg_stddev = sum(stddev) / len(stddev)

        # Also check for mostly black images
        mean_brightness = sum(stat.mean) / len(stat.mean)

        # Consider image empty if:
        # 1. Very low variation (uniform color) - more lenient for scientific figures
        # 2. Very dark (likely corrupted/empty)
        # 3. Very bright (likely empty white)
        is_uniform = avg_stddev < 3  # Much more lenient for scientific figures with clean backgrounds
        is_very_dark = mean_brightness < 10  # Very dark
        is_very_bright = mean_brightness > 250  # Very bright (near pure white)

        # Additional check: if it's mostly uniform but has reasonable brightness, it might still be valid
        # This helps preserve figures with clean backgrounds
        if is_uniform and 30 < mean_brightness < 220:
            # Check if there's any meaningful variation at all
            max_channel_stddev = max(stddev) if stddev else 0
            if max_channel_stddev > 8:  # At least one channel has some variation
                return False

        return is_uniform or is_very_dark or is_very_bright

    except Exception as e:
        logger.warning(f"Failed to analyze image emptiness: {e}")
        return False

def _is_valid_image_size(width: int, height: int, file_size: int) -> bool:
    """
    Check if image dimensions and file size are reasonable.

    Args:
        width: Image width in pixels
        height: Image height in pixels
        file_size: File size in bytes

    Returns:
        bool: True if image size is valid
    """
    # Filter out very small images (likely artifacts)
    if width < 30 or height < 30:  # More lenient for small but meaningful graphics
        return False

    # More intelligent size filtering for academic papers
    # Allow high-resolution figures but filter out obvious full-page scans
    total_pixels = width * height

    # Very large images (> 50 megapixels) are likely full-page scans
    if total_pixels > 50_000_000:
        return False

    # Filter out extremely large single dimensions (likely page scans)
    if width > 15000 or height > 15000:
        return False

    # Filter out images with extreme aspect ratios
    aspect_ratio = max(width, height) / min(width, height)
    if aspect_ratio > 25:  # Even more lenient for wide charts/graphs
        return False

    # Filter out very small file sizes (likely empty/corrupted)
    if file_size < 500:  # More lenient for simple graphics
        return False

    # More intelligent file size validation
    # Allow larger file sizes for high-resolution images
    bytes_per_pixel = file_size / total_pixels

    # Suspiciously large files (> 50 bytes per pixel) are likely corrupted
    if bytes_per_pixel > 50:
        return False

    # Suspiciously small files (< 0.01 bytes per pixel) are likely corrupted
    if bytes_per_pixel < 0.01:
        return False

    return True

def _analyze_image_quality(image_bytes: bytes) -> Dict[str, Union[bool, float, int]]:
    """
    Comprehensive image quality analysis.

    Args:
        image_bytes: Raw image bytes

    Returns:
        Dict with quality metrics
    """
    try:
        img = Image.open(BytesIO(image_bytes))

        # Convert to RGB for consistent analysis
        if img.mode != 'RGB':
            img = img.convert('RGB')  # type: ignore

        # Convert to numpy array for analysis
        img_array = np.array(img)

        # Calculate various quality metrics
        width, height = img.size
        file_size = len(image_bytes)

        # Color analysis
        stat = ImageStat.Stat(img)
        avg_brightness = sum(stat.mean) / len(stat.mean)
        color_variance = sum(stat.stddev) / len(stat.stddev)

        # Edge detection (simplified - count high-contrast pixels)
        gray = img.convert('L')
        gray_array = np.array(gray)

        # Calculate edge density using simple gradient method (avoid scipy dependency)
        # Calculate horizontal and vertical gradients
        grad_x = np.abs(np.diff(gray_array, axis=1))
        grad_y = np.abs(np.diff(gray_array, axis=0))

        # Count significant edges
        edge_pixels = np.sum(grad_x > 15) + np.sum(grad_y > 15)  # More sensitive edge detection
        edge_density = edge_pixels / (width * height)

        # Entropy (measure of information content)
        histogram = gray.histogram()
        total_pixels = width * height
        entropy = -sum([(count/total_pixels) * np.log2(count/total_pixels + 1e-10)
                       for count in histogram if count > 0])

        # More sophisticated content detection for scientific figures
        # Check for text-like patterns (high frequency components)
        text_like_edges = np.sum(grad_x > 30) + np.sum(grad_y > 30)
        text_density = text_like_edges / (width * height)

        # Check for structured content (charts, graphs, diagrams)
        # Look for both horizontal and vertical structures
        horizontal_structure = np.sum(grad_y > 25) / (width * height)
        vertical_structure = np.sum(grad_x > 25) / (width * height)
        has_structure = horizontal_structure > 0.001 or vertical_structure > 0.001

        # Determine if image has meaningful content
        has_meaningful_content = (
            (edge_density > 0.005 and entropy > 2.0) or  # Lower thresholds for scientific figures
            (text_density > 0.002) or  # Has text-like content
            (has_structure and entropy > 1.5) or  # Has structural elements
            (color_variance > 15 and entropy > 2.5)  # Has reasonable color variation
        )

        return {
            'width': width,
            'height': height,
            'file_size': file_size,
            'avg_brightness': float(avg_brightness),
            'color_variance': float(color_variance),
            'edge_density': float(edge_density),
            'entropy': float(entropy),
            'text_density': float(text_density),
            'horizontal_structure': float(horizontal_structure),
            'vertical_structure': float(vertical_structure),
            'is_valid_size': _is_valid_image_size(width, height, file_size),
            'is_mostly_empty': _is_image_mostly_empty(image_bytes),
            'has_meaningful_content': bool(has_meaningful_content)
        }

    except Exception as e:
        logger.warning(f"Failed to analyze image quality: {e}")
        return {
            'width': 0,
            'height': 0,
            'file_size': len(image_bytes),
            'is_valid_size': False,
            'is_mostly_empty': True,
            'has_meaningful_content': False
        }

def _should_include_image(image_bytes: bytes, quality_metrics: Union[Dict[str, Union[bool, float, int]], None] = None) -> Tuple[bool, str]:
    """
    Determine if an image should be included based on quality analysis.

    Args:
        image_bytes: Raw image bytes
        quality_metrics: Pre-computed quality metrics (optional)

    Returns:
        Tuple[bool, str]: (should_include, reason)
    """
    if quality_metrics is None:
        quality_metrics = _analyze_image_quality(image_bytes)

    # Check size validity
    if not quality_metrics.get('is_valid_size', False):
        width = quality_metrics.get('width', 0)
        height = quality_metrics.get('height', 0)
        file_size = quality_metrics.get('file_size', 0)
        total_pixels = width * height
        bytes_per_pixel = file_size / total_pixels if total_pixels > 0 else 0
        aspect_ratio = max(width, height) / min(width, height) if min(width, height) > 0 else 0

        return False, f"Invalid dimensions: {width}x{height} (pixels: {total_pixels:,}, bytes/pixel: {bytes_per_pixel:.3f}, aspect: {aspect_ratio:.1f})"

    # Check if mostly empty
    if quality_metrics.get('is_mostly_empty', True):
        return False, f"Mostly empty/uniform image (brightness: {quality_metrics.get('avg_brightness', 0):.1f}, variance: {quality_metrics.get('color_variance', 0):.1f})"

    # Check for meaningful content
    if not quality_metrics.get('has_meaningful_content', False):
        return False, f"No meaningful content detected (entropy: {quality_metrics.get('entropy', 0):.2f}, edge_density: {quality_metrics.get('edge_density', 0):.4f}, text_density: {quality_metrics.get('text_density', 0):.4f})"

    # Check minimum file size
    if quality_metrics.get('file_size', 0) < 500:  # Updated threshold
        return False, f"File too small: {quality_metrics.get('file_size', 0)} bytes"

    return True, f"Image quality acceptable (entropy: {quality_metrics.get('entropy', 0):.2f}, edge_density: {quality_metrics.get('edge_density', 0):.4f}, size: {quality_metrics.get('width', 0)}x{quality_metrics.get('height', 0)})"

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
                    image_hash = _calculate_image_hash(image_bytes)
                    if image_hash in image_hashes:
                        logger.debug(f"Skipping duplicate image on page {page_num + 1}, index {img_index}")
                        continue
                    image_hashes.add(image_hash)

                    # Analyze image quality
                    quality_metrics = _analyze_image_quality(image_bytes)
                    should_include, reason = _should_include_image(image_bytes, quality_metrics)

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
