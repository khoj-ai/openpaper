import logging
from typing import List, cast
from uuid import UUID

from app.database.crud.hypothesis_crud import hypothesis_crud
from app.database.database import SessionLocal
from app.database.models import HypothesisStep as HypothesisStepDB
from app.database.models import JobStatus
from app.helpers.paper_search import (
    build_abstract_from_inverted_index,
    search_open_alex,
)
from app.helpers.scrape import scrape_web_page
from app.llm.operations import operations
from app.schemas.responses import (
    HypothesisStep,
    MinimalPaperData,
    PapersForReference,
    WhatToScrape,
)
from sqlalchemy import func
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

DEFAULT_NUM_PAPERS_TO_COLLATE = 5  # Default number of papers to scrape per step


def process_hypothesis_step(
    job_id: UUID,
    step: HypothesisStep,
    step_order: int,
    hypothesis: str,
) -> bool:
    """
    Process a single hypothesis research step.

    Returns:
        bool: (success)
    """
    # TODO change this to use the helper methods
    db = SessionLocal()
    logger.info(f"Processing hypothesis step {step_order + 1}: {step.question}")

    # Create step record in database
    db_step: HypothesisStepDB = hypothesis_crud.create_step(
        db=db,
        job_id=job_id,
        question=step.question,
        motivation=step.motivation,
        search_terms=step.search_terms,
        step_order=step_order,
    )

    assert db_step is not None, "Failed to create step in database"
    logger.info(f"Created step {db_step.id} for question: {step.question}")

    db_step_id = cast(UUID, db_step.id)

    # Update step status to running
    hypothesis_crud.update_step_status(
        db=db, step_id=db_step_id, status=JobStatus.RUNNING, started_at=func.now()
    )

    try:
        # Search for papers
        minimal_papers: List[MinimalPaperData] = []
        seen_paper_ids = set()

        for search_term in step.search_terms:
            logger.info(f"Searching for papers with term: {search_term}")
            results = search_open_alex(search_term)

            if not results.results:
                logger.warning(f"No results found for search term: {search_term}")
                continue

            # Package results and save to database
            for paper in results.results:
                if paper.id not in seen_paper_ids:
                    minimal_paper = MinimalPaperData(
                        id=paper.id,
                        title=paper.title,
                        abstract=(
                            build_abstract_from_inverted_index(
                                paper.abstract_inverted_index
                            )
                            if paper.abstract_inverted_index
                            else None
                        ),
                        publication_year=paper.publication_year,
                        pdf_url=(
                            paper.primary_location.pdf_url
                            if paper.primary_location and paper.primary_location.pdf_url
                            else f"{paper.doi}"
                        ),
                        doi=paper.doi,
                        cited_by_count=paper.cited_by_count,
                    )

                    # Save paper to database
                    paper_data = {
                        "external_id": paper.id,
                        "title": paper.title,
                        "abstract": minimal_paper.abstract,
                        "publication_year": paper.publication_year,
                        "pdf_url": minimal_paper.pdf_url,
                        "doi": paper.doi,
                        "cited_by_count": paper.cited_by_count,
                        "was_selected_for_scraping": False,
                        "scraping_attempted": False,
                        "scraping_successful": False,
                    }

                    db_paper = hypothesis_crud.create_step_paper(
                        db=db, step_id=db_step_id, paper_data=paper_data
                    )

                    minimal_papers.append(minimal_paper)
                    seen_paper_ids.add(paper.id)

        if not minimal_papers:
            logger.warning(f"No papers found for step: {step.question}")
            hypothesis_crud.update_step_status(
                db=db,
                step_id=db_step_id,
                status=JobStatus.COMPLETED,
                findings="No papers found for this research step.",
                completed_at=func.now(),
            )
            return True

        logger.info(f"Found {len(minimal_papers)} papers for step")

        # Select papers to scrape
        shortlisted_papers: WhatToScrape = operations.select_papers_to_read(
            hypothesis=hypothesis,
            question=step.question,
            motivation=step.motivation,
            minimal_papers=minimal_papers,
        )

        papers_to_scrape: List[MinimalPaperData] = [
            paper for paper in minimal_papers if paper.id in shortlisted_papers.ids
        ]

        # Update database - mark selected papers
        for paper in papers_to_scrape:
            hypothesis_crud.update_paper_selection(
                db=db,
                step_id=db_step_id,
                external_id=paper.id,
                was_selected_for_scraping=True,
            )

        logger.info(f"Selected {len(papers_to_scrape)} papers to scrape")

        if not papers_to_scrape:
            logger.warning(f"No papers selected for scraping for step: {step.question}")
            hypothesis_crud.update_step_status(
                db=db,
                step_id=db_step_id,
                status=JobStatus.COMPLETED,
                findings="No papers were selected for detailed analysis.",
                completed_at=func.now(),
            )
            return True

        # Scrape and summarize papers
        filtered_papers: List[MinimalPaperData] = []

        for paper in papers_to_scrape:
            logger.info(f"Scraping paper: {paper.title}")

            # Update database - mark scraping attempted
            hypothesis_crud.update_paper_scraping(
                db=db, step_id=db_step_id, external_id=paper.id, scraping_attempted=True
            )

            try:
                # Scrape the paper
                paper_content = scrape_web_page(
                    paper.pdf_url or f"https://doi.org/{paper.doi}"
                )

                # Generate summary
                paper_summary = operations.summarize_paper(
                    hypothesis=hypothesis,
                    question=step.question,
                    motivation=step.motivation,
                    paper=paper_content,
                )

                if paper_summary:
                    # Get next available reference index from database
                    reference_idx = hypothesis_crud.get_next_reference_idx(db, job_id)

                    paper.raw_text = paper_content
                    paper.contextual_summary = paper_summary
                    paper.idx = reference_idx

                    filtered_papers.append(paper)

                    # Update database with successful scraping and summary
                    hypothesis_crud.update_paper_scraping(
                        db=db,
                        step_id=db_step_id,
                        external_id=paper.id,
                        scraping_successful=True,
                        raw_text=paper_content,
                        contextual_summary=paper_summary,
                        reference_idx=paper.idx,
                        scraped_at=func.now(),
                        summarized_at=func.now(),
                    )

                    logger.info(f"Successfully processed paper: {paper.title}")
                else:
                    logger.warning(f"No summary generated for paper: {paper.title}")

            except Exception as e:
                logger.error(f"Error processing paper {paper.title}: {e}")
                hypothesis_crud.update_paper_scraping(
                    db=db,
                    step_id=db_step_id,
                    external_id=paper.id,
                    scraping_successful=False,
                    scraping_error=str(e),
                )

        if not filtered_papers:
            logger.warning(
                f"No papers successfully summarized for step: {step.question}"
            )

            # Retrieve the top papers and pass their abstracts as the contextual summary if no summaries were generated
            top_papers = minimal_papers[:DEFAULT_NUM_PAPERS_TO_COLLATE]
            for paper in top_papers:
                if paper.abstract:
                    reference_idx = hypothesis_crud.get_next_reference_idx(db, job_id)

                    paper.contextual_summary = paper.abstract or "No abstract available"
                    paper.idx = reference_idx

                    hypothesis_crud.update_paper_scraping(
                        db=db,
                        step_id=db_step_id,
                        external_id=paper.id,
                        scraping_successful=True,
                        contextual_summary=paper.contextual_summary,
                        reference_idx=paper.idx,
                        scraped_at=func.now(),
                        summarized_at=func.now(),
                    )

            filtered_papers = [
                paper for paper in top_papers if paper.contextual_summary
            ]

            if not filtered_papers:
                logger.warning(
                    f"No papers could be processed for step: {step.question}"
                )

                # Update step status with findings indicating failure to process papers
                hypothesis_crud.update_step_status(
                    db=db,
                    step_id=db_step_id,
                    status=JobStatus.COMPLETED,
                    findings="Papers were found but could not be successfully processed.",
                    completed_at=func.now(),
                )
                return True

        # Generate findings for this step
        papers_for_summary = [
            PapersForReference(
                idx=paper.idx,
                title=paper.title,
                contextual_summary=paper.contextual_summary,
            )
            for paper in filtered_papers
            if paper.contextual_summary and paper.idx
        ]

        findings = operations.collate_findings(
            hypothesis=hypothesis, step=step, papers=papers_for_summary
        )

        # Update step with findings
        hypothesis_crud.update_step_status(
            db=db,
            step_id=db_step_id,
            status=JobStatus.COMPLETED,
            findings=findings,
            completed_at=func.now(),
        )

        logger.info(f"Completed step {step_order + 1}: {step.question}")
        return True

    except Exception as e:
        logger.error(f"Error processing step {step.question}: {e}")
        hypothesis_crud.update_step_status(
            db=db,
            step_id=db_step_id,
            status=JobStatus.FAILED,
            error_message=str(e),
            completed_at=func.now(),
        )
        return False
