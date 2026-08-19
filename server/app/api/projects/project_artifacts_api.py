import logging
import uuid

from app.auth.dependencies import get_required_user
from app.database.crud.artifact_crud import artifact_crud, artifact_response
from app.database.crud.projects.project_crud import project_crud
from app.database.database import get_db
from app.schemas.user import CurrentUser
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

project_artifacts_router = APIRouter()


@project_artifacts_router.get("/{project_id}/{artifact_id}")
async def get_project_chart_artifact(
    request: Request,
    project_id: str,
    artifact_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """Return one chart artifact for the project's full-detail view."""
    try:
        project_uuid = uuid.UUID(project_id)
        artifact_uuid = uuid.UUID(artifact_id)
    except ValueError:
        return JSONResponse(status_code=404, content={"message": "Chart not found"})

    role = project_crud.get_role_in_project(
        db, project_id=project_id, user=current_user
    )
    if role is None:
        return JSONResponse(status_code=404, content={"message": "Project not found"})

    artifact = artifact_crud.get_chart_for_project(
        db, artifact_id=artifact_uuid, project_id=project_uuid
    )
    if not artifact:
        return JSONResponse(status_code=404, content={"message": "Chart not found"})

    return JSONResponse(
        status_code=200,
        content={
            "id": str(artifact.id),
            "payload": artifact.to_payload(),
            "created_at": (
                artifact.created_at.isoformat() if artifact.created_at else None
            ),
            "updated_at": (
                artifact.updated_at.isoformat() if artifact.updated_at else None
            ),
        },
    )


@project_artifacts_router.get("/{project_id}")
async def get_project_artifacts(
    request: Request,
    project_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """
    Get chat-generated artifacts for a project.

    Project conversations are visible to every member, so their artifacts are
    too: any role in the project (admin/editor/viewer) grants read access.
    """
    role = project_crud.get_role_in_project(
        db, project_id=project_id, user=current_user
    )
    if role is None:
        return JSONResponse(status_code=404, content={"message": "Project not found"})

    rows = artifact_crud.list_for_project(
        db,
        project_id=uuid.UUID(project_id),
    )

    artifacts = [
        artifact_response(
            artifact,
            conversation_id=conversation_id,
            conversation_title=conversation_title,
        )
        for artifact, conversation_id, conversation_title in rows
    ]

    return JSONResponse(status_code=200, content={"artifacts": artifacts})
