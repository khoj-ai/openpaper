# Once a set of results is retrieved regarding a hypothesis, we'll want to 1. read relevant papers, 2. extract relevant information, and 3. synthesize the information into a coherent brief that can serve to answer the target question.
import logging
from typing import List

from app.helpers.paper_search import (
    build_abstract_from_inverted_index,
    search_open_alex,
)
from app.helpers.scrape import scrape_web_page
from app.llm.operations import Operations
from app.llm.schemas import (
    HypothesisFanOut,
    HypothesisResearchResults,
    HypothesisStep,
    HypothesisStepResearchResult,
    MinimalPaperData,
    PapersForReference,
    WhatToScrape,
)

logger = logging.getLogger(__name__)

llm_operations = Operations()


def process_question(
    question: str,
):
    hypothesis = llm_operations.augment_hypothesis(question)

    logger.info(f"Generated hypothesis: {hypothesis}")

    research_steps: HypothesisFanOut = llm_operations.generate_steps(
        hypothesis=hypothesis
    )

    logger.info(f"Generated research steps: {research_steps.steps}")

    research_step_results: List[HypothesisStepResearchResult] = []

    paper_reference_idx = 1

    # Run the steps to gather information. Eventually, can be parallelized.
    for step in research_steps.steps:
        logger.info(
            f"Processing step: {step.question} with motivation: {step.motivation}"
        )

        minimal_papers: List[MinimalPaperData] = []
        seen_paper_ids = set()

        # For each step, we have a question, motivation, and search terms.
        for search_term in step.search_terms:
            logger.info(f"Searching for papers with term: {search_term}")
            results = search_open_alex(search_term)

            if not results.results:
                logger.warning(f"No results found for search term: {search_term}")
                continue

            # Package the results into a minimal paper data structure
            minimal_papers.extend(
                [
                    MinimalPaperData(
                        id=paper.id,
                        idx=len(minimal_papers) + paper_reference_idx,
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
                    for paper in results.results
                    if paper.id not in seen_paper_ids
                ]
            )

            # Add the paper IDs to avoid duplicates
            seen_paper_ids.update(paper.id for paper in results.results)

            if not minimal_papers:
                logger.warning(f"No valid papers found for search term: {search_term}")
                continue

        logger.info(
            f"Found {len(minimal_papers)} papers for search term: {search_term}"
        )

        # Choose which of the minimal papers to read based on the hypothesis and steps
        shortlisted_papers: WhatToScrape = llm_operations.select_papers_to_read(
            hypothesis=research_steps.hypothesis,
            question=step.question,
            motivation=step.motivation,
            minimal_papers=minimal_papers,
        )

        papers_to_scrape: List[MinimalPaperData] = [
            paper for paper in minimal_papers if paper.id in shortlisted_papers.ids
        ]

        logger.info(
            f"Selected {len(papers_to_scrape)} papers to scrape for step: {step.question}"
        )

        if not papers_to_scrape:
            logger.warning(f"No papers selected for scraping for step: {step.question}")
            continue

        # Scrape the papers and extract metadata
        for paper in papers_to_scrape:
            logger.info(f"Scraping paper: {paper.title} with DOI: {paper.doi}")
            try:
                # Scrape the URL or DOI to get the full paper content
                paper_content = scrape_web_page(
                    paper.pdf_url or f"https://doi.org/{paper.doi}"
                )

                paper_summary: str | None = llm_operations.summarize_paper(
                    hypothesis=research_steps.hypothesis,
                    question=step.question,
                    motivation=step.motivation,
                    paper=paper_content,
                )

                if not paper_summary:
                    logger.warning(f"No summary extracted for paper: {paper.title}")
                    continue

                paper.raw_text = paper_content

                paper.contextual_summary = paper_summary

                # Update the paper with the summary
                papers_to_scrape[papers_to_scrape.index(paper)] = paper

                logger.info(f"Extracted summary for paper {paper.title}")

            except Exception as e:
                logger.error(f"Error extracting summary from paper {paper.title}: {e}")
                continue

        filtered_papers: List[MinimalPaperData] = [
            paper for paper in papers_to_scrape if paper.contextual_summary
        ]

        if len(filtered_papers) == 0:
            logger.warning(f"No papers with summaries found for step: {step.question}")
            continue

        # Collate all the summaries for this hypothesis step
        papers_for_summary = [
            PapersForReference(
                idx=paper.idx,
                title=paper.title,
                contextual_summary=paper.contextual_summary,
            )
            for paper in filtered_papers
            if paper.contextual_summary
        ]

        findings = llm_operations.collate_findings(
            hypothesis=research_steps.hypothesis, step=step, papers=papers_for_summary
        )

        paper_reference_idx += len(filtered_papers)

        research_result = HypothesisStepResearchResult(
            hypothesis=research_steps.hypothesis,
            step=step,
            papers=filtered_papers,
            findings=findings,
        )
        research_step_results.append(research_result)
        logger.info(f"Completed processing question: {step.question}")

    # Collate all the findings into a final response
    steps_results = [
        {
            "hypothesis": research_steps.hypothesis,
            "step": step.step,
            "findings": step.findings,
        }
        for step in research_step_results
    ]

    final_findings = llm_operations.finalize_hypothesis_research(
        hypothesis=research_steps.hypothesis, steps=steps_results
    )

    logger.info(f"Final findings: {final_findings}")

    return HypothesisResearchResults(
        hypothesis=hypothesis,
        steps_results=research_step_results,
        findings=final_findings,
    )
