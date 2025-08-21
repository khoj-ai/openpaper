import logging
import uuid

from app.auth.dependencies import get_required_user
from app.database.crud.projects.project_crud import (
    ProjectCreate,
    ProjectUpdate,
    project_crud,
)
from app.database.database import get_db
from app.database.telemetry import track_event
from app.schemas.user import CurrentUser
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

projects_router = APIRouter()


class CreateProjectRequest(BaseModel):
    title: str
    description: str | None = None


class UpdateProjectRequest(BaseModel):
    title: str | None = None
    description: str | None = None


@projects_router.post("")
async def create_project(
    request: CreateProjectRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
) -> JSONResponse:
    """Create a new project"""
    try:
        project = project_crud.create(
            db,
            obj_in=ProjectCreate(
                title=request.title,
                description=request.description,
            ),
            user=current_user,
        )

        if not project:
            raise ValueError("Failed to create project, please check the input data.")

        track_event("project_created", user_id=str(current_user.id))

        return JSONResponse(
            status_code=201,
            content=project.to_dict(),
        )
    except Exception as e:
        logger.error(f"Error creating project: {e}")
        return JSONResponse(
            status_code=400,
            content={"message": f"Failed to create project: {str(e)}"},
        )


@projects_router.get("")
async def get_projects(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
) -> JSONResponse:
    """Get all projects for the current user"""
    try:
        projects = project_crud.get_multi_by_user(db, user=current_user)
        return JSONResponse(
            status_code=200,
            content=[project.to_dict() for project in projects],
        )
    except Exception as e:
        logger.error(f"Error fetching projects: {e}")
        return JSONResponse(
            status_code=400,
            content={"message": f"Failed to fetch projects: {str(e)}"},
        )


@projects_router.get("/{project_id}")
async def get_project(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
) -> JSONResponse:
    """Get a single project by ID"""
    try:
        project = project_crud.get(db, id=uuid.UUID(project_id), user=current_user)
        if not project:
            return JSONResponse(
                status_code=404,
                content={"message": f"Project with ID {project_id} not found."},
            )
        return JSONResponse(
            status_code=200,
            content=project.to_dict(),
        )
    except Exception as e:
        logger.error(f"Error fetching project: {e}")
        return JSONResponse(
            status_code=400,
            content={"message": f"Failed to fetch project: {str(e)}"},
        )


@projects_router.patch("/{project_id}")
async def update_project(
    project_id: str,
    request: UpdateProjectRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
) -> JSONResponse:
    """Update an existing project"""
    try:
        project = project_crud.update(
            db,
            id=uuid.UUID(project_id),
            obj_in=ProjectUpdate(**request.model_dump(exclude_unset=True)),
            user=current_user,
        )

        if not project:
            return JSONResponse(
                status_code=404,
                content={
                    "message": f"Project with ID {project_id} not found or user does not have permission to update."
                },
            )

        track_event("project_updated", user_id=str(current_user.id))

        return JSONResponse(status_code=200, content=project.to_dict())
    except Exception as e:
        logger.error(f"Error updating project: {e}")
        return JSONResponse(
            status_code=400,
            content={"message": f"Failed to update project: {str(e)}"},
        )


@projects_router.delete("/{project_id}")
async def delete_project(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
) -> JSONResponse:
    """Delete a specific project"""
    try:
        project = project_crud.remove(db, id=uuid.UUID(project_id), user=current_user)

        if not project:
            return JSONResponse(
                status_code=404,
                content={
                    "message": f"Project with ID {project_id} not found or user does not have permission to delete."
                },
            )

        track_event("project_deleted", user_id=str(current_user.id))

        return JSONResponse(
            status_code=200,
            content={"message": "Project deleted successfully"},
        )
    except Exception as e:
        logger.error(f"Error deleting project: {e}")
        return JSONResponse(
            status_code=400,
            content={"message": f"Failed to delete project: {str(e)}"},
        )
