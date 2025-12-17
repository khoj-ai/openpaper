import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, cast
from uuid import UUID

from app.database.crud.base_crud import CRUDBase
from app.database.models import (
    DataTableExtractionJob,
    DataTableExtractionResult,
    DataTableRow,
    JobStatus,
    ProjectRole,
    ProjectRoles,
)
from app.schemas.user import CurrentUser
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

logger = logging.getLogger(__name__)


# ================================
# Job Schemas
# ================================


class DataTableJobCreate(BaseModel):
    project_id: UUID
    columns: List[str]
    task_id: Optional[str] = None


class DataTableJobUpdate(BaseModel):
    status: Optional[str] = None
    task_id: Optional[str] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    error_message: Optional[str] = None


# ================================
# Result Schemas
# ================================


class DataTableResultCreate(BaseModel):
    job_id: UUID
    title: str
    success: bool
    columns: List[str]


class DataTableResultUpdate(BaseModel):
    success: Optional[bool] = None
    columns: Optional[List[str]] = None


class DataTableRowCreate(BaseModel):
    data_table_id: UUID
    paper_id: UUID
    values: Dict[str, Any]  # {column_name: {value: str, citations: [...]}}


class DataTableRowUpdate(BaseModel):
    values: Optional[Dict[str, Any]] = None


# ================================
# Job CRUD
# ================================


