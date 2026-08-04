"""Re-run a data-table extraction job in place, keeping its id and table.

Used by the admin console to retry a job after a pipeline fix or a transient
failure. The job's columns are kept, but metadata columns are re-classified
against the papers' CURRENT records — so a re-run picks up prefill for jobs
created before the metadata-prefill feature, and reflects metadata hydrated
since the original run.
"""

import logging
from datetime import datetime, timezone

from app.database.models import DataTableExtractionJob, JobStatus, Paper, ProjectPaper
from app.helpers.metadata_columns import plan_metadata_columns
from app.helpers.pdf_jobs import jobs_client
from app.schemas.responses import DataTableSchema, DocumentMapping
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


def resubmit_data_table_job(db: Session, job: DataTableExtractionJob) -> str:
    """Resubmit `job` to the jobs service and return the new Celery task id.

    Deletes the job's existing result (the webhook writes a fresh one — the
    result row is unique per job), resets the job to RUNNING, and re-derives
    the extraction payload from the stored columns and column_plan.
    """
    papers = (
        db.query(Paper)
        .join(ProjectPaper, ProjectPaper.paper_id == Paper.id)
        .filter(ProjectPaper.project_id == job.project_id)
        .all()
    )
    if not papers:
        raise ValueError(f"Job {job.id} has no papers in its project to process")

    columns = list(job.columns or [])
    plan = list(job.column_plan or [])
    computed_entries = [e for e in plan if e.get("kind") == "computed"]
    computed_labels = {e["label"] for e in computed_entries}
    list_labels = {e["label"] for e in plan if e.get("kind") == "list"}

    metadata_plan, prefilled_labels = plan_metadata_columns(
        columns=columns,
        papers=papers,
        computed_labels=computed_labels,
        list_labels=list_labels,
    )
    job.column_plan = (
        computed_entries
        + [{"label": label, "kind": "list"} for label in sorted(list_labels)]
        + metadata_plan
    )

    if job.result:
        db.delete(job.result)

    job.status = JobStatus.RUNNING
    job.error_message = None
    job.started_at = datetime.now(timezone.utc)
    job.completed_at = None
    db.commit()

    data_table = DataTableSchema(
        columns=[
            c for c in columns if c not in computed_labels and c not in prefilled_labels
        ],
        papers=[
            DocumentMapping(
                id=str(p.id), title=str(p.title), s3_object_key=str(p.s3_object_key)
            )
            for p in papers
        ],
        list_columns=sorted(list_labels),
    )
    task_id = jobs_client.submit_data_table_processing_job(
        data_table=data_table, job_id=str(job.id)
    )

    job.task_id = task_id
    db.commit()
    logger.info(f"Resubmitted data table job {job.id} as task {task_id}")
    return task_id
