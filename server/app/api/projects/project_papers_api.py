import logging
import uuid
from typing import List

from app.auth.dependencies import get_required_user
from app.database.crud.projects.project_crud import project_crud
from app.database.crud.projects.project_paper_crud import (
    ProjectPaperCreate,
    project_paper_crud,
)
from app.database.database import get_db
from app.database.models import Paper, ProjectPaper
from app.database.telemetry import track_event
from app.schemas.user import CurrentUser
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# Create API router
project_papers_router = APIRouter()


class AddPaperToProjectRequest(BaseModel):
    paper_ids: List[str]


@project_papers_router.post("/{project_id}")
async def add_paper_to_project(
    project_id: str,
    request: AddPaperToProjectRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
) -> JSONResponse:
    """Add a paper to a project"""
    try:
        for paper_id in request.paper_ids:
            project_paper = project_paper_crud.create(
                db,
                obj_in=ProjectPaperCreate(paper_id=uuid.UUID(paper_id)),
                user=current_user,
                project_id=uuid.UUID(project_id),
            )
            if not project_paper:
                logger.error(
                    f"Failed to add paper {paper_id} to project {project_id}. Check permissions or if the paper already exists in the project."
                )

        track_event(
            "papers_added_to_project",
            user_id=str(current_user.id),
            properties={"project_id": project_id, "n_papers": len(request.paper_ids)},
        )

        return JSONResponse(
            status_code=201,
            content={"message": "Papers added to project successfully"},
        )

    except Exception as e:
        logger.error(f"Error adding paper to project: {e}")
        return JSONResponse(
            status_code=400,
            content={"message": f"Failed to add paper to project: {str(e)}"},
        )


@project_papers_router.get("/{project_id}")
async def get_project_papers(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
) -> JSONResponse:
    """Get all papers for a specific project"""
    try:
        project_papers = project_paper_crud.get_by_project_id(
            db, project_id=uuid.UUID(project_id), user=current_user
        )

        paper_ids = [pp.paper_id for pp in project_papers]
        papers = db.query(Paper).filter(Paper.id.in_(paper_ids)).all()

        return JSONResponse(
            status_code=200,
            content={
                "papers": [
                    {
                        "id": str(paper.id),
                        "title": paper.title,
                        "created_at": str(paper.created_at),
                        "abstract": paper.abstract,
                        "authors": paper.authors,
                        "institutions": paper.institutions,
                        "keywords": paper.keywords,
                        "status": paper.status,
                    }
                    for paper in papers
                ]
            },
        )

    except Exception as e:
        logger.error(f"Error fetching project papers: {e}")
        return JSONResponse(
            status_code=400,
            content={"message": f"Failed to fetch project papers: {str(e)}"},
        )


@project_papers_router.delete("/{project_id}/{project_paper_id}")
async def remove_paper_from_project(
    project_id: str,
    project_paper_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
) -> JSONResponse:
    """Remove a paper from a project"""
    try:
        # The id passed here is the id of the ProjectPaper association
        removed_project_paper: ProjectPaper = project_paper_crud.remove(
            db, id=uuid.UUID(project_paper_id), user=current_user
        )

        if not removed_project_paper:
            raise HTTPException(
                status_code=404,
                detail="Project paper association not found or user does not have permission to delete.",
            )

        track_event("paper_removed_from_project", user_id=str(current_user.id))

        return JSONResponse(
            status_code=200,
            content={"message": "Paper removed from project successfully"},
        )
    except Exception as e:
        logger.error(f"Error removing paper from project: {e}")
        return JSONResponse(
            status_code=400,
            content={"message": f"Failed to remove paper from project: {str(e)}"},
        )
