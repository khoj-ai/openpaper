from datetime import datetime, timezone
from typing import Optional

from app.database.crud.base_crud import CRUDBase
from app.database.models import JobStatus, PaperUploadJob
from app.schemas.user import CurrentUser
from pydantic import BaseModel
from sqlalchemy.orm import Session


# Define Pydantic models for type safety
class PaperUploadJobBase(BaseModel):
    status: Optional[JobStatus] = JobStatus.PENDING
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


class PaperUploadJobCreate(PaperUploadJobBase):
    # user_id will be set based on current_user, so not required in input
    pass


class PaperUploadJobUpdate(PaperUploadJobBase):
    status: Optional[JobStatus] = None


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

    def get_pending_jobs(
        self, db: Session, *, user: CurrentUser
    ) -> list[PaperUploadJob]:
        """Get all pending paper upload jobs for a specific user"""
        return (
            db.query(PaperUploadJob)
            .filter(
                PaperUploadJob.user_id == user.id,
                PaperUploadJob.status == JobStatus.PENDING,
            )
            .order_by(PaperUploadJob.created_at.asc())
            .all()
        )


# Create a single instance to use throughout the application
paper_upload_job_crud = PaperUploadJobCRUD(PaperUploadJob)
