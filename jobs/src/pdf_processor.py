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
                    pdf_text, job_id=job_id, status_callback=status_callback
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
