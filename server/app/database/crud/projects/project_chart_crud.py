"""Persistence helpers for artifact-native chart generation jobs."""

from datetime import datetime, timezone
from typing import Any, Optional
from uuid import UUID

from app.database.crud.projects.project_crud import project_crud
from app.database.models import ChartGenerationJob, JobStatus, ProjectRoles
from app.schemas.user import CurrentUser
from sqlalchemy.orm import Session, joinedload


class ChartJobCRUD:
    def create(
        self,
        db: Session,
        *,
        project_id: UUID,
        prompt: str,
        paper_ids: list[str],
        plan: Optional[dict[str, Any]],
        user: CurrentUser,
        message_id: Optional[UUID] = None,
    ) -> Optional[ChartGenerationJob]:
        can_edit = project_crud.has_role(
            db,
            project_id=str(project_id),
            user_id=str(user.id),
            role=ProjectRoles.ADMIN,
        ) or project_crud.has_role(
            db,
            project_id=str(project_id),
            user_id=str(user.id),
            role=ProjectRoles.EDITOR,
        )
        if not can_edit:
            return None
        job = ChartGenerationJob(
            user_id=user.id,
            project_id=project_id,
            message_id=message_id,
            prompt=prompt,
            paper_ids=paper_ids,
            plan=plan,
            status=JobStatus.PENDING,
            status_message="Queued for investigation",
        )
        db.add(job)
        db.commit()
        db.refresh(job)
        project_crud.touch(db, project_id)
        return job

    def get_by_project(
        self, db: Session, *, project_id: UUID, user: CurrentUser
    ) -> list[ChartGenerationJob]:
        if (
            project_crud.get_role_in_project(db, project_id=str(project_id), user=user)
            is None
        ):
            return []
        return (
            db.query(ChartGenerationJob)
            .options(joinedload(ChartGenerationJob.artifact))
            .filter(ChartGenerationJob.project_id == project_id)
            .order_by(ChartGenerationJob.created_at.desc())
            .all()
        )

    def get(self, db: Session, *, job_id: UUID) -> Optional[ChartGenerationJob]:
        return (
            db.query(ChartGenerationJob)
            .options(joinedload(ChartGenerationJob.artifact))
            .filter(ChartGenerationJob.id == job_id)
            .first()
        )

    def update(
        self,
        db: Session,
        *,
        job_id: UUID,
        status: Optional[str] = None,
        status_message: Optional[str] = None,
        error_message: Optional[str] = None,
        trace: Optional[dict[str, Any]] = None,
        artifact_id: Optional[UUID] = None,
        message_id: Optional[UUID] = None,
    ) -> Optional[ChartGenerationJob]:
        job = self.get(db, job_id=job_id)
        if not job:
            return None
        now = datetime.now(timezone.utc)
        if status is not None:
            job.status = status  # type: ignore[assignment]
            if status == JobStatus.RUNNING and not job.started_at:
                job.started_at = now  # type: ignore[assignment]
            if status in (JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED):
                job.completed_at = now  # type: ignore[assignment]
        if status_message is not None:
            job.status_message = status_message  # type: ignore[assignment]
        if error_message is not None:
            job.error_message = error_message  # type: ignore[assignment]
        if trace is not None:
            job.trace = trace  # type: ignore[assignment]
        if artifact_id is not None:
            job.artifact_id = artifact_id  # type: ignore[assignment]
        if message_id is not None:
            job.message_id = message_id  # type: ignore[assignment]
        db.commit()
        db.refresh(job)
        return job

    @staticmethod
    def to_dict(job: ChartGenerationJob) -> dict[str, Any]:
        return {
            "id": str(job.id),
            "project_id": str(job.project_id),
            "message_id": str(job.message_id) if job.message_id else None,
            "prompt": job.prompt,
            "status": job.status,
            "status_message": job.status_message,
            "error_message": job.error_message,
            "trace": job.trace,
            "created_at": job.created_at.isoformat() if job.created_at else None,
            "updated_at": job.updated_at.isoformat() if job.updated_at else None,
            "started_at": job.started_at.isoformat() if job.started_at else None,
            "completed_at": job.completed_at.isoformat() if job.completed_at else None,
            "artifact": job.artifact.to_payload() if job.artifact else None,
            "artifact_id": str(job.artifact_id) if job.artifact_id else None,
        }


chart_job_crud = ChartJobCRUD()
