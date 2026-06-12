import logging
import tempfile
import os
import asyncio
from datetime import datetime, timezone
from typing import Callable

from src.schemas import PDFProcessingResult, PaperMetadataExtraction
from src.s3_service import s3_service
from src.parser import extract_text, generate_pdf_preview, map_pages_to_text_offsets
from src.llm_client import llm_client
from src.utils import time_it

logger = logging.getLogger(__name__)


class UnprocessablePDFError(Exception):
    """A PDF we can't process for an expected, benign reason (size extremes).

    These are not bugs or outages, so they are logged as warnings rather than
    errors and should not page.
    """


class InsufficientPDFTextError(UnprocessablePDFError):
    """Raised when a PDF yields too little text to be a real paper.

    Typically a scanned/image-only PDF that yielded no real text.
    """


class ExcessivePDFTextError(UnprocessablePDFError):
    """Raised when a PDF is so large that truncating it to fit the model's
    context window would drop too much of the content to extract trustworthy
    metadata (see MIN_RETAINED_FRACTION)."""


# Minimum amount of extracted text we consider a viable paper. Below this,
# extraction almost certainly failed (e.g. a scanned/image-only PDF that yielded
# no real text) rather than being a genuinely short document. ~1000 chars is
# roughly 250 tokens — well under Gemini's 1024-token cache floor, and far above
# the few-hundred-character outputs that failed parses produce.
MIN_EXTRACTED_TEXT_CHARS = 1000

# Upper bound on text we send to the LLM. Gemini 3.1 Pro's input window is
# 1,048,576 tokens; we budget conservatively at ~3.5 chars/token and reserve
# headroom for the prompt, so content above this many chars risks overflowing
# the window. Content over the limit is truncated rather than failed — but only
# if we can still keep at least MIN_RETAINED_FRACTION of it; otherwise the
# metadata wouldn't reflect the paper and we reject it instead.
MODEL_INPUT_TOKEN_LIMIT = 1_048_576
PROMPT_TOKEN_RESERVE = 48_576
EST_CHARS_PER_TOKEN = 3.5
MAX_LLM_CONTENT_CHARS = int((MODEL_INPUT_TOKEN_LIMIT - PROMPT_TOKEN_RESERVE) * EST_CHARS_PER_TOKEN)
MIN_RETAINED_FRACTION = 0.80

