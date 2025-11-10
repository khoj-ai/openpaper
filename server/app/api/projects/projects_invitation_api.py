import logging
import uuid

from app.auth.dependencies import get_required_user
from app.database.crud.projects.project_crud import project_crud
from app.database.crud.projects.project_role_invitation_crud import (
    project_role_invitation_crud,
)
from app.database.database import get_db
from app.database.models import ProjectRoles
from app.database.telemetry import track_event
from app.schemas.user import CurrentUser
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/{project_id}/invite")
async def invite_user_to_project(
    project_id: str,
    email: str,
    role: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
) -> JSONResponse:
    """Invite a user to a project with a specific role"""
    try:
        project = project_crud.get(db, id=uuid.UUID(project_id), user=current_user)
        if not project:
            return JSONResponse(
                status_code=404,
                content={"message": f"Project with ID {project_id} not found."},
            )

        if not project_crud.has_role(
            db,
            project_id=str(project.id),
            user_id=str(current_user.id),
            role=ProjectRoles.ADMIN,
        ):
            return JSONResponse(
                status_code=403,
                content={
                    "message": "You do not have permission to invite users to this project."
                },
            )

        target_role = None
        try:
            target_role = ProjectRoles(role)
        except ValueError:
            return JSONResponse(
                status_code=400,
                content={
                    "message": f"Invalid role '{role}'. Valid roles are: {[r.value for r in ProjectRoles]}."
                },
            )

        invited_user = project_role_invitation_crud.invite_user(
            db,
            project_id=str(project.id),
            email=email,
            role=target_role,
            inviting_user=current_user,
        )

        if not invited_user:
            return JSONResponse(
                status_code=400,
                content={"message": f"Failed to invite user with email {email}."},
            )

        track_event(
            "user_invited_to_project",
            user_id=str(current_user.id),
            properties={"invited_email": email, "role": role},
        )

        return JSONResponse(
            status_code=200,
            content={
                "message": f"User with email {email} invited successfully as {role}."
            },
        )
    except Exception as e:
        logger.error(f"Error inviting user to project: {e}")
        return JSONResponse(
            status_code=400,
            content={"message": f"Failed to invite user: {str(e)}"},
        )


@router.post("/invitations/{invitation_id}/accept")
async def accept_invitation(
    invitation_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
) -> JSONResponse:
    """Accept a project invitation"""
    try:
        project_role = project_role_invitation_crud.accept_invitation(
            db, invitation_id=invitation_id, user=current_user
        )

        if not project_role:
            return JSONResponse(
                status_code=404,
                content={"message": "Invitation not found or invalid."},
            )

        track_event(
            "project_invitation_accepted",
            user_id=str(current_user.id),
            properties={"project_id": str(project_role.project_id)},
        )

        return JSONResponse(
            status_code=200,
            content={"message": "Invitation accepted successfully."},
        )
    except Exception as e:
        logger.error(f"Error accepting invitation: {e}")
        return JSONResponse(
            status_code=400,
            content={"message": f"Failed to accept invitation: {str(e)}"},
        )


@router.post("/invitations/{invitation_id}/reject")
async def reject_invitation(
    invitation_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
) -> JSONResponse:
    """Reject a project invitation"""
    try:
        success = project_role_invitation_crud.reject_invitation(
            db, invitation_id=invitation_id, user=current_user
        )

        if not success:
            return JSONResponse(
                status_code=404,
                content={"message": "Invitation not found or invalid."},
            )

        track_event(
            "project_invitation_rejected",
            user_id=str(current_user.id),
            properties={"invitation_id": invitation_id},
        )

        return JSONResponse(
            status_code=200,
            content={"message": "Invitation rejected successfully."},
        )
    except Exception as e:
        logger.error(f"Error rejecting invitation: {e}")
        return JSONResponse(
            status_code=400,
            content={"message": f"Failed to reject invitation: {str(e)}"},
        )
