import logging
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from uuid import UUID

from app.database.crud.hypothesis_crud import hypothesis_crud
from app.database.database import SessionLocal
from app.database.models import HypothesisStep as HypothesisStepDB
from app.database.models import JobStatus
from app.llm.operations import Operations
from app.llm.schemas import HypothesisFanOut, HypothesisResearchResponse, HypothesisStep
from app.tasks.hypothesis_step import process_hypothesis_step
from sqlalchemy import func

logger = logging.getLogger(__name__)
llm_operations = Operations()


def process_hypothesis(job_id: UUID, user_id: UUID) -> None:
    """
    Process hypothesis research in the background with database tracking
    TODO: Add retry logic for failed steps and papers
    """
    try:
        db = SessionLocal()
        logger.info(f"Starting hypothesis research for job {job_id} by user {user_id}")

        # Get the job
        job = hypothesis_crud.get_job_by_id(db=db, job_id=str(job_id), user_id=user_id)
        if not job:
            logger.error(f"Job {job_id} not found")
            return

        # Update job status to running
        hypothesis_crud.update_job_status(
            db=db, job_id=job_id, status=JobStatus.RUNNING, started_at=func.now()
        )

        # Step 1: Generate hypothesis
        logger.info(f"Generating hypothesis for question: {job.original_question}")
        hypothesis = llm_operations.augment_hypothesis(job.original_question)

        # Update job with generated hypothesis
        hypothesis_crud.update_job_status(
            db=db,
            job_id=job_id,
            status=JobStatus.RUNNING,
            generated_hypothesis=hypothesis,
        )

        logger.info(f"Generated hypothesis: {hypothesis}")

        # Step 2: Generate research steps
        research_steps: HypothesisFanOut = llm_operations.generate_steps(
            hypothesis=hypothesis
        )

        # Update job with total steps count
        hypothesis_crud.update_job_status(
            db=db,
            job_id=job_id,
            status=JobStatus.RUNNING,
            total_steps=len(research_steps.steps),
        )

        logger.info(f"Generated {len(research_steps.steps)} research steps")

        completed_steps_count = 0
        completed_steps_lock = threading.Lock()

        def process_step_with_progress(step_order, step):
            nonlocal completed_steps_count
            success = process_hypothesis_step(
                job_id=job_id,
                step=step,
                step_order=step_order,
                hypothesis=research_steps.hypothesis,
            )

            if not success:
                logger.error(
                    f"Failed to process step {step_order + 1} for job {job_id}"
                )

            # Thread-safe progress update
            with completed_steps_lock:
                completed_steps_count += 1
                current_completed = completed_steps_count

            # Update job progress
            hypothesis_crud.update_job_status(
                db=db,
                job_id=job_id,
                status=JobStatus.RUNNING,
                completed_steps=current_completed,
            )

            return success

        # Use ThreadPoolExecutor to run steps in parallel
        with ThreadPoolExecutor(
            max_workers=5
        ) as executor:  # Adjust max_workers as needed
            # Submit all tasks
            future_to_step = {
                executor.submit(process_step_with_progress, step_order, step): (
                    step_order,
                    step,
                )
                for step_order, step in enumerate(research_steps.steps)
            }

            # Wait for all tasks to complete
            for future in as_completed(future_to_step):
                step_order, step = future_to_step[future]
                try:
                    success = future.result()
                    logger.info(
                        f"Completed step {step_order + 1} with success: {success}"
                    )
                except Exception as exc:
                    logger.error(f"Step {step_order + 1} generated an exception: {exc}")

        # Generate final findings
        logger.info("Generating final findings")

        # Get all completed steps with findings
        job_with_steps = hypothesis_crud.get_job_by_id(
            db=db, job_id=str(job_id), user_id=user_id
        )

        if not job_with_steps:
            logger.error(f"Job {job_id} not found after processing steps")
            return

        completed_step_records = (
            db.query(HypothesisStepDB)
            .filter(
                HypothesisStepDB.job_id == job_id,
                HypothesisStepDB.status == JobStatus.COMPLETED,
                HypothesisStepDB.findings.isnot(None),
            )
            .all()
        )

        steps_results = [
            {
                "hypothesis": hypothesis,
                "step": HypothesisStep(
                    question=step.question,
                    motivation=step.motivation,
                    search_terms=step.search_terms,
                ),
                "findings": step.findings,
            }
            for step in completed_step_records
        ]

        if steps_results:
            final_findings_response: HypothesisResearchResponse = (
                llm_operations.finalize_hypothesis_research(
                    hypothesis=hypothesis, steps=steps_results
                )
            )

            # Create research result record
            research_result_data = {
                "job_id": job_id,
                "motivation": final_findings_response.motivation,
                "methodology": final_findings_response.methodology,
                "findings": final_findings_response.findings,
                "limitations": final_findings_response.limitations,
                "future_research": final_findings_response.future_research,
            }

            hypothesis_crud.create_research_result(db=db, **research_result_data)
        else:
            # Create a minimal research result for failed case
            research_result_data = {
                "job_id": job_id,
                "motivation": "Research could not be completed due to insufficient data.",
                "methodology": "No research steps were successfully completed.",
                "findings": "Unable to generate findings due to insufficient processed research steps.",
                "limitations": ["Insufficient data from research steps"],
                "future_research": ["Retry with different search terms or methodology"],
            }

            hypothesis_crud.create_research_result(db=db, **research_result_data)

        # Update job with final status
        hypothesis_crud.update_job_status(
            db=db, job_id=job_id, status=JobStatus.COMPLETED, completed_at=func.now()
        )

        logger.info(f"Completed hypothesis research for job {job_id}")

    except Exception as e:
        logger.error(f"Error processing hypothesis job {job_id}: {e}", exc_info=True)
        hypothesis_crud.update_job_status(
            db=db,
            job_id=job_id,
            status=JobStatus.FAILED,
            error_message=str(e),
            completed_at=func.now(),
        )
    finally:
        db.close()