class DataTableJobCRUD(
    CRUDBase[DataTableExtractionJob, DataTableJobCreate, DataTableJobUpdate]
):
    """CRUD operations for DataTableExtractionJob model"""

    def create(  # type: ignore[override]
        self,
        db: Session,
        *,
        obj_in: DataTableJobCreate,
        user: CurrentUser,
    ) -> Optional[DataTableExtractionJob]:
        """Create a new data table extraction job"""
        # Check if user has access to the project
        project_role = (
            db.query(ProjectRole)
            .filter(
                ProjectRole.project_id == obj_in.project_id,
                ProjectRole.user_id == user.id,
                ProjectRole.role.in_([ProjectRoles.ADMIN, ProjectRoles.EDITOR]),
            )
            .first()
        )
        if not project_role:
            logger.warning(
                f"User {user.id} does not have permission to create job in project {obj_in.project_id}"
            )
            return None

        try:
            db_obj = DataTableExtractionJob(
                user_id=user.id,
                project_id=obj_in.project_id,
                columns=obj_in.columns,
                task_id=obj_in.task_id,
                status=JobStatus.PENDING,
            )
            db.add(db_obj)
            db.commit()
            db.refresh(db_obj)
            return db_obj
        except Exception as e:
            db.rollback()
            logger.error(
                f"Error creating DataTableExtractionJob: {str(e)}", exc_info=True
            )
            return None

    def get_data_table_jobs_used_this_week(
        self,
        db: Session,
        *,
        user: CurrentUser,
    ) -> int:
        """Get the number of data table jobs created by the user in the current week"""
        start_of_week = datetime.now(timezone.utc)
        start_of_week -= timedelta(days=start_of_week.weekday())
        start_of_week = start_of_week.replace(hour=0, minute=0, second=0, microsecond=0)

        count = (
            db.query(DataTableExtractionJob)
            .filter(
                DataTableExtractionJob.user_id == user.id,
                DataTableExtractionJob.created_at >= start_of_week,
            )
            .count()
        )
        return count

    def get_by_project(
        self,
        db: Session,
        *,
        project_id: UUID,
        user: CurrentUser,
    ) -> List[DataTableExtractionJob]:
        """Get all data table jobs for a project with their associated results"""
        # Check if user has access to the project
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
            db.query(DataTableExtractionJob)
            .options(joinedload(DataTableExtractionJob.result))
            .filter(DataTableExtractionJob.project_id == project_id)
            .order_by(DataTableExtractionJob.created_at.desc())
            .all()
        )

    def get_pending_by_project(
        self,
        db: Session,
        *,
        project_id: UUID,
        user: CurrentUser,
    ) -> List[DataTableExtractionJob]:
        """Get all pending data table jobs for a project"""
        # Check if user has access to the project
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
            db.query(DataTableExtractionJob)
            .filter(
                DataTableExtractionJob.project_id == project_id,
                DataTableExtractionJob.status == JobStatus.PENDING,
            )
            .order_by(DataTableExtractionJob.created_at.desc())
            .all()
        )

    def get_by_id_and_project(
        self,
        db: Session,
        *,
        job_id: UUID,
        project_id: UUID,
        user: CurrentUser,
    ) -> Optional[DataTableExtractionJob]:
        """Get a specific job by ID within a project"""
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

        return (
            db.query(DataTableExtractionJob)
            .filter(
                DataTableExtractionJob.id == job_id,
                DataTableExtractionJob.project_id == project_id,
            )
            .first()
        )

    def get_by_task_id(
        self,
        db: Session,
        *,
        task_id: str,
    ) -> Optional[DataTableExtractionJob]:
        """Get a job by its Celery task ID (for webhook handlers)"""
        return (
            db.query(DataTableExtractionJob)
            .filter(DataTableExtractionJob.task_id == task_id)
            .first()
        )

    def update_status(
        self,
        db: Session,
        *,
        job_id: UUID,
        status: str,
        error_message: Optional[str] = None,
    ) -> Optional[DataTableExtractionJob]:
        """Update job status with timestamp tracking"""
        job: DataTableExtractionJob | None = (
            db.query(DataTableExtractionJob)
            .filter(DataTableExtractionJob.id == job_id)
            .first()
        )

        if not job:
            return None

        job.status = status  # type: ignore

        # Set timestamps based on status
        if status == JobStatus.RUNNING and not job.started_at:
            job.started_at = datetime.now(timezone.utc)  # type: ignore
        elif status in [JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED]:
            if not job.completed_at:
                job.completed_at = datetime.now(timezone.utc)  # type: ignore

        if error_message:
            job.error_message = error_message  # type: ignore

        db.commit()
        db.refresh(job)
        return job

    def update_task_id(
        self,
        db: Session,
        *,
        job_id: UUID,
        task_id: str,
    ) -> Optional[DataTableExtractionJob]:
        """Update the Celery task ID for a job"""
        job = (
            db.query(DataTableExtractionJob)
            .filter(DataTableExtractionJob.id == job_id)
            .first()
        )

        if not job:
            return None

        job.task_id = task_id
        db.commit()
        db.refresh(job)
        return job

    def job_to_dict(self, job: DataTableExtractionJob) -> Dict[str, Any]:
        """Convert DataTableExtractionJob object to dictionary"""
        return {
            "id": str(job.id),
            "project_id": str(job.project_id) if job.project_id else None,
            "columns": job.columns,
            "task_id": job.task_id,
            "title": job.result.title if job.result else None,
            "status": job.status,
            "started_at": job.started_at.isoformat() if job.started_at else None,
            "completed_at": job.completed_at.isoformat() if job.completed_at else None,
            "created_at": job.created_at.isoformat() if job.created_at else None,
            "updated_at": job.updated_at.isoformat() if job.updated_at else None,
            "error_message": job.error_message,
            "result_id": str(job.result.id) if job.result else None,
        }


# ================================
# Result CRUD
# ================================


