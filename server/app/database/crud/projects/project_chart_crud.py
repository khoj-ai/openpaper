"""Persistence helpers for chart generation jobs."""

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from uuid import UUID

from app.database.crud.projects.project_crud import project_crud
from app.database.models import ChartGenerationJob, JobStatus, ProjectRoles
from app.database.telemetry import track_event
from app.schemas.user import CurrentUser
from sqlalchemy import update as sql_update
from sqlalchemy.orm import Session, joinedload

logger = logging.getLogger(__name__)

# How long a job may go without any recorded progress before it is presumed
# dead. Generous on purpose: a job's status only moves at a few points, and the
# gap between "investigating" and the finished chart is the whole run — every
# paper investigated, read as a PDF, and its values converted. A large project
# spends a long time in that gap, and failing a job that is still working is
# worse than a card that spins a while longer.
STALE_AFTER = timedelta(minutes=30)

# Which surface asked for the chart. Passed in rather than inferred: the two
# differ in more than one way (the composer confirms a plan, chat attaches a
# message later), and guessing from whichever of those happens to be set today
# would quietly start lying the first time one of them changes.
SOURCE_CHAT = "chat"
SOURCE_COMPOSER = "composer"

# The statuses a job does not come back from, each with the event it reports.
# One mapping rather than a list and a lookup, so a fourth terminal status
# cannot be added to the schema and silently stop being reported.
_TERMINAL_EVENTS: dict[str, str] = {
    JobStatus.COMPLETED: "chart_completed",
    JobStatus.FAILED: "chart_failed",
    JobStatus.CANCELLED: "chart_cancelled",
}
TERMINAL_STATUSES = tuple(_TERMINAL_EVENTS)


def _track(
    event: str, properties: dict[str, Any], *, user_id: Any, db: Session
) -> None:
    """Record a job event without letting telemetry decide the job's fate.

    The terminal events fire from the same call that marks a chart finished,
    and that call runs inside the background task's try block. An exception
    escaping here would be caught there and recorded as a failed chart — a
    delivered chart turned into a failure by an analytics call. Nothing about
    a chart is worth that, so this swallows and logs.
    """
    try:
        track_event(event, properties, user_id=str(user_id), db=db)
    except Exception:
        logger.warning("Could not record %s telemetry", event, exc_info=True)


def _elapsed(job: ChartGenerationJob) -> dict[str, Any]:
    """How long the requester waited, and how long the work itself took.

    Both, because they answer different questions and can diverge: a job sits
    queued until something picks it up, so the first is what the spinning card
    actually showed someone and the second is what generation cost.
    """
    finished = job.completed_at or datetime.now(timezone.utc)
    return {
        "seconds_since_requested": (
            (finished - job.created_at).total_seconds() if job.created_at else None
        ),
        "seconds_running": (
            (finished - job.started_at).total_seconds() if job.started_at else None
        ),
    }


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
        source: str,
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
        _track(
            "chart_job_created",
            {
                "job_id": str(job.id),
                "project_id": str(project_id),
                "source": source,
                # An empty selection is not "no papers" — it is the whole
                # project, which is what a chat request usually means. Counting
                # it as zero would read as a chart of nothing.
                "num_papers": len(paper_ids),
                "covers_whole_project": not paper_ids,
                # The composer settles a plan with the user before queueing;
                # chat's jobs plan for themselves, which is the slower half of
                # the run and where most of the ways to fail live.
                "has_confirmed_plan": plan is not None,
                "prompt": prompt,
            },
            user_id=user.id,
            db=db,
        )
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
        # Read before the write, so the event below fires on the transition
        # into a terminal state rather than on every later call that touches a
        # finished job — attaching an artifact id, say.
        was_terminal = job.status in TERMINAL_STATUSES
        now = datetime.now(timezone.utc)
        if status is not None:
            job.status = status  # type: ignore[assignment]
            if status == JobStatus.RUNNING and not job.started_at:
                job.started_at = now  # type: ignore[assignment]
            if status in TERMINAL_STATUSES:
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
        terminal_event = _TERMINAL_EVENTS.get(status) if status else None
        if terminal_event and not was_terminal:
            properties: dict[str, Any] = {
                "job_id": str(job.id),
                "project_id": str(job.project_id),
                # Source is not stored on the row, but by the time a job
                # finishes a chat-raised one has been attached to the turn that
                # asked for it and a composer one never is. That survives here.
                "from_chat": job.message_id is not None,
                "num_papers": len(job.paper_ids or []),  # type: ignore[arg-type]
                "has_confirmed_plan": job.plan is not None,
                **_elapsed(job),
            }
            if status == JobStatus.FAILED:
                # The message is the user-facing one, so it distinguishes the
                # ordinary outcome — a corpus that reports nothing chartable —
                # from an actual break, which otherwise look alike in the data.
                properties["status_message"] = job.status_message
                properties["error_message"] = (job.error_message or "")[:200]
            _track(terminal_event, properties, user_id=job.user_id, db=db)
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
        commit simply matches no rows. RETURNING is what makes that hold for
        the telemetry too — each server gets back the rows it actually claimed,
        so a sweep racing another server reports the jobs it stopped and not
        the ones its neighbour did.

        These are reported as their own event rather than as `chart_failed`,
        which they never pass through: this writes the terminal status
        directly, and the two mean different things. A failure was observed,
        while this is only an absence of progress.

        Returns how many were failed.
        """
        now = datetime.now(timezone.utc)
        stopped = db.execute(
            sql_update(ChartGenerationJob)
            .where(
                ChartGenerationJob.project_id == project_id,
                ChartGenerationJob.status.in_([JobStatus.PENDING, JobStatus.RUNNING]),
                ChartGenerationJob.updated_at < now - STALE_AFTER,
            )
            .values(
                status=JobStatus.FAILED,
                status_message="Chart generation stopped",
                # Deliberately non-specific about the cause. All this actually
                # knows is that no progress was recorded for a long time, and a
                # lost server is only one way to get there — an unhandled
                # error, a provider timing out, or an investigation that ran
                # long look identical from here. Naming a cause we didn't
                # observe sends the user looking in the wrong place.
                error_message=(
                    "This chart stopped making progress and was closed out. "
                    "Ask for it again and it will start over."
                ),
                completed_at=now,
            )
            .returning(
                ChartGenerationJob.id,
                ChartGenerationJob.user_id,
                ChartGenerationJob.created_at,
                ChartGenerationJob.started_at,
                ChartGenerationJob.message_id,
            )
            .execution_options(synchronize_session=False)
        ).all()
        if stopped:
            db.commit()
            logger.info(
                "Failed %d chart job(s) that stopped making progress", len(stopped)
            )
            for job_id, user_id, created_at, started_at, message_id in stopped:
                _track(
                    "chart_stopped",
                    {
                        "job_id": str(job_id),
                        "project_id": str(project_id),
                        "from_chat": message_id is not None,
                        "seconds_since_requested": (
                            (now - created_at).total_seconds() if created_at else None
                        ),
                        # Null means it never started at all, which is a
                        # different problem from one that started and hung.
                        "seconds_running": (
                            (now - started_at).total_seconds() if started_at else None
                        ),
                    },
                    user_id=user_id,
                    db=db,
                )
        return len(stopped)

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
