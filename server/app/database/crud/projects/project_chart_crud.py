"""Persistence helpers for chart generation jobs."""

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from uuid import UUID

from app.database.crud.projects.project_crud import project_crud
from app.database.models import ChartGenerationJob, JobStatus, ProjectRoles
from app.schemas.user import CurrentUser
from sqlalchemy.orm import Session, joinedload

logger = logging.getLogger(__name__)

# How long a job may go without any recorded progress before it is presumed
# dead. Generous on purpose: a job's status only moves at a few points, and the
# gap between "investigating" and the finished chart is the whole run — every
# paper investigated, read as a PDF, and its values converted. A large project
# spends a long time in that gap, and failing a job that is still working is
# worse than a card that spins a while longer.
STALE_AFTER = timedelta(minutes=30)


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
        # Opportunistic, and scoped to the project being read: the only jobs
        # worth resolving are the ones somebody is about to look at, and this
        # is the path they are polling. Nothing anywhere else has to run.
        self.fail_stale(db, project_id=project_id)
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
    def fail_stale(db: Session, *, project_id: UUID) -> int:
        """Fail the project's jobs that nothing is working on any more.

        Generation runs inside a web process, so a job can be orphaned by a
        deploy, a crash, or a scaled-in task, with no one left to finish it or
        to mark it failed — but that is only the clearest way to get stuck, not
        the only one. Anything that leaves a run neither progressing nor
        completing lands here, so this reads elapsed time and claims nothing
        about the cause.

        Deliberately not swept at startup. The backend runs as a dozen
        identical servers, and a booting one cannot tell "this job died with
        its process" from "this job is running on a sibling right now"; a
        rolling deploy would have new tasks failing jobs their neighbours were
        still working on. Elapsed time is the one signal that means the same
        thing on every server, so that is what this uses.

        Scoped to the project rather than to the requester, because the panel
        shows the project's jobs whoever raised them: a member's abandoned job
        would otherwise spin in everyone's panel until that one member happened
        to look at it themselves.

        Written as a single conditional UPDATE rather than a read then a write:
        several servers can run this at the same moment, and the second one to
        commit simply matches no rows.

        Returns how many were failed.
        """
        cutoff = datetime.now(timezone.utc) - STALE_AFTER
        failed = (
            db.query(ChartGenerationJob)
            .filter(
                ChartGenerationJob.project_id == project_id,
                ChartGenerationJob.status.in_([JobStatus.PENDING, JobStatus.RUNNING]),
                ChartGenerationJob.updated_at < cutoff,
            )
            .update(
                {
                    ChartGenerationJob.status: JobStatus.FAILED,
                    ChartGenerationJob.status_message: "Chart generation stopped",
                    # Deliberately non-specific about the cause. All this
                    # actually knows is that no progress was recorded for a
                    # long time, and a lost server is only one way to get
                    # there — an unhandled error, a provider timing out, or an
                    # investigation that ran long look identical from here.
                    # Naming a cause we didn't observe sends the user looking
                    # in the wrong place.
                    ChartGenerationJob.error_message: (
                        "This chart stopped making progress and was closed out. "
                        "Ask for it again and it will start over."
                    ),
                    ChartGenerationJob.completed_at: datetime.now(timezone.utc),
                },
                synchronize_session=False,
            )
        )
        if failed:
            db.commit()
            logger.info("Failed %d chart job(s) that stopped making progress", failed)
        return failed

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
