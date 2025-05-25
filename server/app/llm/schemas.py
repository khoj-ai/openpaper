from typing import List, Optional

from pydantic import BaseModel, Field


class PaperMetadataExtraction(BaseModel):
    title: str = Field(description="Title of the paper in normal case")
    authors: List[str] = Field(default=[], description="List of authors")
    abstract: str = Field(default="", description="Abstract of the paper")
    institutions: List[str] = Field(
        default=[], description="List of institutions involved in the publication."
    )
    keywords: List[str] = Field(default=[], description="List of keywords")
    summary: str = Field(
        default="",
        description="""
A concise, well-structured summary of the paper in markdown format. Include:
1. Key findings and contributions
2. Research methodology
3. Results and implications
4. Potential applications or impact

Format guidelines:
- First paragraph: 2-4 sentence overview of the paper
- Use clear headings, bullet points, and tables for organization
- Include relevant data points and metrics when available
- Use plain language while preserving technical accuracy
- Optional brief title (under 10 words)

The summary should be accessible to readers with basic domain knowledge while maintaining scientific integrity.
                         """,
    )
    publish_date: Optional[str] = Field(
        default=None, description="Publishing date of the paper in YYYY-MM-DD format"
    )
    starter_questions: List[str] = Field(
        default=[],
        description="""
        List of starter questions for discussion.
        These should be open-ended questions that can guide further exploration of the paper's content and implications.
        They should help elicit a better understanding of the paper's findings, methodology, and potential applications.
        """,
    )


class HypothesisStep(BaseModel):
    question: str = Field(
        description="The sub-question to ask about the hypothesis, which will be used to retrieve relevant papers. Limit to 1 sentence per question to ensure clarity and focus."
    )
    motivation: str = Field(
        description="The motivation behind the sub-question, explaining why it is relevant to the hypothesis. Limit to 200 characters to ensure a good research trajectory."
    )
    search_terms: List[str] = Field(
        description="List of search terms to use when querying the research API for papers related to this sub-question. Minimum 1 and maximum 3 search terms per step to ensure focused exploration.",
    )


class HypothesisFanOut(BaseModel):
    hypothesis: str = Field(
        description="The target hypothesis to be explored, which will be broken down into sub-questions."
    )
    steps: List[HypothesisStep] = Field(
        description="List of sub-steps derived from the hypothesis for further exploration. Limit to 3 steps per hypothesis to ensure focused exploration.",
    )


class MinimalPaperData(BaseModel):
    """
    Minimal data structure for paper metadata, used for quick lookups and references.
    """

    id: str = Field(description="Unique identifier for the paper")
    idx: int = Field(
        description="Index of the paper in the list, used for referencing purposes. Use this index to refer to the paper in discussions or findings."
    )
    title: str = Field(description="Title of the paper")
    doi: Optional[str] = Field(default=None, description="DOI of the paper")
    publication_year: int = Field(description="Year of publication")
    pdf_url: str = Field(description="URL to the PDF of the paper")
    abstract: Optional[str] = Field(default=None, description="Abstract of the paper")
    cited_by_count: Optional[int] = Field(
        default=None,
        description="Number of times the paper has been cited, if available. This can be useful for understanding the impact of the paper.",
    )
    contextual_summary: Optional[str] = Field(
        default=None,
        description="Extracted summary of the paper, if available. This should be a concise summary that captures the essence of the paper's findings and contributions.",
    )
    raw_text: Optional[str] = Field(
        default=None,
        description="Raw text of the paper, if available. This can be used for further processing or analysis.",
    )


class WhatToScrape(BaseModel):
    """
    Schema for specifying what papers to scrape based on a hypothesis, based on the provided MinimalPaperData objects from candidate papers.
    """

    ids: List[str] = Field(
        description="List of paper IDs to scrape based on the hypothesis and steps. These IDs should correspond to the MinimalPaperData objects."
    )


class HypothesisStepResearchResult(BaseModel):
    """
    Schema for the result of hypothesis research, including the findings from the research step.
    """

    hypothesis: str = Field(
        description="The hypothesis being explored in this research step. This should be a clear and concise statement that encapsulates the main idea being investigated."
    )
    step: HypothesisStep = Field(
        description="The specific step in the hypothesis exploration, including the question, motivation, and search terms used to retrieve relevant papers."
    )
    papers: List[MinimalPaperData] = Field(
        description="List of MinimalPaperData objects representing the papers scraped for this research step. These papers should be relevant to the hypothesis and the specific step being explored."
    )
    findings: str = Field(
        description="The findings from this research step, summarizing the key insights and conclusions drawn from the papers scraped. Be sure to synthesize the information from across the papers to provide a coherent summary."
    )


class PapersForReference(BaseModel):
    """
    Schema for a list of papers that can be referenced in the hypothesis research.
    This is used to provide context and background information for the hypothesis exploration.
    """

    idx: int = Field(
        description="Index of the paper in the list, used for referencing purposes. Use this index to refer to the paper in discussions or findings."
    )
    title: str = Field(description="Title of the paper")
    contextual_summary: str = Field(
        description="A brief summary of the paper's content, focusing on its relevance to the hypothesis and research steps. This should be a concise overview that captures the essence of the paper's findings and contributions."
    )


class HypothesisResearchResponse(BaseModel):
    motivation: str = Field(
        description="The motivation behind the hypothesis research, explaining why this hypothesis is important and worth exploring. This should be a concise statement that captures the essence of the research motivation, ideally in 1-2 sentences."
    )
    methodology: str = Field(
        description="The methodology used to explore the hypothesis, including the steps taken and the rationale behind them in Markdown format. This should provide a clear and structured overview of how the research was conducted, including any specific approaches or techniques used to analyze the papers."
    )
    findings: str = Field(
        description="The final findings from the hypothesis research, summarizing the key insights and conclusions drawn from the research steps. This should should be in Markdown format."
    )
    limitations: List[str] = Field(
        default=[],
        description="List of limitations or gaps in the research that were identified during the process. These should be specific and actionable, highlighting areas where further research is needed or where the current research may have limitations. The limitations should be a list of strings in plaintext format, each string representing a specific limitation or gap in the research. Do not include any special characters or formatting in the limitations list, just plain text strings.",
    )
    future_research: List[str] = Field(
        default=[],
        description="List of suggestions for future research or unanswered questions that emerged from the findings. These should be specific and actionable, providing clear directions for further exploration. The future research suggestions should be a list of strings in plaintext format, each string representing a specific suggestion or question for future research. Do not include any special characters or formatting in the future research suggestions list, just plain text strings.",
    )


class HypothesisResearchResults(BaseModel):
    """
    Schema for the overall results of hypothesis research, including all steps and their findings.
    """

    hypothesis: str = Field(description="The original hypothesis being explored.")
    steps_results: List[HypothesisStepResearchResult] = Field(
        description="List of research results for each step in the hypothesis exploration. Each result should include the findings from the papers scraped for that step."
    )
    findings: HypothesisResearchResponse = Field(
        description="The overall findings from the hypothesis research, synthesizing the results from all steps."
    )
