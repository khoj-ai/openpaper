import logging
import uuid

from app.auth.dependencies import get_required_user
from app.database.crud.projects.project_crud import project_crud
from app.database.crud.projects.project_role_invitation_crud import (
    ProjectRoleInvitationBase,
    project_role_invitation_crud,
)
from app.database.database import get_db
from app.database.models import ProjectRoles
from app.database.telemetry import track_event
from app.schemas.user import CurrentUser
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

router = APIRouter()


class InviteUser(BaseModel):
    email: EmailStr
    role: str


class BulkInviteRequest(BaseModel):
    invites: list[InviteUser]


@router.get("/user")
async def get_user_invitations(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """Get all invitations for the current user"""
    invitations = project_role_invitation_crud.get_pending_invitations_for_email(
        db, email=current_user.email
    )

    payload = [
        {
            "id": str(inv.id),
            "project_id": str(inv.project_id),
            "project_name": inv.project.title if inv.project else None,
            "email": inv.email,
            "role": str(inv.role),
            "invited_at": str(inv.invited_at),
            "invited_by": inv.inviter.email if inv.inviter else None,
            "accepted_at": str(inv.accepted_at) if inv.accepted_at else None,
        }
        for inv in invitations
    ]
    return JSONResponse(status_code=200, content={"invitations": payload})


@router.get("/{project_id}")
async def get_project_invitations(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """Get all invitations for a project"""
    invitations = project_role_invitation_crud.get_by_project(
        db, project_id=project_id, user=current_user
    )

    payload = [
        {
            "id": str(inv.id),
            "email": inv.email,
            "role": str(inv.role),
            "invited_at": str(inv.invited_at),
            "invited_by": inv.inviter.email if inv.inviter else None,
            "project_name": inv.project.title if inv.project else None,
        }
        for inv in invitations
    ]
    return JSONResponse(status_code=200, content={"invitations": payload})


@router.post("/{project_id}/invite")
async def invite_user_to_project(
    project_id: str,
    request: BulkInviteRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
) -> JSONResponse:
    """Invite multiple users to a project with their respective roles"""
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

        # Validate all roles before processing
        validated_invites = []
        for invite in request.invites:
            try:
                role = ProjectRoles(invite.role)
                validated_invites.append({"email": str(invite.email), "role": role})
            except ValueError:
                return JSONResponse(
                    status_code=400,
                    content={
                        "message": f"Invalid role '{invite.role}'. Valid roles are: {[r.value for r in ProjectRoles]}."
                    },
                )

        invites_data = [
            ProjectRoleInvitationBase(email=inv["email"], role=inv["role"])
            for inv in validated_invites
        ]

        invitations = project_role_invitation_crud.invite_users(
            db,
            project_id=str(project.id),
            invites=invites_data,
            inviting_user=current_user,
        )

        if not invitations:
            return JSONResponse(
                status_code=400,
                content={"message": "Failed to invite any users."},
            )

        track_event(
            "users_invited_to_project",
            user_id=str(current_user.id),
            properties={
                "invited_emails": [inv["email"] for inv in validated_invites],
                "roles": [inv["role"] for inv in validated_invites],
                "success_count": len(invitations),
            },
        )

        return JSONResponse(
            status_code=200,
            content={
                "message": f"Successfully invited {len(invitations)} user(s).",
                "invited_count": len(invitations),
                "total_requested": len(request.invites),
                "invitations": [
                    {
                        "email": inv.email,
                        "role": inv.role,
                        "id": str(inv.id),
                        "invited_at": str(inv.invited_at),
                    }
                    for inv in invitations
                ],
            },
        )
    except Exception as e:
        logger.error(f"Error inviting users to project: {e}", exc_info=True)
        return JSONResponse(
            status_code=400,
            content={"message": f"Failed to invite users: {str(e)}"},
        )


@router.post("/modify/{invitation_id}/accept")
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

        project_id = str(project_role.project_id)

        return JSONResponse(
            status_code=200,
            content={
                "project_id": project_id,
                "message": "Invitation accepted successfully.",
            },
        )
    except Exception as e:
        logger.error(f"Error accepting invitation: {e}")
        return JSONResponse(
            status_code=400,
            content={"message": f"Failed to accept invitation: {str(e)}"},
        )


@router.post("/modify/{invitation_id}/reject")
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


@router.delete("/modify/{invitation_id}/retract")
async def retract_invitation(
    invitation_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
) -> JSONResponse:
    """Retract a project invitation"""
    try:
        success = project_role_invitation_crud.retract_invitation(
            db, invitation_id=invitation_id, user=current_user
        )

        if not success:
            return JSONResponse(
                status_code=404,
                content={
                    "message": "Invitation not found or you do not have permission to retract it."
                },
            )

        track_event(
            "project_invitation_retracted",
            user_id=str(current_user.id),
            properties={"invitation_id": invitation_id},
        )

        return JSONResponse(
            status_code=200,
            content={"message": "Invitation retracted successfully."},
        )
    except Exception as e:
        logger.error(f"Error retracting invitation: {e}")
        return JSONResponse(
            status_code=400,
            content={"message": f"Failed to retract invitation: {str(e)}"},
        )
