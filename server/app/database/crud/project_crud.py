import logging
from typing import Any, Dict, List, Optional, Union

from app.database.crud.base_crud import CRUDBase
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


class ProjectCRUD(CRUDBase[Project, ProjectCreate, ProjectUpdate]):
    def create(
        self, db: Session, *, obj_in: ProjectCreate, user: CurrentUser
    ) -> Optional[Project]:
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

    def get(self, db: Session, id: Any, *, user: CurrentUser) -> Optional[Project]:
        return (
            db.query(Project)
            .join(ProjectRole, Project.id == ProjectRole.project_id)
            .filter(Project.id == id, ProjectRole.user_id == user.id)
            .first()
        )

    def get_multi_by_user(
        self, db: Session, *, user: CurrentUser, skip: int = 0, limit: int = 100
    ) -> List[Project]:
        return (
            db.query(Project)
            .join(ProjectRole, Project.id == ProjectRole.project_id)
            .filter(ProjectRole.user_id == user.id)
            .order_by(Project.created_at.desc())
            .offset(skip)
            .limit(limit)
            .all()
        )

    def update(
        self,
        db: Session,
        *,
        id: Any,
        obj_in: Union[ProjectUpdate, Dict[str, Any]],
        user: CurrentUser,
    ) -> Optional[Project]:
        try:
            # Find the project and check if the user is an admin
            db_obj = (
                db.query(Project)
                .join(ProjectRole, Project.id == ProjectRole.project_id)
                .filter(
                    Project.id == id,
                    ProjectRole.user_id == user.id,
                    ProjectRole.role == ProjectRoles.ADMIN,
                )
                .first()
            )

            if not db_obj:
                return None

            if isinstance(obj_in, dict):
                update_data = obj_in
            else:
                update_data = obj_in.model_dump(exclude_unset=True)

            for field, value in update_data.items():
                setattr(db_obj, field, value)

            db.add(db_obj)
            db.commit()
            db.refresh(db_obj)
            return db_obj
        except Exception as e:
            db.rollback()
            logger.error(
                f"Error updating Project with ID {id}: {str(e)}",
                exc_info=True,
            )
            return None

    def remove(self, db: Session, *, id: Any, user: CurrentUser) -> Optional[Project]:
        try:
            # Find the project and check if the user is an admin
            obj = (
                db.query(Project)
                .join(ProjectRole, Project.id == ProjectRole.project_id)
                .filter(
                    Project.id == id,
                    ProjectRole.user_id == user.id,
                    ProjectRole.role == ProjectRoles.ADMIN,
                )
                .first()
            )

            if obj:
                db.delete(obj)
                db.commit()
                return obj
            return None
        except Exception as e:
            db.rollback()
            logger.error(
                f"Error removing {Project.__name__} with ID {id}: {str(e)}",
                exc_info=True,
            )
            return None


project_crud = ProjectCRUD(Project)
