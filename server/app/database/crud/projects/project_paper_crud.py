import logging
import uuid
from typing import List, Optional

from app.database.crud.projects.project_base_crud import ProjectBaseCRUD
from app.database.models import Paper, ProjectPaper, ProjectRole, ProjectRoles
from app.schemas.user import CurrentUser
from pydantic import BaseModel
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


class ProjectPaperBase(BaseModel):
    paper_id: uuid.UUID


class ProjectPaperCreate(ProjectPaperBase):
    pass


class ProjectPaperUpdate(BaseModel):  # Empty update schema
    pass


class ProjectPaperCRUD(
    ProjectBaseCRUD[ProjectPaper, ProjectPaperCreate, ProjectPaperUpdate]
):
    def create(
        self,
        db: Session,
        *,
        obj_in: ProjectPaperCreate,
        user: Optional[CurrentUser] = None,
        project_id: Optional[uuid.UUID] = None,
    ) -> Optional[ProjectPaper]:
        # Validate required parameters for this implementation
        if user is None:
            raise ValueError("user parameter is required for ProjectPaperCRUD.create")
        if project_id is None:
            raise ValueError(
                "project_id parameter is required for ProjectPaperCRUD.create"
            )

        try:
            # Check if the user has permission to add a paper to this project
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
                logger.warning(
                    f"User {user.id} does not have permission to add paper to project {project_id}"
                )
                return None

            # Check if the paper exists and belongs to the user
            paper = (
                db.query(Paper)
                .filter(Paper.id == obj_in.paper_id, Paper.user_id == user.id)
                .first()
            )
            if not paper:
                logger.warning(
                    f"Paper with id {obj_in.paper_id} not found for user {user.id}"
                )
                return None

            # Check if the paper is already in the project
            existing_project_paper = (
                db.query(ProjectPaper)
                .filter(
                    ProjectPaper.project_id == project_id,
                    ProjectPaper.paper_id == obj_in.paper_id,
                )
                .first()
            )
            if existing_project_paper:
                logger.warning(
                    f"Paper {obj_in.paper_id} is already in project {project_id}"
                )
                return existing_project_paper

            db_obj = ProjectPaper(project_id=project_id, paper_id=obj_in.paper_id)
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

    def get_paper_by_project(
        self,
        db: Session,
        *,
        paper_id: uuid.UUID,
        project_id: uuid.UUID,
        user: CurrentUser,
    ) -> Optional[Paper]:
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
            return None

        project_paper = (
            db.query(self.model)
            .filter(
                self.model.project_id == project_id, self.model.paper_id == paper_id
            )
            .first()
        )

        if not project_paper:
            return None

        return db.query(Paper).filter(Paper.id == project_paper.paper_id).first()

    def get_all_papers_by_project_id(
        self, db: Session, *, project_id: uuid.UUID, user: CurrentUser
    ) -> List[Paper]:
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

        project_papers = (
            db.query(self.model).filter(self.model.project_id == project_id).all()
        )
        paper_ids = [pp.paper_id for pp in project_papers]
        papers = db.query(Paper).filter(Paper.id.in_(paper_ids)).all()
        return papers

    def remove_by_paper_and_project(
        self,
        db: Session,
        *,
        paper_id: uuid.UUID,
        project_id: uuid.UUID,
        user: CurrentUser,
    ) -> Optional[ProjectPaper]:
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
            return None

        project_paper = (
            db.query(self.model)
            .filter(
                self.model.project_id == project_id, self.model.paper_id == paper_id
            )
            .first()
        )

        if not project_paper:
            return None

        db.delete(project_paper)
        db.commit()
        return project_paper


project_paper_crud = ProjectPaperCRUD(ProjectPaper)
