import logging
from typing import Sequence

from app.llm.base import BaseLLMClient, ModelType
from app.llm.json_parser import JSONParser
from app.llm.prompts import (
    EXTRACT_RELEVANT_CONTEXT_FROM_PAPER,
    EXTRACT_RELEVANT_FINDINGS_FROM_PAPER_SUMMARIES,
    FINALIZE_HYPOTHESIS_RESEARCH,
    HYPOTHESIS_STEPS,
    IMPROVE_QUESTION_TO_HYPOTHESIS,
    PICK_PAPERS_TO_READ,
)
from app.llm.schemas import (
    HypothesisFanOut,
    HypothesisResearchResponse,
    HypothesisStep,
    MinimalPaperData,
    PapersForReference,
    WhatToScrape,
)
from app.llm.utils import retry_llm_operation

logger = logging.getLogger(__name__)


class HypothesisOperations(BaseLLMClient):
    """Operations related to hypothesis generation and research"""

    @retry_llm_operation(max_retries=3, delay=1.0)
    def augment_hypothesis(self, question: str) -> str:
        """Augment the provided hypothesis using the specified model"""
        formatted_prompt = IMPROVE_QUESTION_TO_HYPOTHESIS.format(question=question)

        augmented_hypothesis = self.generate_content(
            model_type=ModelType.FAST,
            contents=formatted_prompt,
        )

        if augmented_hypothesis and augmented_hypothesis.text:
            return augmented_hypothesis.text.strip()
        raise ValueError("Failed to generate augmented hypothesis from LLM.")

    @retry_llm_operation(max_retries=3, delay=1.0)
    def generate_steps(self, hypothesis: str) -> HypothesisFanOut:
        """Generate steps to test the hypothesis"""
        schema = HypothesisFanOut.model_json_schema()
        formatted_prompt = HYPOTHESIS_STEPS.format(
            hypothesis=hypothesis,
            schema=schema,
        )

        response = self.generate_content(
            model_type=ModelType.FAST,
            contents=formatted_prompt,
        )

        try:
            if response and response.text:
                response_json = JSONParser.validate_and_extract_json(response.text)
                return HypothesisFanOut.model_validate(response_json)
            else:
                raise ValueError("Empty response from LLM.")
        except ValueError as e:
            raise ValueError(f"Invalid JSON response from LLM: {str(e)}")

    @retry_llm_operation(max_retries=3, delay=1.0)
    def select_papers_to_read(
        self,
        hypothesis: str,
        question: str,
        motivation: str,
        minimal_papers: Sequence[MinimalPaperData],
    ) -> WhatToScrape:
        schema = WhatToScrape.model_json_schema()
        formatted_prompt = PICK_PAPERS_TO_READ.format(
            hypothesis=hypothesis,
            question=question,
            motivation=motivation,
            minimal_papers=minimal_papers,
            schema=schema,
        )

        response = self.generate_content(
            model_type=ModelType.FAST,
            contents=formatted_prompt,
        )
        # Check if the response is valid JSON
        try:
            if response and response.text:
                response_json = JSONParser.validate_and_extract_json(response.text)

                # Validate the response against the schema
                return WhatToScrape.model_validate(response_json)
            else:
                raise ValueError("Empty response from LLM while selecting papers.")
        except ValueError as e:
            raise ValueError(f"Invalid JSON response from LLM: {str(e)}")

    @retry_llm_operation(max_retries=3, delay=1.0)
    def summarize_paper(
        self,
        hypothesis: str,
        question: str,
        motivation: str,
        paper: str,
    ) -> str | None:
        """
        Summarize the paper using the specified model
        """
        formatted_prompt = EXTRACT_RELEVANT_CONTEXT_FROM_PAPER.format(
            hypothesis=hypothesis,
            question=question,
            motivation=motivation,
            paper=paper,
        )

        response = self.generate_content(
            model_type=ModelType.FAST,
            contents=formatted_prompt,
        )

        if response and response.text:
            if response.text.strip() == "Skip":
                logger.warning(
                    f"Paper skipped for hypothesis: {hypothesis}, question: {question}"
                )
                return None
            return response.text.strip()
        else:
            raise ValueError(
                f"Empty response from LLM while summarizing paper: {paper[:50]}..."
            )

    @retry_llm_operation(max_retries=3, delay=1.0)
    def collate_findings(
        self,
        hypothesis: str,
        step: HypothesisStep,
        papers: Sequence[PapersForReference],
    ) -> str:
        """
        Collate findings from the papers for the given hypothesis step
        """
        formatted_prompt = EXTRACT_RELEVANT_FINDINGS_FROM_PAPER_SUMMARIES.format(
            hypothesis=hypothesis,
            question=step.question,
            motivation=step.motivation,
            paper_summaries=[paper.model_dump_json() for paper in papers],
        )

        response = self.generate_content(
            model_type=ModelType.FAST,
            contents=formatted_prompt,
        )

        if response and response.text:
            return response.text.strip()
        else:
            raise ValueError("Empty response from LLM while collating findings.")

    @retry_llm_operation(max_retries=3, delay=1.0)
    def finalize_hypothesis_research(
        self,
        hypothesis: str,
        steps: Sequence[dict],
    ) -> HypothesisResearchResponse:
        """
        Finalize the hypothesis research by collating findings from all steps.
        """
        formatted_prompt = FINALIZE_HYPOTHESIS_RESEARCH.format(
            hypothesis=hypothesis,
            steps_results=steps,
            schema=HypothesisResearchResponse.model_json_schema(),
        )

        response = self.generate_content(
            contents=formatted_prompt,
        )

        try:
            if response and response.text:
                response_json = JSONParser.validate_and_extract_json(response.text)
                # Validate the response against the schema
                return HypothesisResearchResponse.model_validate(response_json)
            else:
                raise ValueError(
                    "Empty response from LLM while finalizing hypothesis research."
                )
        except ValueError as e:
            logger.error(
                f"Error finalizing hypothesis research: {str(e)}", exc_info=True
            )
            raise ValueError(f"Invalid JSON response from LLM: {str(e)}")
