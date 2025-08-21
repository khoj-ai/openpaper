import logging
from typing import Optional

from app.database.crud.projects.project_base_crud import ProjectBaseCRUD
from app.database.models import Project, ProjectRole, ProjectRoles
from app.schemas.user import CurrentUser
from pydantic import BaseModel
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


# Pydantic models
class ProjectBase(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None


class ProjectCreate(ProjectBase):
    title: Optional[str] = None
    description: Optional[str] = None


class ProjectUpdate(ProjectBase):
    pass


class ProjectCRUD(ProjectBaseCRUD[Project, ProjectCreate, ProjectUpdate]):
    def create(
        self, db: Session, *, obj_in: ProjectCreate, user: Optional[CurrentUser] = None
    ) -> Optional[Project]:

        if user is None:
            raise ValueError("user parameter is required for ProjectCRUD.create")

        try:
            # Create the project
            db_obj = Project(
                title=obj_in.title,
                description=obj_in.description,
                admin_id=user.id,
            )
            db.add(db_obj)
            db.commit()
            db.refresh(db_obj)

            # Assign the creator the admin role
            project_role = ProjectRole(
                project_id=db_obj.id,
                user_id=user.id,
                role=ProjectRoles.ADMIN,
            )
            db.add(project_role)
            db.commit()

            return db_obj
        except Exception as e:
            db.rollback()
            logger.error(f"Error creating {Project.__name__}: {str(e)}", exc_info=True)
            return None


project_crud = ProjectCRUD(Project)
