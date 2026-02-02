"""API routes for the Discover feature."""

import json
import logging

from app.auth.dependencies import get_required_user
from app.database.crud.discover_crud import discover_search_crud
from app.database.database import get_db
from app.database.telemetry import track_event
from app.helpers.discover import run_discover_pipeline
from app.helpers.subscription_limits import can_user_run_discover_search
from app.schemas.discover import DiscoverSearchRequest
from app.schemas.user import CurrentUser
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

discover_router = APIRouter()

END_DELIMITER = "END_OF_STREAM"


@discover_router.post("/search")
async def discover_search(
    request: DiscoverSearchRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
) -> StreamingResponse:
    """Search for research papers by decomposing a question into subqueries."""

    # Check quota
    can_search, error_msg = can_user_run_discover_search(db, current_user)
    if not can_search:
        raise HTTPException(status_code=429, detail=error_msg)

    async def response_generator():
        collected_subqueries: list[str] = []
        collected_results: dict[str, list] = {}

        try:
            async for chunk in run_discover_pipeline(request.question):
                chunk_type = chunk.get("type")

                if chunk_type == "subqueries":
                    collected_subqueries = chunk["content"]
                elif chunk_type == "results":
                    subquery = chunk.get("subquery", "")
                    collected_results[subquery] = chunk.get("content", [])
                elif chunk_type == "done":
                    # Persist the search
                    saved = discover_search_crud.create(
                        db,
                        question=request.question,
                        subqueries=collected_subqueries,
                        results=collected_results,
                        user=current_user,
                    )

                    track_event(
                        "did_discover_search",
                        properties={
                            "question": request.question,
                            "num_subqueries": len(collected_subqueries),
                            "num_results": sum(
                                len(v) for v in collected_results.values()
                            ),
                        },
                        user_id=str(current_user.id),
                    )

                    # Include the search ID in the done chunk
                    chunk["search_id"] = str(saved.id) if saved else None

                yield f"{json.dumps(chunk)}{END_DELIMITER}"

        except Exception as e:
            logger.error(f"Error in discover pipeline: {e}", exc_info=True)
            yield f"{json.dumps({'type': 'error', 'content': str(e)})}{END_DELIMITER}"

    return StreamingResponse(response_generator(), media_type="text/event-stream")


@discover_router.get("/history")
async def discover_history(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """Get the user's past discover searches."""
    searches = discover_search_crud.get_history(db, user=current_user, limit=20)
    return [
        {
            "id": str(s.id),
            "question": s.question,
            "subqueries": s.subqueries,
            "results": s.results,
            "created_at": s.created_at.isoformat() if s.created_at else None,
        }
        for s in searches
    ]


@discover_router.get("/{search_id}")
async def discover_get(
    search_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """Get a single discover search by ID."""
    search = discover_search_crud.get_by_id(db, search_id=search_id, user=current_user)
    if not search:
        raise HTTPException(status_code=404, detail="Search not found")
    return {
        "id": str(search.id),
        "question": search.question,
        "subqueries": search.subqueries,
        "results": search.results,
        "created_at": search.created_at.isoformat() if search.created_at else None,
    }
