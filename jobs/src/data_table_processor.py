import asyncio
import logging
import tempfile
from typing import Callable, List, Tuple, Optional

from src.schemas import DataTableRow, DataTableSchema, DataTableResult, DataTableCellValue, DocumentMapping
from src.s3_service import s3_service
from src.llm_client import fast_llm_client


logger = logging.getLogger(__name__)

# Maximum number of concurrent paper extractions
DEFAULT_BATCH_SIZE = 5


async def _process_single_paper(
    paper: DocumentMapping,
    columns: List[str],
    status_callback: Callable[[str], None],
    semaphore: asyncio.Semaphore,
) -> Tuple[DataTableRow, Optional[str]]:
    """
    Process a single paper extraction with semaphore-controlled concurrency.

    Args:
        paper: The paper to process
        columns: Column names to extract
        status_callback: Callback for status updates
        semaphore: Semaphore to control concurrency

    Returns:
        Tuple of (DataTableRow, failure_id or None)
    """
    async with semaphore:
        paper_id = paper.id
        paper_object_key = paper.s3_object_key

        try:
            # Run S3 download in thread pool to not block the event loop
            raw_file_bytes = await asyncio.to_thread(
                s3_service.download_file_to_bytes, paper_object_key
            )

            with tempfile.NamedTemporaryFile(delete_on_close=True) as temp_file:
                temp_file.write(raw_file_bytes)
                temp_file_path = temp_file.name

                # Use LLM to extract data for the specified columns
                paper_col_values: DataTableRow = await fast_llm_client.extract_data_table(
                    file_path=temp_file_path,
                    columns=columns,
                    paper_id=paper_id
                )

                status_callback(f"extract for {paper.title} completed")
                return paper_col_values, None

        except Exception as e:
            logger.error(f"Error processing paper {paper_id} ({paper.title}): {str(e)}", exc_info=True)
            status_callback(f"extract for {paper.title} failed: {str(e)}")

            # Return row with empty values to maintain paper ordering
            empty_row = DataTableRow(
                paper_id=paper_id,
                values={col: DataTableCellValue(value="", citations=[]) for col in columns}
            )
            return empty_row, str(paper_id)


async def construct_data_table(
    data_table_schema: DataTableSchema,
    status_callback: Callable[[str], None],
    batch_size: int = DEFAULT_BATCH_SIZE,
) -> Tuple[DataTableResult, str]:
    """
    Construct a data table based on the provided schema.

    Papers are processed concurrently in batches to improve performance.

    Args:
        data_table_schema: Schema defining the data table structure
        status_callback: Callback for status updates
        batch_size: Maximum number of papers to process concurrently (default: 5)

    Returns:
        DataTableResult: Resulting data table
        str: Error message if any
    """
    semaphore = asyncio.Semaphore(batch_size)

    # Create tasks for all papers
    tasks = [
        _process_single_paper(
            paper=p,
            columns=data_table_schema.columns,
            status_callback=status_callback,
            semaphore=semaphore,
        )
        for p in data_table_schema.papers
    ]

    # Process all papers concurrently (semaphore controls max parallelism)
    results = await asyncio.gather(*tasks)

    # Separate rows and failures while maintaining order
    rows: List[DataTableRow] = []
    row_failures: List[str] = []

    for row, failure_id in results:
        rows.append(row)
        if failure_id is not None:
            row_failures.append(failure_id)

    error_msg = ""
    if row_failures:
        error_msg = f"Failed to process {len(row_failures)} paper(s)"

    return DataTableResult(
        success=True,
        columns=[col for col in data_table_schema.columns],
        rows=rows,
        row_failures=row_failures,
    ), error_msg
