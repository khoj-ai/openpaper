import logging
import uuid
from typing import List

from app.auth.dependencies import get_required_user
from app.database.crud.paper_crud import paper_crud
from app.database.crud.projects.project_paper_crud import (
    ProjectPaperCreate,
    project_paper_crud,
)
from app.database.database import get_db
from app.database.models import Paper, ProjectPaper
from app.database.telemetry import track_event
from app.helpers.s3 import s3_service
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
        papers = project_paper_crud.get_all_papers_by_project_id(
            db, project_id=uuid.UUID(project_id), user=current_user
        )

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
                        "file_url": s3_service.get_cached_presigned_url_by_project(
                            db,
                            str(paper.id),
                            str(paper.s3_object_key),
                            project_id,
                            current_user,
                        ),
                        "is_owner": paper.user_id == current_user.id,
                    }
                    for paper in papers
                ]
            },
        )

    except Exception as e:
        logger.error(f"Error fetching project papers: {e}", exc_info=True)
        return JSONResponse(
            status_code=400,
            content={"message": f"Failed to fetch project papers: {str(e)}"},
        )


class ForkPaperFromProjectRequest(BaseModel):
    source_project_id: str
    paper_id: str


@project_papers_router.post("/fork")
async def fork_paper_from_project(
    request: ForkPaperFromProjectRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
) -> JSONResponse:
    """
    As we can have multiple users working on the same project, sometimes there may be papers in a project a different user wants to fork into their own library. This endpoint allows a user to fork a paper from a specified project into their own library.
    """
    try:
        project_paper: Paper | None = project_paper_crud.get_paper_by_project(
            db,
            paper_id=uuid.UUID(request.paper_id),
            project_id=uuid.UUID(request.source_project_id),
            user=current_user,
        )

        if not project_paper:
            raise HTTPException(
                status_code=404,
                detail="Paper not found in the specified project or user does not have access.",
            )

        duplicate_paper_key, duplicate_file_url = s3_service.duplicate_file(
            source_object_key=str(project_paper.s3_object_key),
            new_filename=f"forked_{uuid.uuid4()}.pdf",
        )

        duplicate_preview_key, duplicate_preview_url = (
            s3_service.duplicate_file_from_url(
                s3_url=str(project_paper.preview_url),
                new_filename=f"forked_preview_{uuid.uuid4()}.png",
            )
        )

        new_paper = paper_crud.fork_paper(
            db,
            parent_paper_id=str(project_paper.id),
            new_file_object_key=duplicate_paper_key,
            new_file_url=duplicate_file_url,
            new_preview_url=duplicate_preview_url,
            current_user=current_user,
        )

        if not new_paper:
            raise HTTPException(
                status_code=500,
                detail="Failed to fork paper.",
            )

        # Create a new paper entry for the user
        new_project_paper = project_paper_crud.create(
            db,
            obj_in=ProjectPaperCreate(paper_id=uuid.UUID(str(new_paper.id))),
            user=current_user,
            project_id=None,  # Not associating with any project initially
        )

        if not new_project_paper:
            raise HTTPException(
                status_code=500,
                detail="Failed to associate forked paper with user's library.",
            )

        track_event(
            "paper_forked_from_project",
            user_id=str(current_user.id),
            properties={
                "source_project_id": request.source_project_id,
                "paper_id": request.paper_id,
            },
        )

        return JSONResponse(
            status_code=201,
            content={
                "message": "Paper forked successfully",
                "new_paper_id": str(new_project_paper.id),
            },
        )

    except Exception as e:
        logger.error(f"Error forking paper from project: {e}")
        return JSONResponse(
            status_code=400,
            content={"message": f"Failed to fork paper from project: {str(e)}"},
        )


@project_papers_router.get("/forked/{parent_paper_id}")
async def get_forked_paper(
    parent_paper_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
) -> JSONResponse:
    """Get the paper forked from a specific parent paper"""
    try:
        paper = project_paper_crud.get_forked_papers_by_parent_id(
            db, parent_paper_id=uuid.UUID(parent_paper_id), user=current_user
        )

        if not paper:
            return JSONResponse(
                status_code=200,
                content={"paper": None},
            )

        return JSONResponse(
            status_code=200,
            content={
                "paper": {
                    "id": str(paper.id),
                    "title": paper.title,
                    "created_at": str(paper.created_at),
                    "abstract": paper.abstract,
                    "authors": paper.authors,
                    "institutions": paper.institutions,
                    "keywords": paper.keywords,
                    "status": paper.status,
                    "file_url": s3_service.get_cached_presigned_url(
                        db,
                        str(paper.id),
                        str(paper.s3_object_key),
                        current_user=current_user,
                    ),
                    "is_owner": paper.user_id == current_user.id,
                }
            },
        )

    except Exception as e:
        logger.error(f"Error fetching forked papers: {e}", exc_info=True)
        return JSONResponse(
            status_code=400,
            content={"message": f"Failed to fetch forked papers: {str(e)}"},
        )


@project_papers_router.get("/from/{paper_id}")
async def get_projects_from_paper_id(
    paper_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
) -> JSONResponse:
    """Get all projects associated with a specific paper"""
    try:
        projects = project_paper_crud.get_projects_by_paper_id(
            db, paper_id=uuid.UUID(paper_id), user=current_user
        )

        return JSONResponse(
            status_code=200,
            content=[project.to_dict() for project in projects],
        )

    except Exception as e:
        logger.error(f"Error fetching projects for paper: {e}", exc_info=True)
        return JSONResponse(
            status_code=400,
            content={"message": f"Failed to fetch projects for paper: {str(e)}"},
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
        removed_project_paper: ProjectPaper = (
            project_paper_crud.remove_by_paper_and_project(
                db,
                paper_id=uuid.UUID(project_paper_id),
                project_id=uuid.UUID(project_id),
                user=current_user,
            )
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
