"""
Sandboxed compute agent for computed data-table columns.

The extraction pipeline (jobs service) only ever returns primitives — cited
values stated in the papers. Computed columns (aggregates, effect sizes,
chained derivations, anything users can describe) are produced here: an LLM
writes a Python script from the column's natural-language spec, the script
runs in an E2B sandbox against a JSON snapshot of the extracted table, and
the script's output becomes the computed cells.

Two walls keep this auditable:
- The extraction wall: the script's only input is the snapshot of extracted,
  cited cells. It computes over them; it never extracts, and extraction never
  computes.
- Input binding: the snapshot contains only the columns the specs declare as
  inputs, so "what did this number come from" has a bounded answer even
  though the code is free-form.

Provenance is the trust mechanism: the exact snapshot, the final script, and
its stdout are persisted with the table, so every computed value is
reproducible and the program that made it is reviewable in the UI.

There is NO local execution path: the script is model-authored code and only
ever runs inside the sandbox. If E2B is unavailable the computed columns fail
(the extracted table persists without them) — they never run on the server.
"""

import json
import logging
import math
import os
import re
from typing import Any, Dict, List, Optional

from app.schemas.responses import ComputedColumnSpec, DataTableCellValue, DataTableRow

logger = logging.getLogger(__name__)

# Total script-generation attempts: one initial + repairs on runtime/contract
# errors, each fed the previous script and what went wrong.
MAX_ATTEMPTS = 3

TABLE_PATH = "/home/user/table.json"
OUTPUT_PATH = "/home/user/output.json"

COMPUTE_SCRIPT_SYSTEM_PROMPT = """
You write small, careful Python scripts that compute derived columns for a
research data table. The table's values were extracted verbatim from research
papers, each row is one paper.

Contract:
- Read the table from {table_path} (JSON, structure shown in the user message).
- Compute ONLY the requested computed columns, ONLY from the data in that
  file. Never use remembered or assumed values — every number you output must
  be derived from the input table. Do not hardcode data values in the script.
- Write your results to {output_path} as JSON:
  {{"columns": {{"<column label>": {{"<paper_id>": <value>}}}},
    "warnings": ["<anything a reviewer should know>"]}}
  with one entry per paper per requested column. Values may be numbers or
  short strings; use null when a value cannot be computed for that paper.
- Missing or unparseable inputs are the norm, not the exception: papers often
  don't report a value. NEVER silently impute, drop, or guess. If a paper's
  inputs are missing or ambiguous, output null for that paper and append a
  warning naming the paper and the problem. If you exclude non-numeric
  entries from an aggregate, say so in a warning.
- Use input column labels EXACTLY as given, character for character — a
  label like "Score of each model (%) (list)" includes its suffixes. At the
  start of the script, check that every input column you read appears in at
  least one row's cells; if one is missing, raise an error whose message
  lists the labels actually present (do NOT downgrade a missing column to a
  warning — a mislabeled lookup must fail loudly, not produce empty cells).
- Cell values are strings as extracted ("56.9%", "1,024 ms", "n=42") — parse
  numbers out of them robustly.
- List-valued cells have "entries": [{{"key": ..., "value": ...}}] where key
  is the instance label (model, dataset, condition). Keys are labels, never
  numeric data.
- Print any useful diagnostics to stdout; it is captured and shown to
  reviewers alongside the script.
- The sandbox has the Python standard library, pandas, and numpy. No network.

Respond with ONLY the Python script, in a single ```python code fence, no
prose before or after.
""".strip()

COMPUTE_SCRIPT_USER_MESSAGE = """
The extracted table is at {table_path}. Its JSON structure:

{{"rows": [{{"paper_id": str, "paper_title": str,
            "cells": {{"<column label>": {{"value": str}} |
                      {{"value": str, "entries": [{{"key": str | null, "value": str}}]}}}}}}]}}

Only these input columns are present in the file: {input_columns}

Compute these columns:

{spec_block}

Write the script now.
"""

