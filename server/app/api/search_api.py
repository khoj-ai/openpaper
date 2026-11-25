import logging

from app.auth.dependencies import get_required_user
from app.database.database import get_db
from app.database.models import Annotation, Highlight, Paper
from app.database.queries.search import search_knowledge_base
from app.database.telemetry import track_event
from app.schemas.user import CurrentUser
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
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
