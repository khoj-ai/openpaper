from enum import Enum
from typing import Dict, List, Union

from pydantic import BaseModel


class ResponseStyle(str, Enum):
    NORMAL = "normal"
    CONCISE = "concise"
    DETAILED = "detailed"


class Evidence(BaseModel):
    """Model for managing evidence gathered from papers"""

    paper_id: str
    content: List[str]

    def add_content(self, content: Union[str, List[str]]) -> None:
        """Add content to the evidence"""
        if isinstance(content, str):
            self.content.append(content)
        else:
            self.content.extend(content)


class EvidenceCollection(BaseModel):
    """Collection of evidence from multiple papers"""

    evidence: Dict[str, Evidence] = {}

    def load_from_dict(self, evidence_dict: Dict[str, List[str]]) -> None:
        """Load evidence from a dictionary format"""
        for paper_id, content in evidence_dict.items():
            self.evidence[paper_id] = Evidence(paper_id=paper_id, content=content)

    def add_evidence(self, paper_id: str, content: Union[str, List[str]]) -> None:
        """Add evidence for a specific paper"""
        if paper_id not in self.evidence:
            self.evidence[paper_id] = Evidence(paper_id=paper_id, content=[])
        self.evidence[paper_id].add_content(content)

    def get_evidence_dict(self) -> Dict[str, List[str]]:
        """Convert to dictionary format for backward compatibility"""
        return {
            paper_id: evidence.content for paper_id, evidence in self.evidence.items()
        }

    def has_evidence(self) -> bool:
        """Check if any evidence has been collected"""
        return bool(self.evidence)