REPAIR_USER_MESSAGE = """
Your previous script did not satisfy the contract.

Previous script:
```python
{script}
```

Problem:
{error}

Write a corrected script. Same contract: read {table_path}, write {output_path},
respond with only the Python script in a single ```python code fence.
"""

_CODE_FENCE_RE = re.compile(r"```(?:python)?\s*\n(.*?)```", re.DOTALL)


class ComputeAgentError(Exception):
    """The compute agent could not produce usable computed columns."""


def serialize_table(
    rows: List[DataTableRow],
    input_columns: List[str],
    paper_titles: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """Snapshot the extracted table for the script: declared input columns
    only, values and keys but not citations (citations stay on the stored
    primitive cells; the script has no use for quote text)."""
    paper_titles = paper_titles or {}
    snapshot_rows = []
    for row in rows:
        cells: Dict[str, Any] = {}
        for column in input_columns:
            cell = row.values.get(column)
            if cell is None:
                continue
            serialized: Dict[str, Any] = {"value": cell.value}
            if cell.entries:
                serialized["entries"] = [
                    {"key": entry.key, "value": entry.value} for entry in cell.entries
                ]
            cells[column] = serialized
        snapshot_rows.append(
            {
                "paper_id": row.paper_id,
                "paper_title": paper_titles.get(row.paper_id, ""),
                "cells": cells,
            }
        )
    return {"rows": snapshot_rows}


def _extract_script(response_text: str) -> Optional[str]:
    match = _CODE_FENCE_RE.search(response_text or "")
    if match:
        return match.group(1).strip()
    # A bare script without a fence is still a script.
    text = (response_text or "").strip()
    return text or None


def _generate_script(
    spec_block: str,
    input_columns: List[str],
    previous_script: Optional[str],
    previous_error: Optional[str],
) -> Optional[str]:
    # Imported lazily: operations pulls in the LLM stack, and this helper is
    # imported by modules that load before it.
    from app.llm.base import ModelType
    from app.llm.operations import operations
    from app.llm.provider import LLMProvider, TextContent

    if previous_script is None:
        text = COMPUTE_SCRIPT_USER_MESSAGE.format(
            table_path=TABLE_PATH,
            input_columns=", ".join(input_columns),
            spec_block=spec_block,
        )
    else:
        text = REPAIR_USER_MESSAGE.format(
            script=previous_script,
            error=previous_error,
            table_path=TABLE_PATH,
            output_path=OUTPUT_PATH,
        )

    response = operations.generate_content(
        contents=[TextContent(text=text)],
        system_prompt=COMPUTE_SCRIPT_SYSTEM_PROMPT.format(
            table_path=TABLE_PATH, output_path=OUTPUT_PATH
        ),
        model_type=ModelType.DEFAULT,
        provider=LLMProvider.GEMINI,
    )
    if not response or not response.text:
        return None
    return _extract_script(response.text)


def _run_script_in_sandbox(
    sandbox, script: str
) -> tuple[Optional[Dict[str, Any]], str, Optional[str]]:
    """Run the script; return (parsed output, stdout, error). Exactly one of
    output/error is set."""
    execution = sandbox.run_code(script, timeout=120)
    stdout = "".join(execution.logs.stdout)
    if execution.error:
        return (
            None,
            stdout,
            f"{execution.error.name}: {execution.error.value}\n{execution.error.traceback}",
        )
    try:
        raw = sandbox.files.read(OUTPUT_PATH)
    except Exception:
        return None, stdout, f"script completed but wrote no {OUTPUT_PATH}"
    try:
        output = json.loads(raw)
    except (json.JSONDecodeError, TypeError) as e:
        return None, stdout, f"{OUTPUT_PATH} is not valid JSON: {e}"
    if not isinstance(output, dict) or not isinstance(output.get("columns"), dict):
        return (
            None,
            stdout,
            f'{OUTPUT_PATH} must be {{"columns": {{label: {{paper_id: value}}}}, "warnings": [...]}}',
        )
    return output, stdout, None


def _validate_output(
    output: Dict[str, Any], specs: List[ComputedColumnSpec]
) -> Optional[str]:
    """Contract check worth a repair round: every requested column present,
    each mapping paper_id -> value."""
    missing = [s.label for s in specs if s.label not in output["columns"]]
    if missing:
        return f"output is missing requested column(s): {', '.join(missing)}"
    for label, cells in output["columns"].items():
        if not isinstance(cells, dict):
            return f'column "{label}" must map paper_id -> value, got {type(cells).__name__}'
    return None


def format_number(v: float) -> str:
    if not math.isfinite(v):
        return "N/A"
    return f"{v:.6g}"


def _format_value(value: Any) -> str:
    if value is None:
        return "N/A"
    if isinstance(value, bool):
        return str(value)
    if isinstance(value, (int, float)):
        return format_number(float(value))
    text = str(value).strip()
    return text or "N/A"


def run_computed_columns(
    rows: List[DataTableRow],
    specs: List[ComputedColumnSpec],
    paper_titles: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """Compute every computed column via the sandboxed agent and attach the
    cells to the rows in place.

    Returns the provenance record to persist with the table: the exact input
    snapshot the script ran against, the final script, its stdout, and any
    warnings — enough to re-run or review the computation without
    re-extraction.

    Raises ComputeAgentError when no usable script could be produced; the
    caller persists the extracted table without computed cells.
    """
    if not specs:
        return {}

    api_key = os.getenv("E2B_DEV_API_KEY") or os.getenv("E2B_API_KEY")
    if not api_key:
        raise ComputeAgentError(
            "E2B API key is required for computed columns: set E2B_DEV_API_KEY "
            "or E2B_API_KEY. Model-authored scripts only ever run in the sandbox."
        )

    input_columns = sorted({column for spec in specs for column in spec.inputs})
    snapshot = serialize_table(rows, input_columns, paper_titles)
    spec_block = "\n".join(
        f'- "{spec.label}": {spec.spec}\n  reads: {", ".join(spec.inputs) or "(none declared)"}'
        for spec in specs
    )

    from e2b_code_interpreter import Sandbox

    sandbox = Sandbox.create(api_key=api_key, timeout=300)
    script: Optional[str] = None
    stdout = ""
    error: Optional[str] = None
    output: Optional[Dict[str, Any]] = None
    attempts = 0
    try:
        sandbox.files.write(TABLE_PATH, json.dumps(snapshot))
        for attempts in range(1, MAX_ATTEMPTS + 1):
            candidate = _generate_script(
                spec_block=spec_block,
                input_columns=input_columns,
                previous_script=script,
                previous_error=error,
            )
            if not candidate:
                error = "model returned no script"
                continue
            script = candidate
            output, stdout, error = _run_script_in_sandbox(sandbox, script)
            if output is not None:
                error = _validate_output(output, specs)
                if error is None:
                    break
                output = None
    finally:
        sandbox.kill()

    if output is None:
        raise ComputeAgentError(
            f"compute agent failed after {attempts} attempt(s): {error}"
        )

    warnings = [str(w) for w in output.get("warnings") or []]
    known_paper_ids = {row.paper_id for row in rows}
    for label, cells in output["columns"].items():
        unknown = set(cells) - known_paper_ids
        if unknown:
            warnings.append(
                f'column "{label}": script emitted values for unknown paper ids '
                f"({', '.join(sorted(unknown))}) — ignored"
            )

    for spec in specs:
        cells = output["columns"][spec.label]
        for row in rows:
            row.values[spec.label] = DataTableCellValue(
                value=_format_value(cells.get(row.paper_id)),
                citations=[],
            )

    return {
        "version": 1,
        "specs": [spec.model_dump() for spec in specs],
        "inputs_snapshot": snapshot,
        "script": script,
        "stdout": stdout,
        "warnings": warnings,
        "attempts": attempts,
    }
