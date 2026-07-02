import logging

from app.auth.dependencies import get_required_user
from app.database.database import get_db
from app.database.models import Annotation, Highlight, Paper, Project, ProjectRole
from app.database.queries.search import search_knowledge_base
from app.database.telemetry import track_event
from app.schemas.scope import MentionItem, MentionResult, ScopeType
from app.schemas.user import CurrentUser
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy import or_, func
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# API router for knowledge base search functionality
search_router = APIRouter()


@search_router.get("/")
async def search_knowledge_base_endpoint(
    q: str = Query(..., description="Search query string"),
    limit: int = Query(
        50, ge=1, le=100, description="Maximum number of papers to return"
    ),
    offset: int = Query(0, ge=0, description="Number of papers to skip for pagination"),
    papers_filter: str = Query(
        None,
        description="Comma-separated list of paper IDs to filter results by specific papers",
    ),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """
    Search across papers, annotations, and highlights in the user's knowledge base.

    Returns a hierarchical view with matching content organized under paper metadata.
    The search looks through:
    - Paper titles, abstracts, and raw content
    - Highlight text
    - Annotation content

    Results are organized by paper, with matching highlights and annotations
    sub-referenced under each paper's metadata.
    """
    try:
        # Validate search query
        if not q or len(q.strip()) < 2:
            raise HTTPException(
                status_code=400,
                detail="Search query must be at least 2 characters long",
            )

        kb_papers_filter = papers_filter.split(",") if papers_filter else None

        # Perform the search
        results = search_knowledge_base(
            db=db,
            user=current_user,
            query=q.strip(),
            limit=limit,
            offset=offset,
            papers_filter=kb_papers_filter,
        )

        # Track the search event for analytics
        track_event(
            "knowledge_base_search",
            user_id=current_user.id,
            properties={
                "query": q.strip(),
                "total_papers": results.total_papers,
                "total_highlights": results.total_highlights,
                "total_annotations": results.total_annotations,
                "limit": limit,
                "offset": offset,
            },
            db=db,
        )

        return JSONResponse(status_code=200, content=results.model_dump(mode="json"))

    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        logger.error(f"Error searching knowledge base: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="An error occurred while searching your knowledge base",
        )


@search_router.get("/stats")
async def get_search_stats(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """
    Get statistics about the user's knowledge base for search context.

    Returns counts of papers, highlights, and annotations.
    """
    try:

        # Count total items in user's knowledge base
        total_papers = db.query(Paper).filter(Paper.user_id == current_user.id).count()
        total_highlights = (
            db.query(Highlight).filter(Highlight.user_id == current_user.id).count()
        )
        total_annotations = (
            db.query(Annotation).filter(Annotation.user_id == current_user.id).count()
        )

        return JSONResponse(
            status_code=200,
            content={
                "total_papers": total_papers,
                "total_highlights": total_highlights,
                "total_annotations": total_annotations,
                "searchable_items": total_papers + total_highlights + total_annotations,
            },
        )

    except Exception as e:
        logger.error(f"Error getting search stats: {e}", exc_info=True)
        raise HTTPException(
            status_code=500, detail="An error occurred while getting search statistics"
        )


@search_router.get("/mentions")
async def search_mentions(
    q: str = Query(..., description="Search query for @-mention autocomplete"),
    limit: int = Query(
        5, ge=1, le=20, description="Max results per section"
    ),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """
    Search for papers, projects, highlights, and comments to power the
    @-mention autocomplete in the Ask input.
    Results are grouped by type for rendering in the dropdown.
    """
    try:
        if not q or len(q.strip()) < 1:
            return JSONResponse(
                status_code=200,
                content=MentionResult().model_dump(),
            )

        search_pattern = f"%{q.lower()}%"

        # Search papers by title
        paper_query = (
            db.query(Paper)
            .filter(
                Paper.user_id == current_user.id,
                func.lower(Paper.title).like(search_pattern),
            )
            .order_by(Paper.last_accessed_at.desc())
            .limit(limit)
            .all()
        )

        papers = [
            MentionItem(
                type=ScopeType.PAPER,
                id=str(p.id),
                label=p.title or "Untitled Paper",
                subtitle=", ".join(p.authors[:2]) + (" et al." if len(p.authors) > 2 else "") if p.authors else None,
            )
            for p in paper_query
            if p.title
        ]

        # Search projects by title
        # Direct query on Project model since projects are visible via ProjectRole
        project_query = (
            db.query(Project)
            .filter(
                func.lower(Project.title).like(search_pattern),
                Project.id.in_(
                    db.query(ProjectRole.project_id).filter(
                        ProjectRole.user_id == current_user.id,
                    )
                ),
            )
            .order_by(Project.title)
            .limit(limit)
            .all()
        )

        projects = [
            MentionItem(
                type=ScopeType.PROJECT,
                id=str(p.id),
                label=p.title or "Untitled Project",
                subtitle=p.description,
            )
            for p in project_query
            if p.title
        ]

        # Deferred: highlights and comments support
        # TODO: Add highlight search by raw_text
        # TODO: Add comment (annotation) search by content

        result = MentionResult(
            papers=papers,
            projects=projects,
        )

        return JSONResponse(
            status_code=200,
            content=result.model_dump(),
        )

    except Exception as e:
        logger.error(f"Error searching mentions: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="An error occurred while searching for mentions",
        )
