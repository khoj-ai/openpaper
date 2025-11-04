import re
import uuid
from typing import Dict, List, Optional

from app.database.crud.paper_crud import paper_crud
from app.database.crud.projects.project_paper_crud import project_paper_crud
from app.database.models import Paper
from app.schemas.user import CurrentUser
from sqlalchemy.orm import Session

# --------------------------------------------------------------
# Function declarations for LLM tools related to file operations
# --------------------------------------------------------------

read_file_function = {
    "name": "read_file",
    "description": "Use this tool when you need to read the entire content of a single paper. It's best for when you need a complete overview of the paper's text. If you're looking for specific information, consider using 'search_file' first.",
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
    "description": "Use this tool to find specific information within a single paper. You will use a regular expression for powerful searches. It returns the lines that match your query, along with their line numbers. This is useful for pinpointing exact details without reading the whole paper. Think carefully about how to dynamically search for the correct terms based on the user's question.",
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
    "description": "Use this tool when you want to look at a specific part of a paper. You must specify a range of lines to view. This is helpful when you already have an idea of where the information is, for example, after using 'search_file' and getting a line number. It helps you see the context around a specific line or section. Use this to get a focused view of the content without being overwhelmed by the entire paper, especially to collect more details.",
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
    "description": "Use this tool to get a quick summary of a paper. The abstract provides a concise overview of the paper's main points. It's a great starting point to understand what the paper is about before diving into the full text.",
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
    "description": "Search for a specific query across all available papers using full-text search. This is useful for broad, exploratory searches when you're not sure which paper contains the information you need. It returns a list of matching lines with their corresponding paper IDs and line numbers. Think carefully about how to dynamically search for the correct terms based on the user's question. If you already know which paper to search in, `search_file` is a more targeted and efficient option.",
    "parameters": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "The search query to find in the file content of all papers. This can include keywords and phrases. The search is powered by full-text search, so you can use operators like '&' (AND) and '|' (OR). For example, 'apple & pie' will find papers containing both 'apple' and 'pie'. Avoid using hyphens in search terms as they can cause errors; use spaces instead (e.g., 'red team' instead of 'red-team'). The tool will then highlight the lines containing these keywords.",
            },
        },
        "required": ["query"],
    },
}


def read_file(
    paper_id: str,
    current_user: CurrentUser,
    db: Session,
    project_id: Optional[str] = None,
) -> str:
    """
    Read the content of a file associated with a paper.
    """
    paper: Optional[Paper] = None
    if project_id:
        paper = project_paper_crud.get_paper_by_project(
            db,
            paper_id=uuid.UUID(paper_id),
            project_id=uuid.UUID(project_id),
            user=current_user,
        )
    else:
        paper = paper_crud.get(db, id=paper_id, user=current_user)

    if not paper:
        raise ValueError("Paper not found or access denied")

    file_content = paper.raw_content
    if not file_content:
        raise ValueError("File content not found")

    return str(file_content)


def search_file(
    paper_id: str,
    query: str,
    current_user: CurrentUser,
    db: Session,
    project_id: Optional[str] = None,
) -> list[str]:
    """
    Search for a specific query (as regex) in the file content of a paper.
    Returns matching lines with line numbers.
    """
    paper: Optional[Paper] = None
    if project_id:
        paper = project_paper_crud.get_paper_by_project(
            db,
            paper_id=uuid.UUID(paper_id),
            project_id=uuid.UUID(project_id),
            user=current_user,
        )
    else:
        paper = paper_crud.get(db, id=paper_id, user=current_user)

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
    query: str,
    current_user: CurrentUser,
    db: Session,
    project_id: Optional[str] = None,
) -> Dict[str, list[str]]:
    """
    Search for a specific query in the file content of all papers using full-text search.
    Returns a list of matching lines with paper IDs and line numbers.
    """
    # Sanitize the query for to_tsquery by replacing hyphens with spaces,
    # as hyphens can cause syntax errors in this context.
    sanitized_query = query.replace("-", " ")

    all_papers: List[Paper] = []
    if project_id:
        all_papers = project_paper_crud.get_all_papers_by_project_id(
            db, project_id=uuid.UUID(project_id), user=current_user
        )
    else:
        all_papers = paper_crud.get_all_available_papers(
            db, user=current_user, query=sanitized_query
        )
    results = {}

    # Extract search terms from the query, stripping FTS operators
    search_terms = [term for term in re.split(r"[\s&|!()]", sanitized_query) if term]
    if not search_terms:
        return {}

    for paper in all_papers:
        paper_id = str(paper.id)
        if not paper_id or not paper.raw_content:
            continue

        lines = paper.raw_content.splitlines()
        matching_lines = []
        for line_num, line in enumerate(lines, 1):
            # Search for any of the terms in the line, case-insensitively
            if any(term.lower() in line.lower() for term in search_terms):
                matching_lines.append(f"{line_num}: {line}")

        if matching_lines:
            results[paper_id] = matching_lines

    return results


def view_file(
    paper_id: str,
    range_start: int,
    range_end: int,
    current_user: CurrentUser,
    db: Session,
    project_id: Optional[str] = None,
) -> str:
    """
    View a specific range of lines from the file content of a paper.
    """
    paper: Optional[Paper] = None
    if project_id:
        paper = project_paper_crud.get_paper_by_project(
            db,
            paper_id=uuid.UUID(paper_id),
            project_id=uuid.UUID(project_id),
            user=current_user,
        )
    else:
        paper = paper_crud.get(db, id=paper_id, user=current_user)

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


def read_abstract(
    paper_id: str,
    current_user: CurrentUser,
    db: Session,
    project_id: Optional[str] = None,
) -> str:
    """
    Read the abstract of a paper.
    """
    paper: Optional[Paper] = None
    if project_id:
        paper = project_paper_crud.get_paper_by_project(
            db,
            paper_id=uuid.UUID(paper_id),
            project_id=uuid.UUID(project_id),
            user=current_user,
        )
    else:
        paper = paper_crud.get(db, id=paper_id, user=current_user)

    if not paper:
        raise ValueError("Paper not found or access denied")

    abstract = paper.abstract
    if not abstract:
        return f"Abstract for {paper.title} not found"

    return f"Abstract:\n\n{abstract.strip()}\n\n"
