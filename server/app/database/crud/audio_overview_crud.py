from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID

from app.database.crud.base_crud import CRUDBase
from app.database.models import (
    AudioOverview,
    AudioOverviewJob,
    ConversableType,
    JobStatus,
)
from app.schemas.responses import ResponseCitation
from app.schemas.user import CurrentUser
from pydantic import BaseModel
from sqlalchemy.orm import Session


class AudioOverviewJobBase(BaseModel):
    conversable_id: UUID
    conversable_type: ConversableType = ConversableType.PAPER


class AudioOverviewJobCreate(AudioOverviewJobBase):
    pass


class AudioOverviewJobUpdate(BaseModel):
    status: Optional[str] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


class AudioOverviewBase(BaseModel):
    conversable_id: UUID
    conversable_type: ConversableType = ConversableType.PAPER
    s3_object_key: str
    transcript: Optional[str] = None
    citations: Optional[List[ResponseCitation]] = None
    title: Optional[str] = None


class AudioOverviewCreate(AudioOverviewBase):
    pass


class AudioOverviewUpdate(BaseModel):
    s3_object_key: Optional[str] = None
    transcript: Optional[str] = None
    citations: Optional[List[ResponseCitation]] = None
    title: Optional[str] = None


class AudioOverviewJobCRUD(
    CRUDBase[AudioOverviewJob, AudioOverviewJobCreate, AudioOverviewJobUpdate]
):
    """CRUD operations for AudioOverviewJob model"""

    def create(
        self, db: Session, *, obj_in: AudioOverviewJobCreate, current_user: CurrentUser
    ) -> AudioOverviewJob:
        """Create a new audio overview job"""
        obj_in_data = obj_in.model_dump(exclude_unset=True)
        db_obj = AudioOverviewJob(**obj_in_data, user_id=current_user.id)

        db.add(db_obj)
        db.commit()
        db.refresh(db_obj)
        return db_obj

    def get_by_conversable_and_user(
        self,
        db: Session,
        *,
        conversable_id: UUID,
        conversable_type: ConversableType,
        current_user: CurrentUser
    ) -> Optional[AudioOverviewJob]:
        """Get audio overview job by conversable ID, type and user"""
        return (
            db.query(AudioOverviewJob)
            .filter(
                AudioOverviewJob.conversable_id == conversable_id,
                AudioOverviewJob.conversable_type == conversable_type,
                AudioOverviewJob.user_id == current_user.id,
            )
            .order_by(AudioOverviewJob.created_at.desc())
            .first()
        )

    # Backward compatibility method for paper-specific queries
    def get_by_paper_and_user(
        self, db: Session, *, paper_id: UUID, current_user: CurrentUser
    ) -> Optional[AudioOverviewJob]:
        """Get audio overview job by paper ID and user (backward compatibility)"""
        return self.get_by_conversable_and_user(
            db=db,
            conversable_id=paper_id,
            conversable_type=ConversableType.PAPER,
            current_user=current_user,
        )

    def get_user_jobs(
        self,
        db: Session,
        *,
        current_user: CurrentUser,
        status: Optional[str] = None,
        conversable_type: Optional[ConversableType] = None
    ) -> List[AudioOverviewJob]:
        """Get all audio overview jobs for a user, optionally filtered by status and type"""
        query = db.query(AudioOverviewJob).filter(
            AudioOverviewJob.user_id == current_user.id
        )

        if status:
            query = query.filter(AudioOverviewJob.status == status)

        if conversable_type:
            query = query.filter(AudioOverviewJob.conversable_type == conversable_type)

        return query.order_by(AudioOverviewJob.created_at.desc()).all()

    def update_status(
        self, db: Session, *, job_id: UUID, status: str, current_user: CurrentUser
    ) -> Optional[AudioOverviewJob]:
        """Update job status with timestamp tracking"""
        job = (
            db.query(AudioOverviewJob)
            .filter(
                AudioOverviewJob.id == job_id,
                AudioOverviewJob.user_id == current_user.id,
            )
            .first()
        )

        if not job:
            return None

        job.status = status

        # Set timestamps based on status
        if status == JobStatus.RUNNING and not job.started_at:
            job.started_at = datetime.now(timezone.utc)
        elif status in [JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED]:
            if not job.completed_at:
                job.completed_at = datetime.now(timezone.utc)

        db.commit()
        db.refresh(job)
        return job

    def job_to_dict(self, job: AudioOverviewJob) -> Dict[str, Any]:
        """Convert AudioOverviewJob object to dictionary"""
        return {
            "id": str(job.id),
            "conversable_id": str(job.conversable_id),
            "conversable_type": job.conversable_type,
            # Keep paper_id for backward compatibility
            "paper_id": (
                str(job.conversable_id)
                if job.conversable_type == ConversableType.PAPER
                else None
            ),
            "status": job.status,
            "started_at": job.started_at.isoformat() if job.started_at else None,
            "completed_at": job.completed_at.isoformat() if job.completed_at else None,
            "created_at": job.created_at.isoformat() if job.created_at else None,
            "updated_at": job.updated_at.isoformat() if job.updated_at else None,
        }


