import logging
from typing import Any, Dict, List, Optional, Union

from app.database.crud.base_crud import (
    CreateSchemaType,
    CRUDBase,
    ModelType,
    UpdateSchemaType,
)
from app.database.models import Project, ProjectRole, ProjectRoles
from app.schemas.user import CurrentUser
from sqlalchemy.orm import Query, Session

logger = logging.getLogger(__name__)


class ProjectBaseCRUD(CRUDBase[ModelType, CreateSchemaType, UpdateSchemaType]):
    def _get_base_query(self, db: Session) -> Query:
        if self.model == Project:
            return db.query(self.model)
        else:
            return db.query(self.model).join(
                Project, self.model.project_id == Project.id
            )

    def get(self, db: Session, id: Any, *, user: CurrentUser) -> Optional[ModelType]:  # type: ignore
        query = self._get_base_query(db)
        return (
            query.join(ProjectRole, Project.id == ProjectRole.project_id)
            .filter(self.model.id == id, ProjectRole.user_id == user.id)
            .first()
        )

    def get_multi_by_user(
        self, db: Session, *, user: CurrentUser, skip: int = 0, limit: int = 100
    ) -> List[ModelType]:
        query = self._get_base_query(db)
        join_on = Project.id if self.model == Project else self.model.project_id
        return (
            query.join(ProjectRole, join_on == ProjectRole.project_id)
            .filter(ProjectRole.user_id == user.id)
            .order_by(self.model.created_at.desc())
            .offset(skip)
            .limit(limit)
            .all()
        )

    def update(  # type: ignore
        self,
        db: Session,
        *,
        id: Any,
        obj_in: Union[UpdateSchemaType, Dict[str, Any]],
        user: CurrentUser,
    ) -> Optional[ModelType]:
        try:
            query = self._get_base_query(db)
            db_obj = (
                query.join(ProjectRole, Project.id == ProjectRole.project_id)
                .filter(
                    self.model.id == id,
                    ProjectRole.user_id == user.id,
                    ProjectRole.role.in_([ProjectRoles.ADMIN]),
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
                f"Error updating {self.model.__name__} with ID {id}: {str(e)}",
                exc_info=True,
            )
            return None

    def remove(self, db: Session, *, id: Any, user: CurrentUser) -> Optional[ModelType]:  # type: ignore
        try:
            query = self._get_base_query(db)
            obj = (
                query.join(ProjectRole, Project.id == ProjectRole.project_id)
                .filter(
                    self.model.id == id,
                    ProjectRole.user_id == user.id,
                    ProjectRole.role.in_([ProjectRoles.ADMIN]),
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
                f"Error removing {self.model.__name__} with ID {id}: {str(e)}",
                exc_info=True,
            )
            return None
