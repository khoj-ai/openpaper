import pymupdf # type: ignore
import pymupdf4llm # type: ignore
from markitdown import MarkItDown
from typing import Tuple, List
from io import BytesIO
import logging
import uuid
import asyncio

md = MarkItDown()

from PIL import Image # type: ignore

from src.s3_service import s3_service
from src.schemas import PDFImage
from src.llm_client import fast_llm_client

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


async def extract_images_from_pdf(file_path: str, job_id: str) -> List[PDFImage]:
    """
    Extract all images from a PDF file and upload them to S3.

    Args:
        file_path: Path to the PDF file
        job_id: Job ID for creating unique filenames

    Returns:
        List[PDFImage]: List of extracted images with metadata
    """
    extracted_images: List[PDFImage] = []

    try:
        doc = pymupdf.open(file_path)
        logger.info(f"Extracting images from PDF with {len(doc)} pages")

        # Create file cache for the PDF to use for caption extraction
        cache_key = None
        try:
            fast_llm_client.refresh_client()  # Ensure client is refreshed with latest API key
            cache_key = await fast_llm_client.create_file_cache(file_path)
            logger.info(f"Created file cache for PDF: {cache_key}")
        except Exception as cache_error:
            logger.warning(f"Failed to create file cache: {cache_error}")

        # First, extract all images without captions
        for page_num in range(len(doc)):
            page = doc[page_num]
            image_list = page.get_images() # type: ignore

            logger.info(f"Found {len(image_list)} images on page {page_num + 1}")

            for img_index, img in enumerate(image_list):
                try:
                    # Get image reference
                    xref = img[0]

                    # Extract image data
                    base_image = doc.extract_image(xref) # type: ignore
                    image_bytes = base_image["image"]
                    image_ext = base_image["ext"]
                    width = base_image["width"]
                    height = base_image["height"]

                    # Skip very small images (likely decorative elements or noise)
                    if width < 50 or height < 50:
                        logger.debug(f"Skipping small image on page {page_num + 1}: {width}x{height}")
                        continue

                    # Create unique filename
                    image_filename = f"extracted-image-{job_id}-p{page_num + 1}-i{img_index + 1}.{image_ext}"

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

                    # For testing, write image to file
                    image_buffer = BytesIO(image_bytes)
                    image_buffer.seek(0)
                    image_filename = f"{image_filename}"
                    with open(image_filename, "wb") as f:
                        f.write(image_buffer.getvalue())

                    # Create PDFImage object
                    pdf_image = PDFImage(
                        page_number=page_num + 1,
                        image_index=img_index + 1,
                        s3_object_key=s3_object_key,
                        image_url=image_url,
                        width=width,
                        height=height,
                        format=image_ext.upper(),
                        size_bytes=len(image_bytes),
                        caption=None  # Will be populated later
                    )

                    # Store image bytes for caption extraction using setattr
                    setattr(pdf_image, '_image_bytes', image_bytes)
                    setattr(pdf_image, '_image_mime_type', content_type)

                    extracted_images.append(pdf_image)
                    logger.info(f"Extracted image {img_index + 1} from page {page_num + 1}: {width}x{height} {image_ext}")

                except Exception as img_error:
                    logger.warning(f"Failed to extract image {img_index + 1} from page {page_num + 1}: {img_error}")
                    continue

        doc.close()
        logger.info(f"Successfully extracted {len(extracted_images)} images from PDF")

        # Now extract captions for all images in parallel
        if extracted_images and cache_key:
            logger.info(f"Starting caption extraction for {len(extracted_images)} images")

            async def extract_caption_for_image(pdf_image: PDFImage) -> PDFImage:
                """Extract caption for a single image"""
                try:
                    image_bytes = getattr(pdf_image, '_image_bytes', None)
                    image_mime_type = getattr(pdf_image, '_image_mime_type', None)

                    if image_bytes:
                        caption_result = await fast_llm_client.extract_image_captions(
                            cache_key=cache_key,
                            image_data=image_bytes,
                            image_mime_type=image_mime_type
                        )

                        # Extract the first caption if available
                        if caption_result:
                            # Get the first caption from the results
                            pdf_image.caption = caption_result
                            logger.info(f"Extracted caption for image p{pdf_image.page_number}-i{pdf_image.image_index}: {pdf_image.caption[:100]}...")
                        else:
                            logger.debug(f"No caption results for image p{pdf_image.page_number}-i{pdf_image.image_index}")

                    # Clean up temporary attributes
                    if hasattr(pdf_image, '_image_bytes'):
                        delattr(pdf_image, '_image_bytes')
                    if hasattr(pdf_image, '_image_mime_type'):
                        delattr(pdf_image, '_image_mime_type')

                except Exception as caption_error:
                    logger.warning(f"Failed to extract caption for image p{pdf_image.page_number}-i{pdf_image.image_index}: {caption_error}")
                    # Clean up temporary attributes even on error
                    if hasattr(pdf_image, '_image_bytes'):
                        delattr(pdf_image, '_image_bytes')
                    if hasattr(pdf_image, '_image_mime_type'):
                        delattr(pdf_image, '_image_mime_type')

                return pdf_image

            # Create tasks for parallel caption extraction
            caption_tasks = [extract_caption_for_image(img) for img in extracted_images]

            # Run all caption extractions in parallel
            try:
                extracted_images = await asyncio.gather(*caption_tasks, return_exceptions=False)
                logger.info(f"Completed caption extraction for {len(extracted_images)} images")
            except Exception as parallel_error:
                logger.error(f"Error during parallel caption extraction: {parallel_error}")
                # Clean up temporary attributes from all images
                for img in extracted_images:
                    if hasattr(img, '_image_bytes'):
                        delattr(img, '_image_bytes')
                    if hasattr(img, '_image_mime_type'):
                        delattr(img, '_image_mime_type')
        else:
            logger.info("Skipping caption extraction (no images or no cache key)")
            # Clean up temporary attributes from all images
            for img in extracted_images:
                if hasattr(img, '_image_bytes'):
                    delattr(img, '_image_bytes')
                if hasattr(img, '_image_mime_type'):
                    delattr(img, '_image_mime_type')

        extracted_images = [img for img in extracted_images if img.caption is not None or img.s3_object_key is not None]

        return extracted_images

    except Exception as e:
        logger.error(f"Error extracting images from PDF: {str(e)}")
        raise
