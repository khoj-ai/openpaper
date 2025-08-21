import logging
import uuid
from typing import List, Optional

from app.database.crud.projects.project_base_crud import ProjectBaseCRUD
from app.database.models import ConversableType, Conversation, ProjectRole, ProjectRoles
from app.schemas.user import CurrentUser
from pydantic import BaseModel
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


class ProjectConversationBase(BaseModel):
    title: Optional[str] = None


class ProjectConversationCreate(ProjectConversationBase):
    pass


class ProjectConversationUpdate(ProjectConversationBase):
    pass


class ProjectConversationCRUD(
    ProjectBaseCRUD[Conversation, ProjectConversationCreate, ProjectConversationUpdate]
):
    def create(
        self,
        db: Session,
        *,
        obj_in: ProjectConversationCreate,
        user: Optional[CurrentUser] = None,
        project_id: Optional[uuid.UUID] = None,
    ) -> Optional[Conversation]:
        # Validate required parameters for this implementation
        if user is None:
            raise ValueError(
                "user parameter is required for ProjectConversationCRUD.create"
            )
        if project_id is None:
            raise ValueError(
                "project_id parameter is required for ProjectConversationCRUD.create"
            )

        try:
            # Check if the user has permission to create in this project
            project_role = (
                db.query(ProjectRole)
                .filter(
                    ProjectRole.project_id == project_id,
                    ProjectRole.user_id == user.id,
                    ProjectRole.role.in_([ProjectRoles.ADMIN]),
                )
                .first()
            )
            if not project_role:
                return None

            db_obj = Conversation(
                title=obj_in.title,
                user_id=user.id,
                conversable_id=project_id,
                conversable_type=ConversableType.PROJECT,
            )
            db.add(db_obj)
            db.commit()
            db.refresh(db_obj)
            return db_obj
        except Exception as e:
            db.rollback()
            logger.error(
                f"Error creating {self.model.__name__}: {str(e)}", exc_info=True
            )
            return None

    def get_by_project_id(
        self, db: Session, *, project_id: uuid.UUID, user: CurrentUser
    ) -> List[Conversation]:
        # First, check if the user has access to the project.
        project_role = (
            db.query(ProjectRole)
            .filter(
                ProjectRole.project_id == project_id,
                ProjectRole.user_id == user.id,
            )
            .first()
        )
        if not project_role:
            return []

        return (
            db.query(self.model)
            .filter(
                self.model.conversable_id == project_id,
                self.model.conversable_type == ConversableType.PROJECT,
            )
            .all()
        )


project_conversation_crud = ProjectConversationCRUD(Conversation)
