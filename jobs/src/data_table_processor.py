import logging
import tempfile
from typing import Callable, List, Tuple

from src.schemas import DataTableRow, DataTableSchema, DataTableResult
from src.s3_service import s3_service
from src.llm_client import llm_client


logger = logging.getLogger(__name__)

async def construct_data_table(
    data_table_schema: DataTableSchema,
    status_callback: Callable[[str], None],
) -> Tuple[DataTableResult, str]:
    """
    Construct a data table based on the provided schema.

    Args:
        data_table_schema: Schema defining the data table structure

    Returns:
        DataTableResult: Resulting data table
        str: Error message if any
    """
    try:
        # Construct data rows based on the columns defined in the schema, for each paper, separately.
        rows: List[DataTableRow] = []
        for p in data_table_schema.papers:
            paper_id  = p.id
            paper_object_key = p.s3_object_key

            raw_file_bytes = s3_service.download_file_to_bytes(paper_object_key)

            with tempfile.NamedTemporaryFile(delete_on_close=True) as temp_file:
                temp_file.write(raw_file_bytes)
                temp_file_path = temp_file.name

                # Use LLM to extract data for the specified columns
                paper_col_values: DataTableRow = await llm_client.extract_data_table(
                    file_path=temp_file_path,
                    columns=data_table_schema.columns,
                    paper_id=paper_id
                )

                status_callback(f"extract for {p.title} completed")

                # Store in the rows list
                rows.append(paper_col_values)

        return DataTableResult(
            success=True,
            columns=[col for col in data_table_schema.columns],
            rows=rows
        ), ''

    except Exception as e:
        logger.error(f"Error constructing data table: {str(e)}", exc_info=True)
        return DataTableResult(
            success=False,
            columns=[col for col in data_table_schema.columns],
            rows=[],
        ), str(e)
