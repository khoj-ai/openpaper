import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from app.database.crud.base_crud import CRUDBase
from app.database.models import (
    JobStatus,
    Paper,
    PaperUploadJob,
    ProjectPaper,
    ProjectRole,
)
from app.schemas.user import CurrentUser
from pydantic import BaseModel
from sqlalchemy.orm import Session

# In-progress upload jobs older than this are treated as dead — a worker that
# died before writing a terminal status leaves a job stuck in PENDING/RUNNING
# forever (there is no reaper). A real PDF upload+parse finishes in minutes, so
# any in-progress job older than this window is filtered out of upload trackers.
# Single source of truth for the "stale upload" threshold.
STALE_UPLOAD_JOB_CUTOFF = timedelta(minutes=30)


# Define Pydantic models for type safety
class PaperUploadJobBase(BaseModel):
    status: Optional[JobStatus] = JobStatus.PENDING
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    task_id: Optional[str] = None


class PaperUploadJobCreate(PaperUploadJobBase):
    # user_id will be set based on current_user, so not required in input
    pass


class PaperUploadJobUpdate(PaperUploadJobBase):
    status: Optional[JobStatus] = None
    task_id: Optional[str] = None


# PaperUploadJob CRUD that inherits from the base CRUD
class PaperUploadJobCRUD(
    CRUDBase[PaperUploadJob, PaperUploadJobCreate, PaperUploadJobUpdate]
):
    """CRUD operations specifically for PaperUploadJob model"""

    def mark_as_running(
        self, db: Session, *, job_id: str, user: CurrentUser
    ) -> Optional[PaperUploadJob]:
        """Mark a job as running and set started_at timestamp"""
        job = self.get(db, id=job_id, user=user)
        if job:
            return self.update(
                db=db,
                db_obj=job,
                obj_in=PaperUploadJobUpdate(
                    status=JobStatus.RUNNING, started_at=datetime.now(timezone.utc)
                ),
                user=user,
            )
        return None

    def mark_as_completed(
        self, db: Session, *, job_id: str, user: CurrentUser
    ) -> Optional[PaperUploadJob]:
        """Mark a job as completed and set completed_at timestamp"""
        job = self.get(db, id=job_id, user=user)
        if job:
            return self.update(
                db=db,
                db_obj=job,
                obj_in=PaperUploadJobUpdate(
                    status=JobStatus.COMPLETED, completed_at=datetime.now(timezone.utc)
                ),
                user=user,
            )
        return None

    def mark_as_failed(
        self, db: Session, *, job_id: str, user: CurrentUser
    ) -> Optional[PaperUploadJob]:
        """Mark a job as failed and set completed_at timestamp"""
        job = self.get(db, id=job_id, user=user)
        if job:
            return self.update(
                db=db,
                db_obj=job,
                obj_in=PaperUploadJobUpdate(
                    status=JobStatus.FAILED, completed_at=datetime.now(timezone.utc)
                ),
                user=user,
            )
        return None

    def mark_as_cancelled(
        self, db: Session, *, job_id: str, user: CurrentUser
    ) -> Optional[PaperUploadJob]:
        """Mark a job as cancelled and set completed_at timestamp"""
        job = self.get(db, id=job_id, user=user)
        if job:
            return self.update(
                db=db,
                db_obj=job,
                obj_in=PaperUploadJobUpdate(
                    status=JobStatus.CANCELLED, completed_at=datetime.utcnow()
                ),
                user=user,
            )
        return None

    def get_user_jobs(
        self, db: Session, *, user: CurrentUser, skip: int = 0, limit: int = 100
    ) -> list[PaperUploadJob]:
        """Get all paper upload jobs for a specific user"""
        return (
            db.query(PaperUploadJob)
            .filter(PaperUploadJob.user_id == user.id)
            .order_by(PaperUploadJob.created_at.desc())
            .offset(skip)
            .limit(limit)
            .all()
        )

    def get_in_progress_jobs_for_user(
        self, db: Session, *, user: CurrentUser
    ) -> list[tuple[PaperUploadJob, Paper]]:
        """
        Get a user's in-progress upload jobs across their whole library
        (project uploads included), paired with their paper record so the
        Library tracker can show a title. Mirrors get_in_progress_jobs_for_project
        but is scoped to the user rather than a single project.

        Dead jobs (worker died before writing a terminal status) are filtered
        out via STALE_UPLOAD_JOB_CUTOFF so they don't resurface on every load.
        """
        stale_cutoff = datetime.now(timezone.utc) - STALE_UPLOAD_JOB_CUTOFF
        return (
            db.query(PaperUploadJob, Paper)
            .join(Paper, Paper.upload_job_id == PaperUploadJob.id)
            .filter(
                PaperUploadJob.user_id == user.id,
                PaperUploadJob.status.in_([JobStatus.PENDING, JobStatus.RUNNING]),
                PaperUploadJob.created_at >= stale_cutoff,
            )
            .order_by(PaperUploadJob.created_at.asc())
            .all()
        )

    def get_in_progress_jobs_for_project(
        self, db: Session, *, project_id: uuid.UUID, user: CurrentUser
    ) -> list[tuple[PaperUploadJob, Paper]]:
        """
        Get upload jobs that are still in progress for a project, paired with
        their paper record.

        The paper and its ProjectPaper association are created at upload start
        (see helpers/pdf_jobs.py), so we can reach the job via
        ProjectPaper -> Paper.upload_job_id -> PaperUploadJob. Returns jobs that
        have not yet completed so the client can rehydrate the upload tracker
        after a page refresh.
        """
        # Only members of the project may see its in-progress uploads.
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

        # Filter out dead uploads so a phantom job doesn't resurface every time
        # the project opens. See STALE_UPLOAD_JOB_CUTOFF.
        stale_cutoff = datetime.now(timezone.utc) - STALE_UPLOAD_JOB_CUTOFF

        return (
            db.query(PaperUploadJob, Paper)
            .join(Paper, Paper.upload_job_id == PaperUploadJob.id)
            .join(ProjectPaper, ProjectPaper.paper_id == Paper.id)
            .filter(
                ProjectPaper.project_id == project_id,
                PaperUploadJob.status.in_([JobStatus.PENDING, JobStatus.RUNNING]),
                PaperUploadJob.created_at >= stale_cutoff,
            )
            .order_by(PaperUploadJob.created_at.asc())
            .all()
        )


# Create a single instance to use throughout the application
paper_upload_job_crud = PaperUploadJobCRUD(PaperUploadJob)
