import logging
from typing import List, Optional

from app.database.crud.projects.project_base_crud import ProjectBaseCRUD
from app.database.models import (
    ConversableType,
    Conversation,
    Project,
    ProjectPaper,
    ProjectRole,
    ProjectRoles,
)
from app.schemas.user import CurrentUser
from pydantic import BaseModel
from sqlalchemy import func
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


class AnnotatedProject(ProjectBase):
    id: Optional[str] = None
    num_papers: int = 0
    num_conversations: int = 0
    updated_at: Optional[str] = None
    created_at: Optional[str] = None


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

    def get_all_projects_by_user_with_metadata(
        self, db: Session, user: CurrentUser
    ) -> List[AnnotatedProject]:
        """
        Get all projects for a user with metadata (num_papers, num_conversations) in a single query.
        """
        try:
            # Build a query that joins all necessary tables and aggregates the counts
            query = (
                db.query(
                    Project,
                    func.coalesce(func.count(ProjectPaper.id.distinct()), 0).label(
                        "num_papers"
                    ),
                    func.coalesce(func.count(Conversation.id.distinct()), 0).label(
                        "num_conversations"
                    ),
                )
                .join(ProjectRole, Project.id == ProjectRole.project_id)
                .outerjoin(ProjectPaper, Project.id == ProjectPaper.project_id)
                .outerjoin(
                    Conversation,
                    (Conversation.conversable_id == Project.id)
                    & (Conversation.conversable_type == ConversableType.PROJECT.value),
                )
                .filter(ProjectRole.user_id == user.id)
                .group_by(Project.id)
                .all()
            )

            # Convert the results to AnnotatedProject objects
            annotated_projects = []
            for project, num_papers, num_conversations in query:
                annotated_project = AnnotatedProject(
                    id=str(project.id),
                    title=project.title,
                    description=project.description,
                    num_papers=num_papers,
                    num_conversations=num_conversations,
                    updated_at=str(project.updated_at) if project.updated_at else None,
                    created_at=str(project.created_at) if project.created_at else None,
                )
                annotated_projects.append(annotated_project)

            return annotated_projects

        except Exception as e:
            logger.error(
                f"Error fetching projects with metadata for user {user.id}: {str(e)}",
                exc_info=True,
            )
            return []


project_crud = ProjectCRUD(Project)
