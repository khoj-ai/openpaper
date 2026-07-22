"""
Deterministic calculator for derived data-table columns.

The extraction pipeline (jobs service) only ever returns primitives — values
stated in the paper. Derived columns (effect sizes, ratios, % change, ...) are
computed here, server-side, from those primitives, so every derived number
carries a derivation the UI can show and every input resolves to a citation.
Living on the server (not the jobs worker) means derived columns can be
recomputed from stored primitives without re-running extraction, and future
features (charts, briefs) share the same helpers.

Expressions are a constrained language, validated by AST whitelist before
execution: arithmetic operators, numeric literals, input aliases, and the named
statistical functions in STAT_FUNCTIONS_SOURCE. Nothing else parses. The
whitelist is a provenance measure (a formula we can display beats generated
code we can't audit); the sandbox is the security measure.

Execution substrate is selected by environment:
- E2B sandbox (default when an E2B API key is configured): the same function
  library and the validated expressions run inside an isolated sandbox, one
  sandbox session per compute call.
- Local (fallback, and used by tests): the expressions are evaluated in-process
  with an empty-builtins namespace. Safe because validation already restricts
  the language to arithmetic over aliases.

Set CALCULATOR_EXECUTOR=local|e2b to override. E2B key is read from
E2B_DEV_API_KEY or E2B_API_KEY.
"""

import ast
import json
import logging
import math
import os
import re
from typing import Any, Dict, List, Optional, Tuple

from app.schemas.responses import (
    CellDerivation,
    DataTableCellValue,
    DataTableRow,
    DerivationInput,
    DerivedColumnSpec,
)

logger = logging.getLogger(__name__)

# Python source for the whitelisted statistical functions. Kept as source (not
# just defs) so the exact same code runs locally and inside the E2B sandbox.
STAT_FUNCTIONS_SOURCE = '''
import math

def cohens_d(mean_1, sd_1, n_1, mean_2, sd_2, n_2):
    """Cohen's d with pooled standard deviation."""
    pooled_sd = math.sqrt(
        ((n_1 - 1) * sd_1 ** 2 + (n_2 - 1) * sd_2 ** 2) / (n_1 + n_2 - 2)
    )
    return (mean_1 - mean_2) / pooled_sd

def hedges_g(mean_1, sd_1, n_1, mean_2, sd_2, n_2):
    """Hedges' g: Cohen's d with small-sample correction."""
    d = cohens_d(mean_1, sd_1, n_1, mean_2, sd_2, n_2)
    correction = 1 - 3 / (4 * (n_1 + n_2) - 9)
    return d * correction

def pct_change(new, old):
    """Percent change from old to new."""
    return (new - old) / old * 100

def ratio(a, b):
    return a / b

def ci95_low(estimate, se):
    """Lower bound of a 95% CI from an estimate and its standard error."""
    return estimate - 1.96 * se

def ci95_high(estimate, se):
    """Upper bound of a 95% CI from an estimate and its standard error."""
    return estimate + 1.96 * se

def log(x):
    return math.log(x)

def log2(x):
    return math.log2(x)

def log10(x):
    return math.log10(x)

def sqrt(x):
    return math.sqrt(x)

def median(xs):
    """Median of a list of numbers."""
    s = sorted(xs)
    n = len(s)
    if n == 0:
        raise ValueError("median of empty list")
    m = n // 2
    return float(s[m]) if n % 2 else (s[m - 1] + s[m]) / 2

def mean(xs):
    """Arithmetic mean of a list of numbers."""
    if not xs:
        raise ValueError("mean of empty list")
    return sum(xs) / len(xs)

def count(xs):
    """Number of elements in a list."""
    return len(xs)
'''

WHITELISTED_FUNCTIONS = {
    "cohens_d",
    "hedges_g",
    "pct_change",
    "ratio",
    "ci95_low",
    "ci95_high",
    "log",
    "log2",
    "log10",
    "sqrt",
    "abs",
    "min",
    "max",
    "round",
    "median",
    "mean",
    "count",
    "sum",
}

