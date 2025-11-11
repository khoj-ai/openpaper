import logging
from typing import Optional

from app.database.crud.base_crud import CRUDBase
from app.database.crud.projects.project_crud import project_crud
from app.database.crud.user_crud import user as user_crud
from app.database.models import (
    Project,
    ProjectRole,
    ProjectRoleInvitation,
    ProjectRoles,
)
from app.helpers.email import (
    CLIENT_DOMAIN,
    send_general_invite_email,
    send_project_invite_email,
)
from app.schemas.user import CurrentUser
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


# Pydantic models
class ProjectRoleInvitationBase(BaseModel):
    email: EmailStr
    role: ProjectRoles


class ProjectRoleInvitationCreate(ProjectRoleInvitationBase):
    project_id: str
    invited_by: str


class ProjectRoleInvitationUpdate(BaseModel):
    role: Optional[ProjectRoles] = None


class ProjectRoleInvitationCRUD(
    CRUDBase[
        ProjectRoleInvitation,
        ProjectRoleInvitationCreate,
        ProjectRoleInvitationUpdate,
    ]
):
    def create(
        self,
        db: Session,
        *,
        obj_in: ProjectRoleInvitationCreate,
        user: Optional[CurrentUser] = None,
    ) -> Optional[ProjectRoleInvitation]:
        if user is None:
            raise ValueError(
                "user parameter is required for ProjectRoleInvitationCRUD.create"
            )
        if not project_crud.has_role(
            db,
            project_id=obj_in.project_id,
            user_id=str(user.id),
            role=ProjectRoles.ADMIN,
        ):
            logger.error(
                f"User {user.id} does not have admin role in project {obj_in.project_id}"
            )
            return None
        try:
            db_obj = ProjectRoleInvitation(
                project_id=obj_in.project_id,
                email=obj_in.email,
                role=obj_in.role,
                invited_by=obj_in.invited_by,
            )
            db.add(db_obj)
            db.commit()
            db.refresh(db_obj)
            return db_obj
        except Exception as e:
            db.rollback()
            logger.error(
                f"Error creating {ProjectRoleInvitation.__name__}: {str(e)}",
                exc_info=True,
            )
            return None

    def get_by_project_and_email(
        self, db: Session, *, project_id: str, email: str
    ) -> Optional[ProjectRoleInvitation]:
        return (
            db.query(self.model)
            .filter(
                ProjectRoleInvitation.project_id == project_id,
                ProjectRoleInvitation.email == email,
            )
            .first()
        )

    def get_by_project(
        self, db: Session, *, project_id: str, user: CurrentUser
    ) -> list[ProjectRoleInvitation]:
        project = project_crud.get(db, id=project_id, user=user)

        if not project:
            return []

        return (
            db.query(self.model)
            .filter(ProjectRoleInvitation.project_id == project_id)
            .all()
        )

    def invite_user(
        self,
        db: Session,
        *,
        project_id: str,
        email: str,
        role: ProjectRoles,
        inviting_user: CurrentUser,
    ) -> Optional[ProjectRoleInvitation]:
        """Invite a user to a project with a specific role by creating an invitation."""
        try:
            # Check if the user is already a member of the project
            invited_user = user_crud.get_by_email(db, email=email)
            if invited_user:
                existing_role = (
                    db.query(ProjectRole)
                    .filter(
                        ProjectRole.project_id == project_id,
                        ProjectRole.user_id == invited_user.id,
                    )
                    .first()
                )
                if existing_role:
                    logger.info(
                        f"User with email {email} is already a member of project {project_id}."
                    )
                    return None

            # Check if an invitation already exists
            existing_invitation = self.get_by_project_and_email(
                db, project_id=project_id, email=email
            )
            if existing_invitation:
                logger.info(
                    f"An invitation for {email} to project {project_id} already exists."
                )
                return existing_invitation

            # Create the invitation
            invitation_create = ProjectRoleInvitationCreate(
                project_id=project_id,
                email=email,
                role=role,
                invited_by=str(inviting_user.id),
            )
            invitation = self.create(db, obj_in=invitation_create, user=inviting_user)

            if invitation:
                project = db.query(Project).filter(Project.id == project_id).first()
                if not project:
                    logger.error(f"Project with id {project_id} not found.")
                    return invitation

                invite_link = f"{CLIENT_DOMAIN}/project/{project_id}/accept-invite"

                if invited_user:
                    send_project_invite_email(
                        to_email=email,
                        project_title=project.title,
                        from_name=str(inviting_user.name),
                        invite_link=invite_link,
                    )
                else:
                    send_general_invite_email(
                        to_email=email,
                        from_name=str(inviting_user.name),
                        invite_link=invite_link,
                    )

            return invitation

        except Exception as e:
            db.rollback()
            logger.error(
                f"Error inviting user {email} to project {project_id}: {str(e)}",
                exc_info=True,
            )
            return None

    def accept_invitation(
        self, db: Session, *, invitation_id: str, user: CurrentUser
    ) -> Optional[ProjectRole]:
        """Accept a project invitation."""
        try:
            invitation: ProjectRoleInvitation | None = (
                db.query(ProjectRoleInvitation)
                .filter(ProjectRoleInvitation.id == invitation_id)
                .first()
            )

            if not invitation or invitation.email != user.email:
                logger.warning(
                    f"Invalid invitation {invitation_id} for user {user.id} ({user.email})"
                )
                return None

            # Create a project role for the user
            project_role = ProjectRole(
                project_id=invitation.project_id,
                user_id=str(user.id),
                role=invitation.role,
            )
            db.add(project_role)

            # Delete the invitation
            db.delete(invitation)
            db.commit()

            return project_role

        except Exception as e:
            db.rollback()
            logger.error(
                f"Error accepting invitation {invitation_id} for user {user.id}: {str(e)}",
                exc_info=True,
            )
            return None

    def reject_invitation(
        self, db: Session, *, invitation_id: str, user: CurrentUser
    ) -> bool:
        """Reject a project invitation."""
        try:
            invitation: ProjectRoleInvitation | None = (
                db.query(ProjectRoleInvitation)
                .filter(ProjectRoleInvitation.id == invitation_id)
                .first()
            )

            if not invitation or invitation.email != user.email:
                logger.warning(
                    f"Invalid invitation {invitation_id} for user {user.id} ({user.email})"
                )
                return False

            # Delete the invitation
            db.delete(invitation)
            db.commit()

            return True

        except Exception as e:
            db.rollback()
            logger.error(
                f"Error rejecting invitation {invitation_id} for user {user.id}: {str(e)}",
                exc_info=True,
            )
            return False

    def get_pending_invitations_for_email(
        self, db: Session, *, email: str
    ) -> list[ProjectRoleInvitation]:
        """Get all pending invitations for a given email."""
        return (
            db.query(ProjectRoleInvitation)
            .filter(
                ProjectRoleInvitation.email == email,
                ProjectRoleInvitation.accepted_at == None,
            )
            .all()
        )


project_role_invitation_crud = ProjectRoleInvitationCRUD(ProjectRoleInvitation)
