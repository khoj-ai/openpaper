"""Reading the number out of a value a paper printed.

A quoted value is prose with a number in it — "12%", "1.5 (95% CI 1.1-9.4)",
"4900 ms", "p < 0.001" — and the chart plots one float. Getting from one to the
other is parsing, and parsing is the application's job: it is the same answer
every time, and it is the guard that keeps a bound from becoming a bar.

What this module deliberately does NOT do is convert. Which unit a number ends
up in is decided by the plan and carried out by the extractor's own lambda in
the sandbox, because the set of conversions a literature needs cannot be
written down in advance.
"""

import re
from typing import NamedTuple, Optional

from app.llm.chart_operations.text import normalize

_NUMBER_RE = re.compile(r"[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?")
_COMPARISON = frozenset("<>≤≥")
# A unit glued to its number: "12%", "8.4 mg/dL", "37 °C".
_UNIT_RE = re.compile(r"\s?([a-zA-Zµμ%°]+(?:\s?/\s?[a-zA-Zµμ%°]+)?)")


class Quantity(NamedTuple):
    """What a quoted value amounts to, once read."""

    number: Optional[float]
    unit: str


def normalize_unit(raw: Optional[str]) -> str:
    """One spelling of what the paper called its unit.

    Casefolding and trimming punctuation, and nothing more. There is no longer
    a table saying "sec" and "s" are the same unit, because nothing here needs
    to know: the extractor names the unit for display and proposes the
    arithmetic separately, so two spellings of one unit cost two identical
    lambdas rather than a wrong axis.
    """
    if not raw:
        return ""
    cleaned = normalize(raw).strip(" .()[]")
    return re.sub(r"\s*/\s*", "/", cleaned)


def _trailing_unit(text: str, position: int) -> str:
    """A unit sitting against the number, when it is unmistakably one.

    The extractor is asked for the unit outright, so this only covers what it
    left blank — and blank is most likely where the unit is punctuation stuck
    to the digits, "12%" or "37°C". A bare word is not taken: "33 patients" is
    a count with a noun after it, and calling patients a unit would put it on
    the axis label.
    """
    match = _UNIT_RE.match(text, position)
    if not match:
        return ""
    unit = normalize_unit(match.group(1))
    return "" if unit.isalpha() else unit


def parse_quantity(raw: str) -> Quantity:
    """The quantity a quoted value carries, or a number of None if it carries none.

    The leading number is the value; whatever follows it is annotation the
    chart does not plot — a confidence interval, a standard deviation — except
    for a unit sitting directly against it, which is part of the measurement.
    So "1.5 (95% CI 1.1-9.4)" is 1.5 with no unit, and "12%" is 12 percent.

    A comparison in front of the number means the paper did not report a value
    at all. "p < 0.001" is a bound, and drawing it as a bar of 0.001 states
    something the study never claimed, so it is refused and the point is
    excluded with a reason rather than quietly plotted.
    """
    folded = normalize(raw).replace(",", "")
    match = _NUMBER_RE.search(folded)
    if not match:
        return Quantity(None, "")
    if any(character in _COMPARISON for character in folded[: match.start()]):
        return Quantity(None, "")
    try:
        number = float(match.group())
    except ValueError:
        return Quantity(None, "")
    return Quantity(number, _trailing_unit(folded, match.end()))
