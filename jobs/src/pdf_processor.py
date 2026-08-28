import logging
import tempfile
import os
import asyncio
import zlib
from datetime import datetime, timezone
from typing import Callable, Optional

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

# Minimum information content, measured as zlib-compressed size. The raw char
# floor is defeated by scans whose only text layer is per-page boilerplate
# (e.g. a ProQuest copyright watermark repeated on 150 pages: ~16k raw chars
# but ~160 compressed bytes). Genuine prose can't compress below ~0.55 at
# small sizes — even a paper barely over the raw floor carries 650+ compressed
# bytes — while repeated boilerplate stays in the low hundreds, so 600 sits
# safely between the two.
MIN_COMPRESSED_TEXT_BYTES = 600

# Upper bound on text we send to the LLM. The extraction model's input window is
# 1,048,576 tokens; we reserve headroom for the extraction prompt and system
# instructions, leaving the rest for paper content. Content over the budget is
# truncated rather than failed — but only if we can still keep at least
# MIN_RETAINED_FRACTION of it; otherwise the metadata wouldn't reflect the paper
# and we reject it instead.
MODEL_INPUT_TOKEN_LIMIT = 1_048_576
PROMPT_TOKEN_RESERVE = 48_576
CONTENT_TOKEN_BUDGET = MODEL_INPUT_TOKEN_LIMIT - PROMPT_TOKEN_RESERVE
MIN_RETAINED_FRACTION = 0.80

# Character ceiling below which we skip the countTokens call entirely. Gemini
# never packs fewer than ~1.5 characters into a token, even for the densest
# text, so text shorter than this cannot overflow the window no matter how it
# tokenizes — which covers every normal paper. Above it we measure for real: a
# chars-per-token average is worthless at the boundary, because table- and
# math-heavy papers tokenize two to three times denser than English prose.
MIN_CHARS_PER_TOKEN = 1.5
UNMEASURED_CHAR_CEILING = int(CONTENT_TOKEN_BUDGET * MIN_CHARS_PER_TOKEN)

# Each truncation pass rescales by the document's own measured chars-per-token
# ratio, so it lands within a percent or two of the budget; the margin absorbs
# that error and the extra passes cover pathological documents whose density
# varies sharply between the head and the tail.
MAX_FIT_ITERATIONS = 3
FIT_SAFETY_MARGIN = 0.98


async def fit_content_to_token_budget(pdf_text: str, job_id: str) -> str:
    """Truncate `pdf_text` to what actually fits the extraction model's window.

    Measures with the countTokens endpoint instead of estimating from character
    count, rescales by the document's own measured chars-per-token ratio, and
    re-measures until it fits. Raises ExcessivePDFTextError if fitting would drop
    more than (1 - MIN_RETAINED_FRACTION) of the paper.
    """
    if len(pdf_text) <= UNMEASURED_CHAR_CEILING:
        return pdf_text

    content = pdf_text
    token_count = await llm_client.count_metadata_prompt_tokens(content)

    for _ in range(MAX_FIT_ITERATIONS):
        if token_count <= CONTENT_TOKEN_BUDGET:
            break
        keep_chars = int(
            len(content) * (CONTENT_TOKEN_BUDGET / token_count) * FIT_SAFETY_MARGIN
        )
        retained_fraction = keep_chars / len(pdf_text)
        if retained_fraction < MIN_RETAINED_FRACTION:
            raise ExcessivePDFTextError(
                f"PDF too large for the model: {token_count} tokens exceeds the "
                f"{CONTENT_TOKEN_BUDGET}-token budget, and truncating to fit would "
                f"keep only {retained_fraction:.0%} of the content "
                f"(minimum {MIN_RETAINED_FRACTION:.0%})"
            )
        content = content[:keep_chars]
        token_count = await llm_client.count_metadata_prompt_tokens(content)

    if token_count > CONTENT_TOKEN_BUDGET:
        raise ExcessivePDFTextError(
            f"PDF too large for the model: still {token_count} tokens after "
            f"{MAX_FIT_ITERATIONS} truncation passes (budget {CONTENT_TOKEN_BUDGET})"
        )

    if len(content) < len(pdf_text):
        logger.warning(
            f"PDF for job {job_id} exceeded the token budget; truncated to "
            f"{len(content)} chars / {token_count} tokens "
            f"({len(content) / len(pdf_text):.0%} retained) for metadata extraction"
        )

    return content


