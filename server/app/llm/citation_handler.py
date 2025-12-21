import re
from typing import List, Optional, Sequence, Union

from app.schemas.responses import ResponseCitation


class CitationHandler:
    """Handles citation formatting and reference management"""

    @staticmethod
    def format_citations(citations: list[dict]) -> str:
        """Format citations into a structured string"""
        citation_format = "---EVIDENCE---\n"
        formatted_citations = []

        for citation in citations:
            if "paper_id" in citation:
                # Multi-paper format: @cite[key|paper_id]
                cite_marker = f"@cite[{citation['key']}|{citation['paper_id']}]"
            else:
                # Single paper format: @cite[key]
                cite_marker = f"@cite[{citation['key']}]"

            formatted_citations.append(f"{cite_marker}\n{citation['reference']}")

        citation_format += "\n".join(formatted_citations)
        citation_format += "\n---END-EVIDENCE---"
        return citation_format

    @staticmethod
    def convert_references_to_dict(references: Sequence[str]) -> dict:
        """Convert user references to structured citations. Currently only used for user citations."""
        citations = []
        for idx, ref in enumerate(references):
            citation = {
                "key": idx + 1,
                "reference": ref,
            }
            citations.append(citation)
        return {"citations": citations}

    @staticmethod
    def convert_references_to_citations(references: Optional[Sequence[str]]) -> str:
        """Convert user references to structured citations. Currently only used for user citations."""
        if not references:
            return ""
        return CitationHandler.format_citations(
            CitationHandler.convert_references_to_dict(references)["citations"]
        )

    @staticmethod
    def parse_evidence_block(evidence_text: str) -> list[dict]:
        """
        Parse evidence block into structured citations
        Handles multi-line citations between @cite markers

        Incoming format of evidence_text:
        @cite[1]
        "First piece of evidence"
        @cite[2]
        "Second piece of evidence"
        """
        citations = []
        lines = evidence_text.strip().split("\n")
        current_citation: dict[str, Union[int, str]] | None = None
        current_text_lines: list[str] = []

        for line in lines:
            line = line.strip()
            if line.startswith("@cite["):
                # If we have a previous citation pending, save it
                if current_citation is not None:
                    current_citation["reference"] = " ".join(current_text_lines).strip()
                    citations.append(current_citation)

                # Start new citation
                match = re.search(r"@cite\[(\d+)\]", line)
                if match:
                    number = int(match.group(1))
                    current_citation = {"key": number, "reference": ""}
                    current_text_lines = []
            elif current_citation is not None and line:
                # Accumulate lines for the current citation
                current_text_lines.append(line)

        # Don't forget to save the last citation
        if current_citation is not None and current_text_lines:
            current_citation["reference"] = " ".join(current_text_lines).strip()
            citations.append(current_citation)

        return citations

    @staticmethod
    def convert_response_citation_to_paper_citation(
        response_citations: List[ResponseCitation],
    ):
        """Convert ResponseCitation objects to structured citation dicts"""
        citations = []
        for resp_citation in response_citations:
            citation = {
                "key": resp_citation.index,
                "reference": resp_citation.text,
                "paper_id": resp_citation.paper_id,
            }
            citations.append(citation)
        return {"citations": citations}

    @staticmethod
    def parse_multi_paper_evidence_block(evidence_text: str) -> list[dict]:
        """
        Parse evidence block into structured citations from multiple papers.
        Handles multi-line citations between @cite markers

        Incoming format of evidence_text:
        @cite[1|paper_id]
        "First piece of evidence"
        @cite[2|paper_id]
        "Second piece of evidence"
        """
        citations = []
        lines = evidence_text.strip().split("\n")
        current_citation: dict[str, Union[int, str]] | None = None
        current_text_lines: list[str] = []

        for line in lines:
            line = line.strip()
            if line.startswith("@cite["):
                # If we have a previous citation pending, save it
                if current_citation is not None:
                    current_citation["reference"] = " ".join(current_text_lines).strip()
                    citations.append(current_citation)

                # Start new citation
                match = re.search(r"@cite\[(\d+)\|([^]]+)\]", line)
                if match:
                    number = int(match.group(1))
                    paper_id = match.group(2)
                    current_citation = {
                        "key": number,
                        "reference": "",
                        "paper_id": paper_id,
                    }
                    current_text_lines = []
            elif current_citation is not None and line:
                # Accumulate lines for the current citation
                current_text_lines.append(line)

        # Don't forget to save the last citation
        if current_citation is not None and current_text_lines:
            current_citation["reference"] = " ".join(current_text_lines).strip()
            citations.append(current_citation)

        return citations
