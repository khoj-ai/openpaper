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
from app.llm.operations import Operations
from app.llm.schemas import (
    HypothesisFanOut,
    HypothesisResearchResponse,
    HypothesisStep,
    MinimalPaperData,
    PapersForReference,
    WhatToScrape,
)
from sqlalchemy import func

logger = logging.getLogger(__name__)
llm_operations = Operations()


def process_hypothesis(job_id: UUID, user_id: UUID) -> None:
    """Process hypothesis research in the background with database tracking"""
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

        paper_reference_idx = 1
        completed_steps = 0

        # Process each research step
        for step_order, step in enumerate(research_steps.steps):
            logger.info(f"Processing step {step_order + 1}: {step.question}")

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
                db=db,
                step_id=db_step_id,
                status=JobStatus.RUNNING,
                started_at=func.now(),
            )

            try:
                # Search for papers
                minimal_papers: List[MinimalPaperData] = []
                seen_paper_ids = set()

                for search_term in step.search_terms:
                    logger.info(f"Searching for papers with term: {search_term}")
                    results = search_open_alex(search_term)

                    if not results.results:
                        logger.warning(
                            f"No results found for search term: {search_term}"
                        )
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
                                    if paper.primary_location
                                    and paper.primary_location.pdf_url
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
                    completed_steps += 1
                    continue

                logger.info(f"Found {len(minimal_papers)} papers for step")

                # Select papers to scrape
                shortlisted_papers: WhatToScrape = llm_operations.select_papers_to_read(
                    hypothesis=research_steps.hypothesis,
                    question=step.question,
                    motivation=step.motivation,
                    minimal_papers=minimal_papers,
                )

                papers_to_scrape: List[MinimalPaperData] = [
                    paper
                    for paper in minimal_papers
                    if paper.id in shortlisted_papers.ids
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
                    logger.warning(
                        f"No papers selected for scraping for step: {step.question}"
                    )
                    hypothesis_crud.update_step_status(
                        db=db,
                        step_id=db_step_id,
                        status=JobStatus.COMPLETED,
                        findings="No papers were selected for detailed analysis.",
                        completed_at=func.now(),
                    )
                    completed_steps += 1
                    continue

                # Scrape and summarize papers
                filtered_papers: List[MinimalPaperData] = []

                for paper in papers_to_scrape:
                    logger.info(f"Scraping paper: {paper.title}")

                    # Update database - mark scraping attempted
                    hypothesis_crud.update_paper_scraping(
                        db=db,
                        step_id=db_step_id,
                        external_id=paper.id,
                        scraping_attempted=True,
                    )

                    try:
                        # Scrape the paper
                        paper_content = scrape_web_page(
                            paper.pdf_url or f"https://doi.org/{paper.doi}"
                        )

                        # Generate summary
                        paper_summary = llm_operations.summarize_paper(
                            hypothesis=research_steps.hypothesis,
                            question=step.question,
                            motivation=step.motivation,
                            paper=paper_content,
                        )

                        if paper_summary:
                            paper.raw_text = paper_content
                            paper.contextual_summary = paper_summary
                            paper.idx = paper_reference_idx
                            paper_reference_idx += 1

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
                            logger.warning(
                                f"No summary generated for paper: {paper.title}"
                            )

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

                    # Retrieve the top 5 papers and pass their abstracts as the contextual summary if no summaries were generated
                    top_papers = minimal_papers[:5]
                    for paper in top_papers:
                        if paper.abstract:
                            paper.contextual_summary = (
                                paper.abstract or "No abstract available"
                            )
                            paper.idx = paper_reference_idx
                            paper_reference_idx += 1
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
                        completed_steps += 1
                        continue

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

                findings = llm_operations.collate_findings(
                    hypothesis=research_steps.hypothesis,
                    step=step,
                    papers=papers_for_summary,
                )

                # Update step with findings
                hypothesis_crud.update_step_status(
                    db=db,
                    step_id=db_step_id,
                    status=JobStatus.COMPLETED,
                    findings=findings,
                    completed_at=func.now(),
                )

                completed_steps += 1

                # Update job progress
                hypothesis_crud.update_job_status(
                    db=db,
                    job_id=job_id,
                    status=JobStatus.RUNNING,
                    completed_steps=completed_steps,
                )

                logger.info(f"Completed step {step_order + 1}: {step.question}")

            except Exception as e:
                logger.error(f"Error processing step {step.question}: {e}")
                hypothesis_crud.update_step_status(
                    db=db,
                    step_id=db_step_id,
                    status=JobStatus.FAILED,
                    error_message=str(e),
                    completed_at=func.now(),
                )
                completed_steps += 1

        # Generate final findings
        logger.info("Generating final findings")

        # Get all completed steps with findings
        job_with_steps = hypothesis_crud.get_job_by_id(
            db=db, job_id=str(job_id), user_id=user_id
        )

        if not job_with_steps:
            logger.error(f"Job {job_id} not found after processing steps")
            return

        completed_steps = (
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
            for step in completed_steps
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

        # Update job with final status (remove final_findings parameter)
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