class DataTableResultCRUD(
    CRUDBase[DataTableExtractionResult, DataTableResultCreate, DataTableResultUpdate]
):
    """CRUD operations for DataTableExtractionResult model"""

    def create(  # type: ignore[override]
        self,
        db: Session,
        *,
        obj_in: DataTableResultCreate,
        user: Optional[CurrentUser] = None,
    ) -> Optional[DataTableExtractionResult]:
        """Create a new data table result"""
        try:
            db_obj = DataTableExtractionResult(
                title=obj_in.title,
                job_id=obj_in.job_id,
                success=obj_in.success,
                columns=obj_in.columns,
            )
            db.add(db_obj)
            db.commit()
            db.refresh(db_obj)
            return db_obj
        except Exception as e:
            db.rollback()
            logger.error(
                f"Error creating DataTableExtractionResult: {str(e)}", exc_info=True
            )
            return None

    def get_by_job_id(
        self,
        db: Session,
        *,
        job_id: UUID,
    ) -> Optional[DataTableExtractionResult]:
        """Get result by job ID with rows eagerly loaded"""
        return (
            db.query(DataTableExtractionResult)
            .options(joinedload(DataTableExtractionResult.rows))
            .filter(DataTableExtractionResult.job_id == job_id)
            .first()
        )

    def get_by_project(
        self,
        db: Session,
        *,
        project_id: UUID,
        user: CurrentUser,
    ) -> List[DataTableExtractionResult]:
        """Get all results for a project"""
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
            db.query(DataTableExtractionResult)
            .join(
                DataTableExtractionJob,
                DataTableExtractionResult.job_id == DataTableExtractionJob.id,
            )
            .filter(DataTableExtractionJob.project_id == project_id)
            .order_by(DataTableExtractionResult.created_at.desc())
            .all()
        )

    def result_to_dict(
        self, result: DataTableExtractionResult, include_rows: bool = True
    ) -> Dict[str, Any]:
        """Convert DataTableExtractionResult object to dictionary"""
        data: Dict[str, Any] = {
            "id": str(result.id),
            "job_id": str(result.job_id),
            "title": result.title,
            "success": result.success,
            "columns": result.columns,
            "created_at": result.created_at.isoformat() if result.created_at else None,
            "updated_at": result.updated_at.isoformat() if result.updated_at else None,
        }
        if include_rows and result.rows:
            rows_list = cast(List[DataTableRow], result.rows)
            data["rows"] = [
                {
                    "id": str(row.id),
                    "paper_id": str(row.paper_id),
                    "values": row.values,
                }
                for row in rows_list
            ]
        return data


# ================================
# Row CRUD
# ================================


class DataTableRowCRUD(CRUDBase[DataTableRow, DataTableRowCreate, DataTableRowUpdate]):
    """CRUD operations for DataTableRow model"""

    def create(  # type: ignore[override]
        self,
        db: Session,
        *,
        obj_in: DataTableRowCreate,
        user: Optional[CurrentUser] = None,
    ) -> Optional[DataTableRow]:
        """Create a new data table row"""
        try:
            db_obj = DataTableRow(
                data_table_id=obj_in.data_table_id,
                paper_id=obj_in.paper_id,
                values=obj_in.values,
            )
            db.add(db_obj)
            db.commit()
            db.refresh(db_obj)
            return db_obj
        except Exception as e:
            db.rollback()
            logger.error(f"Error creating DataTableRow: {str(e)}", exc_info=True)
            return None

    def create_many(
        self,
        db: Session,
        *,
        rows: List[DataTableRowCreate],
    ) -> List[DataTableRow]:
        """Create multiple data table rows in a single transaction"""
        try:
            db_objs = [
                DataTableRow(
                    data_table_id=row.data_table_id,
                    paper_id=row.paper_id,
                    values=row.values,
                )
                for row in rows
            ]
            db.add_all(db_objs)
            db.commit()
            for obj in db_objs:
                db.refresh(obj)
            return db_objs
        except Exception as e:
            db.rollback()
            logger.error(f"Error creating DataTableRows: {str(e)}", exc_info=True)
            return []

    def get_by_data_table(
        self,
        db: Session,
        *,
        data_table_id: UUID,
    ) -> List[DataTableRow]:
        """Get all rows for a data table result"""
        return (
            db.query(DataTableRow)
            .filter(DataTableRow.data_table_id == data_table_id)
            .all()
        )


# Create single instances to use throughout the application
data_table_job_crud = DataTableJobCRUD(DataTableExtractionJob)
data_table_result_crud = DataTableResultCRUD(DataTableExtractionResult)
data_table_row_crud = DataTableRowCRUD(DataTableRow)