# Functions that accept a list-valued alias as an argument. A list alias may
# ONLY appear as a direct argument to one of these — anywhere else in an
# expression a list is a type error we can catch before execution.
AGGREGATE_FUNCTIONS = {"median", "mean", "count", "sum", "min", "max"}

_ALLOWED_NODES = (
    ast.Expression,
    ast.BinOp,
    ast.UnaryOp,
    ast.Add,
    ast.Sub,
    ast.Mult,
    ast.Div,
    ast.Pow,
    ast.Mod,
    ast.USub,
    ast.UAdd,
    ast.Call,
    ast.Name,
    ast.Load,
    ast.Constant,
)


def validate_expression(
    expression: str,
    aliases: List[str],
    list_aliases: Optional[List[str]] = None,
) -> Optional[str]:
    """Validate an expression against the whitelist grammar.

    `list_aliases` names the aliases bound to list-valued columns; those may
    only appear as direct arguments to aggregate functions.

    Returns an error message, or None if the expression is valid.
    """
    list_alias_set = set(list_aliases or [])
    try:
        tree = ast.parse(expression, mode="eval")
    except SyntaxError as e:
        return f"invalid expression syntax: {e.msg}"

    # Names appearing as direct arguments to an aggregate call are the only
    # positions where a list alias is legal.
    aggregate_arg_names = set()
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id in AGGREGATE_FUNCTIONS
        ):
            for arg in node.args:
                if isinstance(arg, ast.Name):
                    aggregate_arg_names.add(id(arg))

    for node in ast.walk(tree):
        if not isinstance(node, _ALLOWED_NODES):
            return f"disallowed construct: {type(node).__name__}"
        if isinstance(node, ast.Call):
            if not isinstance(node.func, ast.Name):
                return "only direct calls to named functions are allowed"
            if node.func.id not in WHITELISTED_FUNCTIONS:
                return f"unknown function: {node.func.id}"
            if node.keywords:
                return "keyword arguments are not allowed"
        if isinstance(node, ast.Constant) and not isinstance(node.value, (int, float)):
            return f"non-numeric literal: {node.value!r}"
        if isinstance(node, ast.Name):
            if node.id not in WHITELISTED_FUNCTIONS and node.id not in aliases:
                return f"unknown name: {node.id}"
            if node.id in list_alias_set and id(node) not in aggregate_arg_names:
                return (
                    f"list input '{node.id}' can only be used inside an aggregate "
                    f"function ({', '.join(sorted(AGGREGATE_FUNCTIONS))})"
                )

    return None


# The lookbehind stops a word-glued hyphen from reading as a minus sign and a
# mid-token digit from starting a match: "gemini-3.1-pro" parses as 3.1 (not
# -3.1), "v2.5" parses as nothing rather than a fragment.
_NUMERIC_RE = re.compile(r"(?<![\w.])-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?")


def parse_numeric(value: str) -> Optional[float]:
    """Pull a float out of an extracted cell value like '56.9', '56.9%',
    '4,326' or '5.2 ms'."""
    if value is None:
        return None
    cleaned = value.strip().replace(",", "")
    m = _NUMERIC_RE.search(cleaned)
    if not m:
        return None
    try:
        return float(m.group(0))
    except ValueError:
        return None


def format_number(v: float) -> str:
    if not math.isfinite(v):
        return "N/A"
    return f"{v:.6g}"


# ---------------------------------------------------------------------------
# Executors
# ---------------------------------------------------------------------------

# Each work item: one derived cell to compute.
# {"row": int, "label": str, "expression": str, "variables": {alias: float}}
WorkItem = Dict[str, Any]
# Result: {"row": int, "label": str, "value": float | None, "error": str | None}

