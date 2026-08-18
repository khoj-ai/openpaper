"""Running the extractor's unit conversions, in the sandbox and nowhere else.

One paper reports a latency of 4.9 s and the next reports 4900 ms; plotted as
bare numbers they differ by a factor of a thousand and the chart is worse than
no chart. Reconciling them used to be a fixed table of scale factors, which
quietly drew a boundary around what a corpus was allowed to measure: five
dimensions were convertible and everything else — km to miles, Celsius to
Fahrenheit, per-1000 to per-100k — came back as "cannot be expressed", which is
a lie told confidently. The tail of what papers report cannot be enumerated in
advance, so the conversion is proposed per value by the extractor, which has
the paper open and can see what its numbers mean.

That makes each conversion model-authored code, and model-authored code runs in
the sandbox — the same wall the computed-columns agent stands behind. Two
things keep it bounded:

- The harness below is OURS. The model contributes one lambda per value and
  nothing else; it does not write the program, choose the inputs, or decide the
  output shape. A lambda that fails costs its own point and no other.
- Shape is checked here before anything is shipped: a single lambda expression
  of one argument, or the value is excluded. That is what stops a conversion
  string from being a second statement in the harness.

There is no local execution path. If E2B is unavailable, the values needing
conversion are excluded and the chart draws from the rest.
"""

import ast
import json
import logging
import os
from typing import Any, NamedTuple, Optional

logger = logging.getLogger(__name__)

CONVERSIONS_PATH = "/home/user/conversions.json"
CONVERTED_PATH = "/home/user/converted.json"

# Written here, not by a model. Each lambda is evaluated against a small
# numeric namespace and applied to exactly one number; anything it raises is
# that one item's error, recorded and moved past.
HARNESS = f"""
import json, math

ALLOWED = {{
    "abs": abs, "round": round, "min": min, "max": max, "pow": pow,
    "float": float, "int": int, "sum": sum, "len": len,
}}

with open({CONVERSIONS_PATH!r}) as handle:
    items = json.load(handle)

results = {{}}
for item in items:
    try:
        convert = eval(item["conversion"], {{"__builtins__": ALLOWED, "math": math}})
        converted = float(convert(item["number"]))
        if not math.isfinite(converted):
            raise ValueError("conversion produced " + repr(converted))
        results[item["key"]] = {{"number": converted}}
        print(item["key"], item["number"], "->", converted, item["conversion"])
    except Exception as exc:
        results[item["key"]] = {{"error": type(exc).__name__ + ": " + str(exc)}}
        print(item["key"], "FAILED", item["conversion"], results[item["key"]]["error"])

with open({CONVERTED_PATH!r}, "w") as handle:
    json.dump(results, handle)
"""


class ConversionError(Exception):
    """The conversions could not be run at all."""


class ConversionRequest(NamedTuple):
    """One number to move, and the lambda the extractor proposed for it."""

    key: str
    number: float
    conversion: str


class ConversionResult(NamedTuple):
    """What came back for one number: a converted value, or why not."""

    number: Optional[float] = None
    error: str = ""


def shape_error(conversion: str) -> str:
    """What is wrong with this conversion's shape, or nothing.

    The lambda runs in the sandbox, so this is not a security boundary — it is
    a contract check. A conversion that is a statement, or takes two arguments,
    or is prose, would either break the harness for its own item or silently
    return something that is not a number, and both are better caught here
    where the value can be excluded with a reason.
    """
    text = (conversion or "").strip()
    if not text:
        return "no conversion was given"
    try:
        parsed = ast.parse(text, mode="eval")
    except SyntaxError as exc:
        return f"not a Python expression ({exc.msg})"
    node = parsed.body
    if not isinstance(node, ast.Lambda):
        return "not a lambda"
    args = node.args
    if args.vararg or args.kwarg or args.kwonlyargs or args.defaults:
        return "not a lambda of exactly one plain argument"
    if len(args.posonlyargs) + len(args.args) != 1:
        return "not a lambda of exactly one argument"
    return ""


def is_identity(conversion: str) -> bool:
    """Does this lambda return its argument untouched?

    Most papers already report in the plan's unit, so most conversions are
    `lambda v: v`. Recognising that here is what keeps the common chart from
    paying for a sandbox it has no work for.
    """
    if shape_error(conversion):
        return False
    node = ast.parse(conversion.strip(), mode="eval").body
    assert isinstance(node, ast.Lambda)
    argument = (node.args.posonlyargs + node.args.args)[0].arg
    return isinstance(node.body, ast.Name) and node.body.id == argument


def run_unit_conversions(
    requests: list[ConversionRequest],
) -> tuple[dict[str, ConversionResult], dict[str, Any]]:
    """Apply every conversion in one sandbox run.

    Returns the result per key and the provenance to persist alongside the
    chart: the harness, each lambda and its input, and what came back. Raises
    ConversionError when the run could not happen at all — no key, no sandbox,
    no output — which the caller reports as excluded points rather than
    plotting unconverted numbers on the axis.
    """
    if not requests:
        return {}, {}

    api_key = os.getenv("E2B_DEV_API_KEY") or os.getenv("E2B_API_KEY")
    if not api_key:
        raise ConversionError(
            "E2B API key is required to convert units: set E2B_DEV_API_KEY or "
            "E2B_API_KEY. Model-authored conversions only run in the sandbox."
        )

    from e2b_code_interpreter import Sandbox

    payload = [request._asdict() for request in requests]
    sandbox = Sandbox.create(api_key=api_key, timeout=120)
    try:
        sandbox.files.write(CONVERSIONS_PATH, json.dumps(payload))
        execution = sandbox.run_code(HARNESS, timeout=60)
        stdout = "".join(execution.logs.stdout)
        if execution.error:
            raise ConversionError(f"{execution.error.name}: {execution.error.value}")
        try:
            raw = json.loads(sandbox.files.read(CONVERTED_PATH))
        except Exception as exc:
            raise ConversionError(f"the conversion run wrote no results: {exc}")
    finally:
        sandbox.kill()

    results: dict[str, ConversionResult] = {}
    for request in requests:
        entry = raw.get(request.key) if isinstance(raw, dict) else None
        if not isinstance(entry, dict):
            results[request.key] = ConversionResult(error="was not converted")
        elif entry.get("error"):
            results[request.key] = ConversionResult(error=str(entry["error"]))
        else:
            results[request.key] = ConversionResult(number=float(entry["number"]))

    provenance = {
        "version": 1,
        "harness": HARNESS,
        "inputs": payload,
        "results": {key: result._asdict() for key, result in results.items()},
        "stdout": stdout,
    }
    return results, provenance
