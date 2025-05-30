import logging
import uuid
from typing import Optional, cast

from app.auth.dependencies import get_current_user, get_db, get_required_user
from app.database.crud.hypothesis_crud import hypothesis_crud
from app.database.models import JobStatus
from app.database.telemetry import track_event
from app.helpers.paper_search import search_open_alex
from app.schemas.user import CurrentUser
from app.tasks.hypothesis import process_hypothesis
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# API routes for effectively searching and retrieving papers from external sources

paper_search_router = APIRouter()


@paper_search_router.get("/search")
async def search_papers(
    query: str,
    page: int = 1,
    db: Session = Depends(get_db),
    current_user: Optional[CurrentUser] = Depends(get_current_user),
):
    """
    Search for papers based on the provided query.
    """
    try:
        # Perform the search operation
        results = search_open_alex(query, page=page)
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


@paper_search_router.post("/hypothesize")
async def start_hypothesis_research(
    question: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """
    Start hypothesis research as a background job.
    Returns immediately with a job ID that can be used to track progress.
    """
    try:
        # Create the job record
        job = hypothesis_crud.create_job(
            db=db, user_id=current_user.id, question=question
        )

        job_id = cast(uuid.UUID, job.id)

        # Start background processing (don't await)
        background_tasks.add_task(process_hypothesis, job_id, current_user.id)

        return {
            "job_id": str(job.id),
            "status": job.status,
            "message": "Hypothesis research started. Use the job_id to check progress.",
        }

    except Exception as e:
        logger.error(f"Error starting hypothesis research: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@paper_search_router.get("/hypothesize/{job_id}")
async def get_hypothesis_job_status(
    job_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """
    Get the status and results of a hypothesis research job.
    """
    try:
        job = hypothesis_crud.get_job_by_id(
            db=db, job_id=job_id, user_id=current_user.id
        )
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")

        # Build response with progress and results
        response = {
            "job_id": str(job.id),
            "status": job.status,
            "original_question": job.original_question,
            "generated_hypothesis": job.generated_hypothesis,
            "progress": {
                "total_steps": job.total_steps,
                "completed_steps": job.completed_steps,
                "percentage": (
                    (job.completed_steps / job.total_steps * 100)
                    if job.total_steps
                    else 0
                ),
            },
            "started_at": job.started_at,
            "completed_at": job.completed_at,
            "total_time": (
                job.completed_at - job.started_at
                if job.completed_at and job.started_at
                else None
            ),
        }

        if job.status == JobStatus.FAILED:
            response["error"] = job.error_message

        else:
            # If job is in progress or completed, include steps and findings
            response["steps"] = [
                {
                    "question": step.question,
                    "motivation": step.motivation,
                    "findings": step.findings,
                    "papers_count": len(step.papers),
                    "papers": [
                        {
                            "title": paper.title,
                            "abstract": paper.abstract,
                            "was_scraped": paper.scraping_successful,
                            "has_summary": bool(paper.contextual_summary),
                            "reference_idx": paper.reference_idx,
                        }
                        for paper in step.papers
                    ],
                }
                for step in job.steps  # type: ignore
            ]

        # If job is completed, include research results from the separate table
        if job.status == JobStatus.COMPLETED and job.research_result:
            response["research_result"] = {
                "motivation": job.research_result[0].motivation,  # type: ignore
                "methodology": job.research_result[0].methodology,  # type: ignore
                "findings": job.research_result[0].findings,  # type: ignore
                "limitations": job.research_result[0].limitations,  # type: ignore
                "future_research": job.research_result[0].future_research,  # type: ignore
            }

        return response

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting job status: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
