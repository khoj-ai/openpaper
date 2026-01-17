import logging
from typing import Optional, cast
from enum import Enum

from app.auth.dependencies import get_current_user, get_required_user
from app.database.crud.paper_crud import PaperUpdate, paper_crud
from app.database.database import get_db
from app.database.telemetry import track_event
from app.helpers.paper_search import (
    OpenAlexFilter,
    construct_citation_graph,
    get_doi,
    get_work_by_doi,
    search_open_alex,
    PaperSort,
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
    sort: Optional[PaperSort] = None,
    db: Session = Depends(get_db),
    current_user: Optional[CurrentUser] = Depends(get_current_user),
):
    """
    Search for papers based on the provided query.
    """
    try:
        # Perform the search operation
        results = search_open_alex(query, filter=filter, page=page, sort=sort.value if sort else None)
        track_event(
            "paper_search",
            user_id=current_user.id if current_user else None,
            properties={
                "query": query,
                "page": page,
                "sort": sort.value if sort else None,
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
    doi: Optional[str] = None,
    paper_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """
    Get the citation graph for a paper.

    Either doi or paper_id must be provided. If paper_id is provided,
    the paper's DOI will be used to look up the OpenAlex ID.
    """
    try:
        if not doi and not paper_id:
            raise HTTPException(
                status_code=400,
                detail="Either doi or paper_id must be provided",
            )

        paper = None
        if paper_id:
            paper = paper_crud.get(id=paper_id, db=db, user=current_user)
            if not paper:
                raise HTTPException(status_code=404, detail="Paper not found")
            # Use paper's DOI if no DOI provided, or try to look it up
            if not doi:
                if paper.doi:
                    doi = str(paper.doi)
                else:
                    # Try to find DOI using paper title
                    doi = get_doi(str(paper.title))
                    if not doi:
                        raise HTTPException(
                            status_code=400,
                            detail="Paper does not have a DOI and could not find one. Please provide a DOI.",
                        )

        if not doi:
            raise HTTPException(
                status_code=400,
                detail="DOI could not be determined for the paper",
            )

        # Look up OpenAlex work from DOI
        work = get_work_by_doi(doi)
        if not work:
            raise HTTPException(
                status_code=404,
                detail=f"Could not find paper with DOI: {doi}",
            )

        # Update the paper's DOI if we have a paper and DOI was provided directly
        if paper and doi and paper.doi != doi:
            update_data = PaperUpdate(doi=doi)
            paper_crud.update(db=db, db_obj=paper, obj_in=update_data)

        graph = construct_citation_graph(work.id)
        track_event(
            "citation_graph_view",
            user_id=current_user.id,
            properties={
                "cited_by_count": graph.cited_by.meta.get("count", 0),
                "cites_count": graph.cites.meta.get("count", 0),
            },
        )
        return Response(content=graph.model_dump_json(), media_type="application/json")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving paper graph: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@paper_search_router.get("/author")
async def get_author_works(
    author_id: str,
    page: int = 1,
    current_user: CurrentUser = Depends(get_required_user),
):
    """
    Get works by a specific author from OpenAlex.

    Args:
        author_id: The OpenAlex author ID (e.g., "A5023888391" or full URL).
        page: Page number for pagination.
    """
    try:
        author_filter = OpenAlexFilter(authors=[author_id])
        results = search_open_alex(search_term=None, filter=author_filter, page=page)
        track_event(
            "author_works_view",
            user_id=current_user.id,
            properties={
                "page": page,
                "results_count": len(results.results),
                "total_count": results.meta.get("count", 0),
            },
        )
        return Response(
            content=results.model_dump_json(), media_type="application/json"
        )
    except Exception as e:
        logger.error(f"Error retrieving author works: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