# The eval loop exists once, as source, so the exact same code runs in-process
# and inside the E2B sandbox. Plain string (no .format) to avoid brace-escaping.
_RUN_ITEMS_SOURCE = """

def run_items(items):
    funcs = {name: globals()[name] for name in _FUNCTION_NAMES if name in globals()}
    funcs.update({"abs": abs, "min": min, "max": max, "round": round, "sum": sum})
    results = []
    for item in items:
        env = {"__builtins__": {}}
        env.update(funcs)
        env.update(item["variables"])
        try:
            value = eval(compile(item["expression"], "<derived>", "eval"), env)
            results.append({"row": item["row"], "label": item["label"], "value": float(value), "error": None})
        except Exception as e:
            results.append({"row": item["row"], "label": item["label"], "value": None, "error": str(e)})
    return results
"""

RUNNER_SOURCE = (
    STAT_FUNCTIONS_SOURCE
    + "\n_FUNCTION_NAMES = "
    + repr(sorted(WHITELISTED_FUNCTIONS))
    + _RUN_ITEMS_SOURCE
)


def _run_local(items: List[WorkItem]) -> List[Dict[str, Any]]:
    namespace: Dict[str, Any] = {}
    exec(RUNNER_SOURCE, namespace)  # our own static source, not user code
    return namespace["run_items"](items)


def _run_e2b(items: List[WorkItem], api_key: str) -> List[Dict[str, Any]]:
    from e2b_code_interpreter import Sandbox

    script = (
        RUNNER_SOURCE
        + "\nimport json"
        + f"\nprint(json.dumps(run_items(json.loads({json.dumps(items)!r}))))"
    )

    sandbox = Sandbox.create(api_key=api_key, timeout=120)
    try:
        execution = sandbox.run_code(script, timeout=60)
        if execution.error:
            raise RuntimeError(
                f"E2B execution failed: {execution.error.name}: {execution.error.value}"
            )
        stdout = "".join(execution.logs.stdout)
        return json.loads(stdout)
    finally:
        sandbox.kill()


def _execute(items: List[WorkItem]) -> List[Dict[str, Any]]:
    """Run work items on the configured executor.

    Explicitly requesting the sandbox without credentials is a hard error —
    silently degrading to in-process eval would void the sandbox guarantee.
    E2B *runtime* failures still fall back to local: the expressions were
    already AST-validated, and availability blips shouldn't fail jobs.
    """
    if not items:
        return []

    executor = os.getenv("CALCULATOR_EXECUTOR", "").lower()
    api_key = os.getenv("E2B_DEV_API_KEY") or os.getenv("E2B_API_KEY")

    if executor == "e2b" and not api_key:
        raise RuntimeError(
            "CALCULATOR_EXECUTOR=e2b but no E2B_DEV_API_KEY/E2B_API_KEY is set"
        )

    if api_key and executor != "local":
        try:
            return _run_e2b(items, api_key)
        except Exception as e:
            logger.error(
                f"E2B executor failed, falling back to local: {e}", exc_info=True
            )
    return _run_local(items)


# ---------------------------------------------------------------------------
# Derived-cell computation over extracted rows
# ---------------------------------------------------------------------------


def _parse_list_input(cell) -> Tuple[Optional[List[float]], List[str], str, list]:
    """Parse a list-valued cell into numeric elements.

    Returns (numbers or None, warnings, display value, citations). Non-numeric
    elements are excluded with a warning; an empty or absent list is missing.
    """
    entries = (cell.entries if cell else None) or []
    numbers: List[float] = []
    warnings: List[str] = []
    citations: list = []
    seen_citations = set()

    for entry in entries:
        numeric = parse_numeric(entry.value)
        if numeric is None:
            warnings.append(f"non-numeric element '{entry.value}' excluded")
        else:
            numbers.append(numeric)
            # An element carrying several numbers means extraction packed more
            # than one value into it — which one was meant is a guess.
            if len(_NUMERIC_RE.findall(entry.value.replace(",", ""))) > 1:
                warnings.append(
                    f"element '{entry.value}' contains multiple numbers; used {format_number(numeric)}"
                )
        # Many elements share a source (one table quoted once) — dedupe so the
        # derivation carries each supporting quote once, not once per element.
        for citation in entry.citations:
            key = (citation.index, citation.text)
            if key not in seen_citations:
                seen_citations.add(key)
                citations.append(citation)

    if not numbers:
        return None, warnings, "N/A", citations

    display = "[" + ", ".join(format_number(n) for n in numbers) + "]"
    return numbers, warnings, display, citations


