import logging
import uuid
from ctypes import cast
from typing import List, Optional

from app.database.crud.paper_crud import PaperCreate, paper_crud
from app.database.crud.projects.project_base_crud import ProjectBaseCRUD
from app.database.models import Paper, Project, ProjectPaper, ProjectRole, ProjectRoles
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
                    ProjectRole.role.in_([ProjectRoles.ADMIN, ProjectRoles.EDITOR]),
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

    def get_projects_by_paper_id(
        self, db: Session, *, paper_id: uuid.UUID, user: CurrentUser
    ) -> List[Project]:
        # First, find all project-paper associations for the given paper_id
        project_papers: List[ProjectPaper] = (
            db.query(ProjectPaper).filter(ProjectPaper.paper_id == paper_id).all()
        )
        project_ids = [pp.project_id for pp in project_papers]

        if not project_ids:
            return []

        # Now, fetch all projects that match these IDs and that the user has access to
        projects = (
            db.query(Project)
            .join(ProjectRole, Project.id == ProjectRole.project_id)
            .filter(
                Project.id.in_(project_ids),
                ProjectRole.user_id == user.id,
            )
            .all()
        )

        return projects

    def get_forked_papers_by_parent_id(
        self, db: Session, *, parent_paper_id: uuid.UUID, user: CurrentUser
    ) -> Paper | None:
        # First, find the paper that has the given parent_paper_id. This can only be one at max.
        forked_paper: Paper | None = (
            db.query(Paper)
            .filter(Paper.parent_paper_id == parent_paper_id, Paper.user_id == user.id)
            .one_or_none()
        )

        return forked_paper

    def fork_paper(
        self,
        db: Session,
        *,
        parent_paper_id: str,
        new_file_object_key: str,
        new_file_url: str,
        new_preview_url: Optional[str],
        project_id: str,
        current_user: CurrentUser,
    ) -> Optional[Paper]:
        """Fork a paper to create a duplicate for the current user."""
        # Retrieve the original paper. Validate that the current_user has access to it via a project.
        original_paper = self.get_paper_by_project(
            db,
            paper_id=uuid.UUID(parent_paper_id),
            project_id=uuid.UUID(project_id),
            user=current_user,
        )

        if not original_paper:
            logger.error(
                f"Original paper with ID {parent_paper_id} not found for forking."
            )
            return None

        # Create a new PaperCreate object with the same data as the original
        # TODO: Include AI highlights/annotations as well? See function used during intake `create_ai_annotations` in paper_crud.py for reference.
        new_paper_data = PaperCreate(
            file_url=new_file_url,
            s3_object_key=new_file_object_key,
            authors=original_paper.authors,  # type: ignore
            title=str(original_paper.title),
            abstract=str(original_paper.abstract),
            institutions=original_paper.institutions,  # type: ignore
            keywords=original_paper.keywords,  # type: ignore
            summary=str(original_paper.summary),
            summary_citations=None,  # type: ignore
            starter_questions=original_paper.starter_questions,  # type: ignore
            publish_date=str(original_paper.publish_date) if original_paper.publish_date else None,  # type: ignore
            raw_content=original_paper.raw_content,  # type: ignore
            upload_job_id=None,  # New upload job ID
            preview_url=new_preview_url,
            size_in_kb=(
                int(original_paper.size_in_kb)  # type: ignore
                if original_paper.size_in_kb is not None
                else None
            ),
            parent_paper_id=uuid.UUID(str(original_paper.id)),  # Set parent paper ID
        )

        # Create the new paper in the database
        new_paper = paper_crud.create(db, obj_in=new_paper_data, user=current_user)
        return new_paper


project_paper_crud = ProjectPaperCRUD(ProjectPaper)
