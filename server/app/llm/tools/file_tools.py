import re
import uuid
from logging import getLogger
from time import time
from typing import Dict, List, Optional

from app.database.crud.paper_crud import paper_crud
from app.database.crud.projects.project_paper_crud import project_paper_crud
from app.database.models import Paper
from app.schemas.user import CurrentUser
from sqlalchemy.orm import Session

logger = getLogger(__name__)

# --------------------------------------------------------------
# Function declarations for LLM tools related to file operations
# --------------------------------------------------------------

# NOTE: REMEMBER TO UPDATE THE EVIDENCE GATHERING SYSTEM PROMPT WHEN ADDING OR CHANGING FUNCTIONALITY FOR ANY OF THESE TOOLS

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
                "description": "The search query to find in the file content of all papers. Use the '|' (pipe) character to separate alternative search terms (OR logic). Each term separated by '|' can be a single word OR a multi-word phrase that will be searched exactly as written. Examples: 'machine learning|neural network|deep learning' searches for any of these three phrases. 'quantum computing|qubit' searches for either the phrase 'quantum computing' or the word 'qubit'. Multi-word phrases preserve spaces and are matched as complete phrases. Hyphens are automatically converted to spaces, so use spaces in multi-word terms (e.g., 'red team' not 'red-team').",
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
    start_time = time()

    paper_ids: Optional[List[uuid.UUID]] = None
    if project_id:
        paper_ids = project_paper_crud.get_project_paper_ids_by_project_id(
            db, project_id=uuid.UUID(project_id), user=current_user
        )
        if not paper_ids:
            return {}

    matching_lines_tuples = paper_crud.search_papers_and_get_matching_lines(
        db, user=current_user, query=query, paper_ids=paper_ids
    )

    end_time = time()
    elapsed_time = end_time - start_time
    logger.info(
        f"Database search for matching lines completed in {elapsed_time:.2f} seconds"
    )

    results: Dict[str, list[str]] = {}

    for paper_id, line_num, line in matching_lines_tuples:
        if paper_id not in results:
            results[paper_id] = []

        results[paper_id].append(f"{line_num}: {line}")

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
