"""Background execution for project chart-generation jobs."""

import logging
from uuid import UUID

from app.database.crud.artifact_crud import artifact_crud
from app.database.crud.projects.project_chart_crud import chart_job_crud
from app.database.crud.projects.project_paper_crud import project_paper_crud
from app.database.database import SessionLocal
from app.database.models import ArtifactKind, ConversableType, JobStatus
from app.llm.operations import operations
from app.schemas.chart import ChartPlan
from app.schemas.user import CurrentUser

logger = logging.getLogger(__name__)


def generate_chart(
    *,
    job_id: UUID,
    project_id: UUID,
    user: CurrentUser,
) -> None:
    """Run a saved chart request in an independent DB session.

    This follows the audio-overview pattern: the request returns immediately,
    while a background worker owns the long-running investigation and writes
    incremental, pollable status to the job record.
    """
    db = SessionLocal()
    try:
        job = chart_job_crud.get(db, job_id=job_id)
        if not job:
            return
        chart_job_crud.update(
            db,
            job_id=job_id,
            status=JobStatus.RUNNING,
            status_message="Investigating selected papers",
        )
        papers = project_paper_crud.get_all_papers_by_project_id(
            db, project_id=project_id, user=user
        )
        if job.paper_ids:
            selected = {str(paper_id) for paper_id in job.paper_ids}
            papers = [paper for paper in papers if str(paper.id) in selected]
        if not papers:
            raise ValueError(
                "None of the selected papers are available in this project"
            )

        plan = ChartPlan.model_validate(job.plan)
        roster = [(str(paper.id), str(paper.title or "Untitled")) for paper in papers]
        investigation = operations.investigate_chart_fields(
            prompt=job.prompt,
            papers=roster,
            current_user=user,
            db=db,
            project_id=str(project_id),
            plan=plan,
        )
        chart_job_crud.update(
            db,
            job_id=job_id,
            status_message="Extracting directly quoted chart values",
            trace=investigation.trace,
        )
        artifact = operations.build_chart_artifact(
            prompt=job.prompt,
            plan=plan,
            evidence=investigation.evidence,
            papers=roster,
        )
        if not artifact or not operations.is_chart_ready(artifact):
            message = (
                operations.chart_failure_message(artifact)
                if artifact
                else "No cited chart could be built from this scope."
            )
            chart_job_crud.update(
                db,
                job_id=job_id,
                status=JobStatus.FAILED,
                status_message="Chart generation could not find enough cited values",
                error_message=message,
            )
            return

        artifact.investigation_trace = investigation.trace
        created = artifact_crud.create_for_scope(
            db,
            kind=ArtifactKind.CHART,
            payload=artifact.model_dump(),
            scope_type=ConversableType.PROJECT.value,
            scope_id=project_id,
            user=user,
        )
        if not created:
            raise ValueError("Failed to save chart artifact")
        chart_job_crud.update(
            db,
            job_id=job_id,
            status=JobStatus.COMPLETED,
            artifact_id=created.id,
        )
    except Exception as exc:
        logger.exception("Chart generation job %s failed", job_id)
        try:
            chart_job_crud.update(
                db,
                job_id=job_id,
                status=JobStatus.FAILED,
                status_message="Chart generation failed",
                error_message=str(exc),
            )
        except Exception:
            logger.exception("Unable to record chart job failure for %s", job_id)
    finally:
        db.close()
