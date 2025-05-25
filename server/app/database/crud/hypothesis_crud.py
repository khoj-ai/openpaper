from typing import List, Optional
from uuid import UUID

from app.database.models import (
    HypothesisJob,
    HypothesisResearchResult,
    HypothesisStep,
    HypothesisStepPaper,
    JobStatus,
)
from sqlalchemy.orm import Session, joinedload


class HypothesisCRUD:
    def create_job(self, db: Session, user_id: UUID, question: str) -> HypothesisJob:
        """Create a new hypothesis research job"""
        job = HypothesisJob(
            user_id=user_id, original_question=question, status=JobStatus.PENDING
        )
        db.add(job)
        db.commit()
        db.refresh(job)
        return job

    def get_job_by_id(
        self, db: Session, job_id: str, user_id: UUID
    ) -> Optional[HypothesisJob]:
        """Get a job by ID, ensuring it belongs to the user"""
        return (
            db.query(HypothesisJob)
            .options(
                joinedload(HypothesisJob.steps).joinedload(HypothesisStep.papers),
                joinedload(HypothesisJob.research_result),
            )
            .filter(HypothesisJob.id == job_id, HypothesisJob.user_id == user_id)
            .first()
        )

    def update_job_status(
        self, db: Session, job_id: UUID, status: JobStatus, **kwargs
    ) -> None:
        """Update job status and other fields"""
        update_data = {"status": status, **kwargs}
        db.query(HypothesisJob).filter(HypothesisJob.id == job_id).update(update_data)
        db.commit()

    def create_step(
        self,
        db: Session,
        job_id: UUID,
        question: str,
        motivation: str,
        search_terms: List[str],
        step_order: int,
    ) -> HypothesisStep:
        """Create a new hypothesis step"""
        step = HypothesisStep(
            job_id=job_id,
            question=question,
            motivation=motivation,
            search_terms=search_terms,
            step_order=step_order,
        )
        db.add(step)
        db.commit()
        db.refresh(step)
        return step

    def create_step_paper(
        self, db: Session, step_id: UUID, paper_data: dict
    ) -> HypothesisStepPaper:
        """Create a paper record for a step"""
        paper = HypothesisStepPaper(step_id=step_id, **paper_data)
        db.add(paper)
        db.commit()
        db.refresh(paper)
        return paper

    def update_step_status(
        self, db: Session, step_id: UUID, status: JobStatus, **kwargs
    ) -> None:
        """Update step status and other fields"""
        update_data = {"status": status, **kwargs}
        db.query(HypothesisStep).filter(HypothesisStep.id == step_id).update(
            update_data
        )
        db.commit()

    def update_paper_selection(
        self,
        db: Session,
        step_id: UUID,
        external_id: str,
        was_selected_for_scraping: bool,
    ) -> None:
        """Update paper selection status"""
        db.query(HypothesisStepPaper).filter(
            HypothesisStepPaper.step_id == step_id,
            HypothesisStepPaper.external_id == external_id,
        ).update({"was_selected_for_scraping": was_selected_for_scraping})
        db.commit()

    def update_paper_scraping(
        self, db: Session, step_id: UUID, external_id: str, **kwargs
    ) -> None:
        """Update paper scraping results"""
        db.query(HypothesisStepPaper).filter(
            HypothesisStepPaper.step_id == step_id,
            HypothesisStepPaper.external_id == external_id,
        ).update(kwargs)
        db.commit()

    def create_research_result(
        self,
        db: Session,
        job_id: UUID,
        motivation: str,
        methodology: str,
        findings: str,
        limitations: List[str] = [],
        future_research: List[str] = [],
    ) -> HypothesisResearchResult:
        """Create a research result for a hypothesis job"""
        result = HypothesisResearchResult(
            job_id=job_id,
            motivation=motivation,
            methodology=methodology,
            findings=findings,
            limitations=limitations,
            future_research=future_research,
        )
        db.add(result)
        db.commit()
        db.refresh(result)
        return result


hypothesis_crud = HypothesisCRUD()