class AudioOverviewCRUD(
    CRUDBase[AudioOverview, AudioOverviewCreate, AudioOverviewUpdate]
):
    """CRUD operations for AudioOverview model"""

    def create(
        self, db: Session, *, obj_in: AudioOverviewCreate, current_user: CurrentUser
    ) -> AudioOverview:
        """Create a new audio overview"""
        obj_in_data = obj_in.model_dump(exclude_unset=True)
        db_obj = AudioOverview(**obj_in_data, user_id=current_user.id)

        db.add(db_obj)
        db.commit()
        db.refresh(db_obj)
        return db_obj

    def get_by_conversable_and_user(
        self,
        db: Session,
        *,
        conversable_id: UUID,
        conversable_type: ConversableType,
        current_user: CurrentUser
    ) -> Optional[List[AudioOverview]]:
        """Get audio overviews by conversable ID, type and user"""
        return (
            db.query(AudioOverview)
            .filter(
                AudioOverview.conversable_id == conversable_id,
                AudioOverview.conversable_type == conversable_type,
                AudioOverview.user_id == current_user.id,
            )
            .order_by(AudioOverview.created_at.desc())
            .all()
        )

    def get_mrc_by_conversable_and_user(
        self,
        db: Session,
        *,
        conversable_id: UUID,
        conversable_type: ConversableType,
        current_user: CurrentUser
    ) -> Optional[AudioOverview]:
        """Get the most recent audio overview by conversable ID, type and user"""
        return (
            db.query(AudioOverview)
            .filter(
                AudioOverview.conversable_id == conversable_id,
                AudioOverview.conversable_type == conversable_type,
                AudioOverview.user_id == current_user.id,
            )
            .order_by(AudioOverview.created_at.desc())
            .first()
        )

    # Backward compatibility methods for paper-specific queries
    def get_by_paper_and_user(
        self, db: Session, *, paper_id: UUID, current_user: CurrentUser
    ) -> Optional[List[AudioOverview]]:
        """Get audio overviews by paper ID and user (backward compatibility)"""
        return self.get_by_conversable_and_user(
            db=db,
            conversable_id=paper_id,
            conversable_type=ConversableType.PAPER,
            current_user=current_user,
        )

    def get_mrc_by_paper_and_user(
        self, db: Session, *, paper_id: UUID, current_user: CurrentUser
    ) -> Optional[AudioOverview]:
        """Get the most recent audio overview by paper ID and user (backward compatibility)"""
        return self.get_mrc_by_conversable_and_user(
            db=db,
            conversable_id=paper_id,
            conversable_type=ConversableType.PAPER,
            current_user=current_user,
        )

    def get_user_overviews(
        self,
        db: Session,
        *,
        current_user: CurrentUser,
        conversable_type: Optional[ConversableType] = None
    ) -> List[AudioOverview]:
        """Get all audio overviews for a user, optionally filtered by type"""
        query = db.query(AudioOverview).filter(AudioOverview.user_id == current_user.id)

        if conversable_type:
            query = query.filter(AudioOverview.conversable_type == conversable_type)

        return query.order_by(AudioOverview.created_at.desc()).all()

    def update_transcript(
        self,
        db: Session,
        *,
        overview_id: UUID,
        transcript: str,
        current_user: CurrentUser
    ) -> Optional[AudioOverview]:
        """Update the transcript for an audio overview"""
        overview = (
            db.query(AudioOverview)
            .filter(
                AudioOverview.id == overview_id,
                AudioOverview.user_id == current_user.id,
            )
            .first()
        )

        if not overview:
            return None

        overview.transcript = transcript
        db.commit()
        db.refresh(overview)
        return overview

    def overview_to_dict(self, overview: AudioOverview) -> Dict[str, Any]:
        """Convert AudioOverview object to dictionary"""
        return {
            "id": str(overview.id),
            "conversable_id": str(overview.conversable_id),
            "conversable_type": overview.conversable_type,
            # Keep paper_id for backward compatibility
            "paper_id": (
                str(overview.conversable_id)
                if overview.conversable_type == ConversableType.PAPER
                else None
            ),
            "s3_object_key": overview.s3_object_key,
            "transcript": overview.transcript,
            "created_at": (
                overview.created_at.isoformat() if overview.created_at else None
            ),
            "updated_at": (
                overview.updated_at.isoformat() if overview.updated_at else None
            ),
            "title": overview.title,
            "citations": [
                ResponseCitation.model_validate(citation).model_dump()
                for citation in overview.citations or []
            ],
        }

    def get_audio_overviews_used_this_week(
        self,
        db: Session,
        *,
        current_user: CurrentUser,
        conversable_type: Optional[ConversableType] = None
    ) -> int:
        """
        Get the number of audio overviews used by the user this week.
        Optionally filter by conversable type.
        """
        start_of_week = datetime.now(timezone.utc) - timedelta(
            days=datetime.now(timezone.utc).weekday()
        )
        start_of_week = start_of_week.replace(hour=0, minute=0, second=0, microsecond=0)
        end_of_week = start_of_week + timedelta(days=7)

        query = db.query(AudioOverview).filter(
            AudioOverview.user_id == current_user.id,
            AudioOverview.created_at >= start_of_week,
            AudioOverview.created_at < end_of_week,
        )

        if conversable_type:
            query = query.filter(AudioOverview.conversable_type == conversable_type)

        return query.count()


# Create single instances to use throughout the application
audio_overview_job_crud = AudioOverviewJobCRUD(AudioOverviewJob)
audio_overview_crud = AudioOverviewCRUD(AudioOverview)