async def process_pdf_file(
    pdf_bytes: bytes,
    s3_object_key: str,
    job_id: str,
    status_callback: Callable[[str], None],
    skip_metadata_extraction: bool = False,
) -> PDFProcessingResult:
    """
    Process a PDF file by extracting metadata from bytes.

    Args:
        pdf_bytes: The PDF file content as bytes
        s3_object_key: The S3 object key of the PDF file
        job_id: Job ID for tracking
        status_callback: Function to update task status
        skip_metadata_extraction: When True, skip the LLM metadata/summary
            extraction entirely and only produce the deterministic outputs
            (preview, raw text, page offsets). Used by the Zotero import path,
            which already has authoritative metadata and wants to avoid the
            extra LLM cost/latency. `metadata` is left None on the result.

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

        # Define async functions for I/O-bound operations
        logger.info(f"About to define async functions for job {job_id}")

        async def generate_preview_async():
            status_callback("Taking a snapshot")
            try:
                return await asyncio.to_thread(generate_pdf_preview, temp_file_path)
            except Exception as e:
                logger.warning(f"Failed to generate preview for {safe_filename}: {str(e)}")
                return None, None

        metadata: Optional[PaperMetadataExtraction] = None

        if skip_metadata_extraction:
            # Lightweight path (e.g. Zotero import): only the deterministic
            # preview is needed; the caller already has authoritative metadata.
            async with time_it("Generating preview (metadata extraction skipped)", job_id=job_id):
                preview_result = await generate_preview_async()
        else:
            # These size limits only matter because we're about to feed the text
            # to the LLM; they're skipped for authoritative sources (e.g. Zotero)
            # that take the skip_metadata_extraction path above.
            extracted_chars = len(pdf_text.strip())

            # Too little text means a failed extraction (e.g. a scanned/image-only
            # PDF), not a real paper. Bail before spending an LLM cache call + four
            # extraction tasks on garbage, and surface a clear error.
            if extracted_chars < MIN_EXTRACTED_TEXT_CHARS:
                raise InsufficientPDFTextError(
                    f"Failed to extract usable text from PDF: only {extracted_chars} "
                    f"characters found (minimum {MIN_EXTRACTED_TEXT_CHARS})"
                )

            compressed_bytes = len(zlib.compress(pdf_text.encode("utf-8", "ignore")))
            if compressed_bytes < MIN_COMPRESSED_TEXT_BYTES:
                raise InsufficientPDFTextError(
                    f"PDF appears to be a scan with no extractable text: {extracted_chars} "
                    f"characters found, but they are mostly repeated boilerplate "
                    f"({compressed_bytes} bytes of unique content, minimum "
                    f"{MIN_COMPRESSED_TEXT_BYTES})"
                )

            # Cap what we send to the LLM at the model's context window. We keep the
            # full text for raw_content; only the metadata extraction sees a truncated
            # copy.
            content_for_llm = await fit_content_to_token_budget(pdf_text, job_id)

            # Run I/O-bound tasks and LLM extraction concurrently
            async with time_it("Running I/O-bound tasks and LLM extraction concurrently", job_id=job_id):
                preview_task = asyncio.create_task(generate_preview_async())
                metadata_task = asyncio.create_task(
                    llm_client.extract_paper_metadata(
                        content_for_llm, job_id=job_id, status_callback=status_callback
                    )
                )

                # Await all tasks
                preview_result, metadata_result = await asyncio.gather(
                    preview_task,
                    metadata_task,
                    return_exceptions=True
                )

            if isinstance(metadata_result, Exception):
                logger.error(f"Failed to extract metadata: {metadata_result}")
                raise metadata_result
            metadata = metadata_result # type: ignore

            # Validate before logging success — a missing title means the LLM
            # extraction effectively failed, even though no exception was raised.
            if not metadata or not metadata.title:
                raise Exception("Failed to extract metadata from PDF")

            logger.info(f"Successfully extracted metadata for {safe_filename}")

            # Process publication date
            if metadata.publish_date:
                try:
                    # Simplified date parsing logic
                    parsed_date = datetime.fromisoformat(metadata.publish_date.replace("Z", "+00:00"))
                    metadata.publish_date = parsed_date.strftime("%Y-%m-%d")
                except (ValueError, TypeError):
                    logger.warning(f"Could not parse date: {metadata.publish_date}, setting to None")
                    metadata.publish_date = None

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

        end_time = datetime.now(timezone.utc)
        duration = (end_time - start_time).total_seconds()

        logger.info(f"PDF processing completed successfully for {safe_filename} in {duration:.2f} seconds")

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
