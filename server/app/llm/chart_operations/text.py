"""Text handling shared by chart planning and chart extraction.

Everything here answers one of two questions: are these two pieces of text the
same thing, and where in a paper is this field named. Both are asked by the
planner and by the extractor, so neither owns them.
"""

import hashlib
import re
import unicodedata
from typing import Optional

from app.schemas.chart import ChartField, ChartValue

# Terms in the plan-driven sweep. Enough to cover an axis and its primitives,
# few enough that the regex stays selective.
SWEEP_MAX_TERMS = 12
# No model reads these terms — the sweep is a regex over raw text, and a term
# that appears in every paper tells it nothing about where a measure is named.
# A plan whose y is "Score" or "Total Value" would otherwise match most lines of
# most documents and the sweep would return the paper rather than the passage.
# Only words generic enough to be noise in any field label belong here; anything
# that could name a subject must not.
SWEEP_STOPWORDS = frozenset(
    {
        "the",
        "and",
        "for",
        "with",
        "per",
        "each",
        "all",
        "any",
        "from",
        "into",
        "value",
        "values",
        "number",
        "count",
        "total",
        "amount",
        "level",
        "score",
        "rate",
        "size",
        "name",
        "type",
        "kind",
        "label",
        "field",
        "data",
        "point",
        "points",
        "paper",
        "papers",
        "study",
        "studies",
        "chart",
        "plot",
        "graph",
        "axis",
        "reported",
        "average",
        "mean",
    }
)


_NON_ALNUM_RE = re.compile(r"[^0-9a-z]+")
_WORD_RE = re.compile(r"[A-Za-z]{3,}")
# PDFs typeset a minus sign as U+2212 or an en dash, not as a hyphen, and a
# number that reaches the axis still wearing one parses as positive: an odds
# ratio of -0.4 sorts, and reads, as 0.4. Folding these before anything looks
# for a sign is what keeps that from happening.
#
# The quote and space variants below matter less — every other caller condenses
# to alphanumerics straight afterwards, which strips them anyway — but they
# keep two renderings of one retrieved line from deduplicating as two.
_TYPOGRAPHY = str.maketrans(
    {
        "‘": "'",
        "’": "'",
        "‚": "'",
        "‛": "'",
        "“": '"',
        "”": '"',
        "„": '"',
        "‐": "-",
        "‑": "-",
        "‒": "-",
        "–": "-",
        "—": "-",
        "―": "-",
        "−": "-",
        " ": " ",
        " ": " ",
        " ": " ",
        "​": "",
    }
)


def normalize(text: str) -> str:
    folded = unicodedata.normalize("NFKC", str(text)).translate(_TYPOGRAPHY)
    return re.sub(r"\s+", " ", folded).strip().casefold()


def condense(text: str) -> str:
    """Drop everything but letters and digits."""
    return _NON_ALNUM_RE.sub("", text)


def slug(value: str) -> str:
    return condense(normalize(value))[:48]


def values_digest(values: dict[str, ChartValue]) -> str:
    """A stable fingerprint of one extracted point.

    Hashing the content rather than counting emissions keeps identity
    independent of the order the model happened to return records in, so the
    same evidence yields the same record ids on every run.
    """
    material = "|".join(
        f"{key}={condense(normalize(values[key].value))}" for key in sorted(values)
    )
    return hashlib.sha1(material.encode("utf-8")).hexdigest()[:8]


def field_phrases(fields: list[ChartField]) -> str:
    """Search the measure as a whole phrase, not as loose words.

    Word-level alternation is what hides a narrow field: "Robust Accuracy"
    becomes robust|accuracy and matches every paper that says "accuracy", so a
    one-paper measure scores like a corpus-wide one. The phrase does not.
    """
    phrases: list[str] = []
    for field in fields:
        for text in (field.label, field.key.replace("_", " ")):
            cleaned = " ".join(text.split()).strip()
            if cleaned and cleaned.lower() not in {p.lower() for p in phrases}:
                phrases.append(cleaned)
    return "|".join(phrases)


def plan_terms(labels: list[str]) -> str:
    """The searchable words in a set of labels, minus the ones that say nothing."""
    terms: set[str] = set()
    for source in labels:
        for word in _WORD_RE.findall(source):
            lowered = word.lower()
            if lowered not in SWEEP_STOPWORDS:
                terms.add(lowered)
    return "|".join(sorted(terms)[:SWEEP_MAX_TERMS])


def field_terms(fields: list[ChartField]) -> str:
    """The searchable words in these fields' own labels and keys."""
    return plan_terms(
        [
            source
            for field in fields
            for source in (field.label, field.key.replace("_", " "))
        ]
    )


def phrase_pattern(fields: list[ChartField]) -> Optional[re.Pattern]:
    """Match a field's own wording literally.

    Field labels are prose and carry regex metacharacters — "Lat. (s)",
    "Accuracy (%)" — so every phrase is escaped before it becomes a pattern.
    """
    phrases = [phrase for phrase in field_phrases(fields).split("|") if phrase]
    if not phrases:
        return None
    return re.compile("|".join(re.escape(phrase) for phrase in phrases), re.IGNORECASE)
