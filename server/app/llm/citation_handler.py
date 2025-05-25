import re
from typing import Dict, List, Optional, Sequence


class CitationHandler:
    """Handles citation formatting and reference management"""

    @staticmethod
    def convert_references_to_dict(references: Sequence[str]) -> dict:
        """Convert user references to structured citations"""
        citations = []
        for idx, ref in enumerate(references):
            citations.append(
                {
                    "key": idx + 1,
                    "reference": ref,
                }
            )
        return {"citations": citations}

    @staticmethod
    def convert_references_to_citations(references: Optional[Sequence[str]]) -> str:
        """Convert user references to structured citations"""
        if not references:
            return ""
        return CitationHandler.format_citations(
            CitationHandler.convert_references_to_dict(references)["citations"]
        )

    @staticmethod
    def format_citations(citations: list[dict]) -> str:
        """Format citations into a structured string"""
        citation_format = "---EVIDENCE---\n"
        citation_format += "\n".join(
            [
                f"@cite[{citation['key']}]\n{citation['reference']}"
                for citation in citations
            ]
        )
        citation_format += "\n---END-EVIDENCE---"
        return citation_format

    @staticmethod
    def parse_evidence_block(evidence_text: str) -> list[dict]:
        """Parse evidence block into structured citations"""
        citations = []
        lines = evidence_text.strip().split("\n")
        current_citation = None
        current_text_lines = []

        for line in lines:
            line = line.strip()
            if line.startswith("@cite["):
                if current_citation is not None:
                    current_citation["reference"] = " ".join(current_text_lines).strip()
                    citations.append(current_citation)

                match = re.search(r"@cite\[(\d+)\]", line)
                if match:
                    number = int(match.group(1))
                    current_citation = {"key": number, "reference": ""}
                    current_text_lines = []
            elif current_citation is not None and line:
                current_text_lines.append(line)

        if current_citation is not None and current_text_lines:
            current_citation["reference"] = " ".join(current_text_lines).strip()
            citations.append(current_citation)

        return citations
