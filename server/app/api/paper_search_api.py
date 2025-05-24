import logging

from app.auth.dependencies import get_db, get_required_user
from app.helpers.paper_search import search_open_alex
from app.schemas.user import CurrentUser
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# API routes for effectively searching and retrieving papers from external sources

paper_search_router = APIRouter()


@paper_search_router.get("/search")
async def search_papers(
    query: str,
    page: int = 1,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """
    Search for papers based on the provided query.
    """
    try:
        # Perform the search operation
        results = search_open_alex(query, page=page)
        return Response(
            content=results.model_dump_json(), media_type="application/json"
        )
    except Exception as e:
        logger.error(f"Error searching papers: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
