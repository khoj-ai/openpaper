import re
from typing import Dict

from app.database.crud.paper_crud import paper_crud
from app.database.models import Paper
from app.schemas.user import CurrentUser
from sqlalchemy.orm import Session

# --------------------------------------------------------------
# Function declarations for LLM tools related to file operations
# --------------------------------------------------------------

read_file_function = {
    "name": "read_file",
    "description": "Read the complete content of a file associated with a paper.",
    "parameters": {
        "type": "object",
        "properties": {
            "paper_id": {
                "type": "string",
                "description": "The ID of the paper whose file content to read.",
            },
        },
        "required": ["paper_id"],
    },
}

search_file_function = {
    "name": "search_file",
    "description": "Search for a specific query (as regex) in the file content of a paper. Returns matching lines with line numbers.",
    "parameters": {
        "type": "object",
        "properties": {
            "paper_id": {
                "type": "string",
                "description": "The ID of the paper to search in.",
            },
            "query": {
                "type": "string",
                "description": "The regex pattern to search for in the file content.",
            },
        },
        "required": ["paper_id", "query"],
    },
}

view_file_function = {
    "name": "view_file",
    "description": "View a specific range of lines from the file content of a paper.",
    "parameters": {
        "type": "object",
        "properties": {
            "paper_id": {
                "type": "string",
                "description": "The ID of the paper whose file content to view.",
            },
            "range_start": {
                "type": "integer",
                "description": "The starting line number (0-based index).",
            },
            "range_end": {
                "type": "integer",
                "description": "The ending line number (exclusive, 0-based index).",
            },
        },
        "required": ["paper_id", "range_start", "range_end"],
    },
}

read_abstract_function = {
    "name": "read_abstract",
    "description": "Read the abstract of a paper.",
    "parameters": {
        "type": "object",
        "properties": {
            "paper_id": {
                "type": "string",
                "description": "The ID of the paper whose abstract to read.",
            },
        },
        "required": ["paper_id"],
    },
}

search_all_files_function = {
    "name": "search_all_files",
    "description": "Search for a specific query (as regex) in the file content of all papers. Returns a list of matching lines with paper IDs and line numbers.",
    "parameters": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "The regex pattern to search for in the file content of all papers.",
            },
        },
        "required": ["query"],
    },
}


def read_file(paper_id: str, current_user: CurrentUser, db: Session) -> str:
    """
    Read the content of a file associated with a paper.
    """
    paper: Paper = paper_crud.get(db, id=paper_id, user=current_user)

    if not paper:
        raise ValueError("Paper not found or access denied")

    file_content = paper.raw_content
    if not file_content:
        raise ValueError("File content not found")

    return str(file_content)


def search_file(
    paper_id: str, query: str, current_user: CurrentUser, db: Session
) -> list[str]:
    """
    Search for a specific query (as regex) in the file content of a paper.
    Returns matching lines with line numbers.
    """
    paper: Paper = paper_crud.get(db, id=paper_id, user=current_user)

    if not paper:
        raise ValueError("Paper not found or access denied")

    file_content = paper.raw_content
    if not file_content:
        raise ValueError("File content not found")

    # Regex search implementation with line numbers
    lines = file_content.splitlines()
    results = []

    try:
        pattern = re.compile(query, re.IGNORECASE)
        for line_num, line in enumerate(lines, 1):
            if pattern.search(line):
                results.append(f"{line_num}: {line}")
    except re.error as e:
        raise ValueError(f"Invalid regex pattern: {e}")

    return results


def search_all_files(
    query: str, current_user: CurrentUser, db: Session
) -> Dict[str, list[str]]:
    """
    Search for a specific query (as regex) in the file content of all papers.
    Returns a list of matching lines with paper IDs and line numbers.
    """
    all_papers = paper_crud.get_all_available_papers(db, user=current_user)
    results = {}

    for paper in all_papers:
        paper_id = str(paper.id)
        if not paper_id or not paper.raw_content:
            continue
        matching_lines = search_file(paper_id, query, current_user, db)
        for line in matching_lines:
            if paper_id not in results:
                results[paper_id] = []
            results[paper_id].append(line)

    return results


def view_file(
    paper_id: str,
    range_start: int,
    range_end: int,
    current_user: CurrentUser,
    db: Session,
) -> str:
    """
    View a specific range of lines from the file content of a paper.
    """
    paper: Paper = paper_crud.get(db, id=paper_id, user=current_user)

    if not paper:
        raise ValueError("Paper not found or access denied")

    file_content = paper.raw_content
    if not file_content:
        raise ValueError("File content not found")

    lines = file_content.splitlines()
    if range_start < 0 or range_end > len(lines) or range_start >= range_end:
        raise ValueError("Invalid range specified")

    all_lines = lines[range_start:range_end]
    total_chunk = "\n".join(all_lines)
    total_chunk = (
        f"File content from lines {range_start + 1} to {range_end}:\n\n{total_chunk}"
    )

    return total_chunk


def read_abstract(paper_id: str, current_user: CurrentUser, db: Session) -> str:
    """
    Read the abstract of a paper.
    """
    paper: Paper = paper_crud.get(db, id=paper_id, user=current_user)

    if not paper:
        raise ValueError("Paper not found or access denied")

    abstract = paper.abstract
    if not abstract:
        raise ValueError("Abstract not found")

    return (
        f"Abstract:\n\n{abstract.strip()}\n\n" if abstract else "No abstract available."
    )
