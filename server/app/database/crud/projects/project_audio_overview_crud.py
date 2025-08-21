import logging
import uuid
from typing import Optional

from app.database.crud.projects.project_base_crud import ProjectBaseCRUD
from app.database.models import ProjectAudioOverview, ProjectRole, ProjectRoles
from app.schemas.user import CurrentUser
from pydantic import BaseModel
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


class ProjectAudioOverviewBase(BaseModel):
    audio_overview_id: uuid.UUID


class ProjectAudioOverviewCreate(ProjectAudioOverviewBase):
    pass


class ProjectAudioOverviewUpdate(ProjectAudioOverviewBase):
    pass


class ProjectAudioOverviewCRUD(
    ProjectBaseCRUD[
        ProjectAudioOverview, ProjectAudioOverviewCreate, ProjectAudioOverviewUpdate
    ]
):
    def create(
        self,
        db: Session,
        *,
        obj_in: ProjectAudioOverviewCreate,
        user: Optional[CurrentUser] = None,
        project_id: Optional[uuid.UUID] = None,
    ) -> Optional[ProjectAudioOverview]:
        # Validate required parameters for this implementation
        if user is None:
            raise ValueError(
                "user parameter is required for ProjectAudioOverviewCRUD.create"
            )
        if project_id is None:
            raise ValueError(
                "project_id parameter is required for ProjectAudioOverviewCRUD.create"
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

            db_obj = ProjectAudioOverview(
                project_id=project_id, audio_overview_id=obj_in.audio_overview_id
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


project_audio_overview_crud = ProjectAudioOverviewCRUD(ProjectAudioOverview)