async def process_pdf_file(
    pdf_bytes: bytes,
    s3_object_key: str,
    job_id: str,
    status_callback: Callable[[str], None],
) -> PDFProcessingResult:
    """
    Process a PDF file by extracting metadata from bytes.

    Args:
        pdf_bytes: The PDF file content as bytes
        s3_object_key: The S3 object key of the PDF file
        job_id: Job ID for tracking
        status_callback: Function to update task status

    Returns:
        PDFProcessingResult: Processing results
    """
    start_time = datetime.now(timezone.utc)
    temp_file_path = None
    preview_object_key = None

    try:
        logger.info(f"Starting PDF processing for job {job_id}")

        # Write to temporary file
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as temp_file:
            temp_file.write(pdf_bytes)
            temp_file_path = temp_file.name

        safe_filename = f"pdf-{job_id}.pdf"

        # Extract text and page offsets from PDF
        try:
            async with time_it("Extracting text, images, and page offsets from PDF", job_id=job_id):
                pdf_text = await extract_text(
                    temp_file_path,
                )
                status_callback(f"Processed bits and bytes")
                logger.info(f"Extracted {len(pdf_text)} characters of text from PDF")
                page_offsets = map_pages_to_text_offsets(temp_file_path)
        except Exception as e:
            logger.error(f"Failed to extract text from PDF: {e}")
            raise Exception(f"Failed to extract text from PDF: {e}")

        # Short-circuit on too-little text: this is a failed extraction (e.g. a
        # scanned/image-only PDF), not a real paper. Bail before spending an LLM
        # cache call + four extraction tasks on garbage, and surface a clear error.
        extracted_chars = len(pdf_text.strip())
        if extracted_chars < MIN_EXTRACTED_TEXT_CHARS:
            raise InsufficientPDFTextError(
                f"Failed to extract usable text from PDF: only {extracted_chars} "
                f"characters found (minimum {MIN_EXTRACTED_TEXT_CHARS})"
            )

        # Cap what we send to the LLM at the model's context window. We keep the
        # full text for raw_content; only the metadata extraction sees a truncated
        # copy. If truncation would drop more than (1 - MIN_RETAINED_FRACTION) of
        # the paper, the extracted metadata wouldn't be representative, so reject.
        content_for_llm = pdf_text
        if extracted_chars > MAX_LLM_CONTENT_CHARS:
            retained_fraction = MAX_LLM_CONTENT_CHARS / extracted_chars
            if retained_fraction < MIN_RETAINED_FRACTION:
                raise ExcessivePDFTextError(
                    f"PDF too large for the model: {extracted_chars} chars exceeds "
                    f"the ~{MAX_LLM_CONTENT_CHARS}-char budget, and truncating would "
                    f"keep only {retained_fraction:.0%} of the content "
                    f"(minimum {MIN_RETAINED_FRACTION:.0%})"
                )
            content_for_llm = pdf_text[:MAX_LLM_CONTENT_CHARS]
            logger.warning(
                f"PDF for job {job_id} is {extracted_chars} chars; truncating to "
                f"{MAX_LLM_CONTENT_CHARS} ({retained_fraction:.0%} retained) for "
                f"metadata extraction"
            )

        # Define async functions for I/O-bound operations
        logger.info(f"About to define async functions for job {job_id}")

        async def generate_preview_async():
            status_callback("Taking a snapshot")
            try:
                return await asyncio.to_thread(generate_pdf_preview, temp_file_path)
            except Exception as e:
                logger.warning(f"Failed to generate preview for {safe_filename}: {str(e)}")
                return None, None

        # Run I/O-bound tasks and LLM extraction concurrently
        async with time_it("Running I/O-bound tasks and LLM extraction concurrently", job_id=job_id):
            preview_task = asyncio.create_task(generate_preview_async())
            metadata_task = asyncio.create_task(
                llm_client.extract_paper_metadata(
                    content_for_llm, job_id=job_id, status_callback=status_callback
                )
            )

            # Await all tasks
            results = await asyncio.gather(
                preview_task,
                metadata_task,
                return_exceptions=True
            )

        # Process results
        preview_result, metadata_result = results

        # Generate file URL from the existing S3 object key
        file_url = f"https://{s3_service.cloudflare_bucket_name}/{s3_object_key}"
        logger.info(f"PDF already uploaded to S3: {file_url}")

        if isinstance(preview_result, Exception):
            logger.warning(f"Failed to generate preview: {preview_result}")
            preview_object_key, preview_url = None, None
        else:
            preview_object_key, preview_url = preview_result # type: ignore
            if preview_url:
                logger.info(f"Generated preview for {safe_filename}: {preview_url}")

        if isinstance(metadata_result, Exception):
            logger.error(f"Failed to extract metadata: {metadata_result}")
            raise metadata_result
        metadata: PaperMetadataExtraction = metadata_result # type: ignore
        logger.info(f"Successfully extracted metadata for {safe_filename}")

        # Process publication date
        if metadata and metadata.publish_date:
            try:
                # Simplified date parsing logic
                parsed_date = datetime.fromisoformat(metadata.publish_date.replace("Z", "+00:00"))
                metadata.publish_date = parsed_date.strftime("%Y-%m-%d")
            except (ValueError, TypeError):
                logger.warning(f"Could not parse date: {metadata.publish_date}, setting to None")
                metadata.publish_date = None

        end_time = datetime.now(timezone.utc)
        duration = (end_time - start_time).total_seconds()

        logger.info(f"PDF processing completed successfully for {safe_filename} in {duration:.2f} seconds")

        if not metadata.title:
            # This most likely means the LLM extraction failed
            raise Exception("Failed to extract metadata from PDF")

        return PDFProcessingResult(
            success=True,
            metadata=metadata,
            s3_object_key=s3_object_key,
            file_url=file_url,
            preview_url=preview_url,
            preview_object_key=preview_object_key,
            job_id=job_id,
            raw_content=pdf_text,
            page_offset_map=page_offsets,
            duration=duration,
        )

    except UnprocessablePDFError as e:
        # Expected, benign failure (too little or too much text). Warn, don't page.
        logger.warning(f"PDF processing skipped for {job_id}: {e}")
        return PDFProcessingResult(
            success=False,
            error=str(e),
            job_id=job_id,
        )
    except Exception as e:
        logger.error(f"PDF processing failed for {job_id}: {str(e)}", exc_info=True)
        # Cleanup logic remains the same
        return PDFProcessingResult(
            success=False,
            error=str(e),
            job_id=job_id,
        )
    finally:
        # Clean up temporary file
        if temp_file_path and os.path.exists(temp_file_path):
            try:
                os.unlink(temp_file_path)
            except Exception as cleanup_error:
                logger.warning(f"Failed to clean up temporary file: {str(cleanup_error)}")
