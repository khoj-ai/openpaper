import logging
from typing import Optional, cast

from app.auth.dependencies import get_current_user, get_required_user
from app.database.crud.paper_crud import PaperUpdate, paper_crud
from app.database.database import get_db
from app.database.telemetry import track_event
from app.helpers.paper_search import (
    OpenAlexFilter,
    construct_citation_graph,
    search_open_alex,
)
from app.schemas.user import CurrentUser
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# API routes for effectively searching and retrieving papers from external sources

paper_search_router = APIRouter()


@paper_search_router.post("/search")
async def search_papers(
    query: str,
    page: int = 1,
    # Accept filter in the body for more complex queries
    filter: Optional[OpenAlexFilter] = None,
    db: Session = Depends(get_db),
    current_user: Optional[CurrentUser] = Depends(get_current_user),
):
    """
    Search for papers based on the provided query.
    """
    try:
        # Perform the search operation
        results = search_open_alex(query, filter=filter, page=page)
        track_event(
            "paper_search",
            user_id=current_user.id if current_user else None,
            properties={
                "query": query,
                "page": page,
                "results_count": len(results.results),
            },
        )
        return Response(
            content=results.model_dump_json(), media_type="application/json"
        )
    except Exception as e:
        logger.error(f"Error searching papers: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@paper_search_router.post("/match")
async def get_paper_graph(
    open_alex_id: str,
    paper_id: str,
    doi: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """
    Get the citation graph for a paper.
    """
    try:
        paper = paper_crud.get(id=paper_id, db=db, user=current_user)
        if not paper:
            raise HTTPException(status_code=404, detail="Paper not found")

        # Update the paper with OpenAlex ID and DOI if provided
        update_data = PaperUpdate(open_alex_id=open_alex_id, doi=doi)
        paper_crud.update(db=db, db_obj=paper, obj_in=update_data)
        graph = construct_citation_graph(open_alex_id)
        return Response(content=graph.model_dump_json(), media_type="application/json")
    except Exception as e:
        logger.error(f"Error retrieving paper graph: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
