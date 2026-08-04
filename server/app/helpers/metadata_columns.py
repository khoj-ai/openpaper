"""Resolve metadata-like data-table columns from stored paper records.

Bibliographic fields (authors, publication year, journal, ...) already live on
the Paper row — filled by metadata extraction at upload and OpenAlex
hydration. Columns whose label clearly asks for one of these are answered from
the database instead of asking the extraction model to find page furniture in
the PDF: stored values are ground truth, cheaper, and immune to the model
declining a paper it deems off-topic for the table.
"""

import re
from typing import Dict, Iterable, List, Optional

from app.schemas.responses import DataTableCellValue, DataTableRow

_FIELD_SYNONYMS = {
    "authors": (
        "author",
        "authors",
        "authorname",
        "authornames",
        "paperauthors",
        "studyauthors",
    ),
    "year": (
        "year",
        "publicationyear",
        "yearpublished",
        "pubyear",
        "yearofpublication",
        "publishyear",
    ),
    "publish_date": (
        "publicationdate",
        "publishdate",
        "datepublished",
        "dateofpublication",
    ),
    "institutions": (
        "institution",
        "institutions",
        "affiliation",
        "affiliations",
        "authoraffiliations",
        "authorinstitutions",
    ),
    "journal": ("journal", "journalname", "journaltitle"),
    "doi": ("doi", "doinumber", "digitalobjectidentifier"),
    "title": ("title", "papertitle", "articletitle", "studytitle"),
}

_LABEL_TO_FIELD = {
    synonym: field
    for field, synonyms in _FIELD_SYNONYMS.items()
    for synonym in synonyms
}


def _normalize(label: str) -> str:
    return re.sub(r"[^a-z]", "", label.lower())


def match_metadata_field(label: str) -> Optional[str]:
    """Paper field a column label maps to, or None if it isn't metadata-like.

    Matching is exact on the normalized (letters-only, lowercased) label, so
    "Author(s)", "authors", and "Author Names" all match while labels that
    merely contain a keyword ("Authorship bias", "Yearly growth") do not.
    """
    return _LABEL_TO_FIELD.get(_normalize(label))


def metadata_cell_value(paper, field: str) -> Optional[str]:
    """Display value for `field` from the stored paper, or None when absent."""
    if paper is None:
        return None
    if field == "authors":
        return ", ".join(paper.authors) if paper.authors else None
    if field == "year":
        return str(paper.publish_date.year) if paper.publish_date else None
    if field == "publish_date":
        return paper.publish_date.strftime("%Y-%m-%d") if paper.publish_date else None
    if field == "institutions":
        return ", ".join(paper.institutions) if paper.institutions else None
    value = getattr(paper, field, None)
    return str(value) if value else None


def fill_metadata_cells(
    rows: List[DataTableRow],
    metadata_entries: Iterable[dict],
    papers_by_id: Dict[str, object],
) -> None:
    """Write stored metadata into row cells, in place.

    Where the library has a value it wins over whatever extraction returned
    (including for columns that were never sent for extraction); where it has
    none, any extracted cell is left untouched.
    """
    entries = [e for e in metadata_entries if e.get("label") and e.get("field")]
    if not entries:
        return
    for row in rows:
        paper = papers_by_id.get(row.paper_id)
        for entry in entries:
            value = metadata_cell_value(paper, entry["field"])
            if value is not None:
                row.values[entry["label"]] = DataTableCellValue(
                    value=value, citations=[]
                )