def compute_derived_cells(
    rows: List[DataTableRow],
    derived_columns: List[DerivedColumnSpec],
    list_columns: Optional[set] = None,
) -> None:
    """Compute every derived cell across all rows in one executor pass and
    attach {value, derivation} cells to the rows in place.

    `list_columns` names the columns whose cells are list-valued; aliases bound
    to them become list variables, legal only inside aggregate functions.

    A derived cell whose inputs are missing or non-numeric gets value "N/A"
    and a warning naming each unusable input — missingness must be explained,
    never silent.
    """
    if not derived_columns:
        return

    list_columns = list_columns or set()
    items: List[WorkItem] = []
    derivations: Dict[Tuple[int, str], CellDerivation] = {}

    for spec in derived_columns:
        aliases = list(spec.inputs.keys())
        list_aliases = [a for a, col in spec.inputs.items() if col in list_columns]
        validation_error = validate_expression(spec.expression, aliases, list_aliases)
        if validation_error:
            # Rejected expressions are the signal for when the whitelist stops
            # being enough.
            logger.warning(
                f"derived_expression_rejected: column={spec.label!r} "
                f"expression={spec.expression!r} error={validation_error!r}"
            )

        for row_idx, row in enumerate(rows):
            inputs: List[DerivationInput] = []
            variables: Dict[str, Any] = {}
            warnings: List[str] = []
            has_missing_input = False

            for alias, column in spec.inputs.items():
                cell = row.values.get(column)

                if column in list_columns:
                    numbers, list_warnings, display, citations = _parse_list_input(cell)
                    warnings.extend(f"{column}: {w}" for w in list_warnings)
                    if numbers is None:
                        has_missing_input = True
                        warnings.append(f"{column} not reported (needed as '{alias}')")
                    else:
                        variables[alias] = numbers
                    inputs.append(
                        DerivationInput(
                            alias=alias,
                            column=column,
                            value=display,
                            citations=citations,
                        )
                    )
                    continue

                raw = cell.value if cell else ""
                numeric = parse_numeric(raw) if raw else None
                if numeric is None:
                    has_missing_input = True
                    warnings.append(f"{column} not reported (needed as '{alias}')")
                else:
                    variables[alias] = numeric
                    # "95% CI 15.8-16.0" parses, but which number was meant is
                    # ambiguous — surface it rather than compute silently.
                    if len(_NUMERIC_RE.findall(raw.replace(",", ""))) > 1:
                        warnings.append(
                            f"{column} value '{raw}' contains multiple numbers; used {format_number(numeric)}"
                        )
                inputs.append(
                    DerivationInput(
                        alias=alias,
                        column=column,
                        value=raw or "N/A",
                        citations=cell.citations if cell else [],
                    )
                )

            derivation = CellDerivation(
                expression=spec.expression, inputs=inputs, warnings=warnings
            )
            derivations[(row_idx, spec.label)] = derivation

            if validation_error:
                derivation.warnings.append(f"invalid expression: {validation_error}")
            elif not has_missing_input:
                items.append(
                    {
                        "row": row_idx,
                        "label": spec.label,
                        "expression": spec.expression,
                        "variables": variables,
                    }
                )

    computed: Dict[Tuple[int, str], Dict[str, Any]] = {
        (r["row"], r["label"]): r for r in _execute(items)
    }

    for spec in derived_columns:
        for row_idx, row in enumerate(rows):
            derivation = derivations[(row_idx, spec.label)]
            result = computed.get((row_idx, spec.label))

            if result and result["error"]:
                derivation.warnings.append(f"computation failed: {result['error']}")

            if result and result["value"] is not None and not result["error"]:
                value = format_number(result["value"])
            else:
                value = "N/A"

            row.values[spec.label] = DataTableCellValue(
                value=value, citations=[], derivation=derivation
            )
