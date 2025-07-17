from enum import Enum
from typing import Dict, List, Union

from app.schemas.responses import ToolCall
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
    previous_tool_calls: List[ToolCall] = []

    def load_from_dict(self, evidence_dict: Dict[str, List[str]]) -> None:
        """Load evidence from a dictionary format"""
        for paper_id, content in evidence_dict.items():
            self.evidence[paper_id] = Evidence(paper_id=paper_id, content=content)

    def add_evidence(self, paper_id: str, content: Union[str, List[str]]) -> None:
        """Add evidence for a specific paper"""
        if paper_id not in self.evidence:
            self.evidence[paper_id] = Evidence(paper_id=paper_id, content=[])
        self.evidence[paper_id].add_content(content)

    def add_tool_call(self, tool_call: ToolCall) -> None:
        """Add a tool call to the collection"""
        self.previous_tool_calls.append(tool_call)

    def get_evidence_dict(self) -> Dict[str, List[str]]:
        """Convert to dictionary format for backward compatibility"""
        return {
            paper_id: evidence.content for paper_id, evidence in self.evidence.items()
        }

    def get_evidence_dict_pretty(
        self, paper_id_to_title: Dict[str, str]
    ) -> Dict[str, List[str]]:
        """Convert to dictionary format with paper titles for pretty display"""
        return {
            paper_id_to_title.get(paper_id, paper_id): evidence.content
            for paper_id, evidence in self.evidence.items()
        }

    def get_previous_tool_calls_dict(self) -> List[Dict]:
        """Convert previous tool calls to dictionary format"""
        return [tool_call.model_dump() for tool_call in self.previous_tool_calls]

    def has_evidence(self) -> bool:
        """Check if any evidence has been collected"""
        return bool(self.evidence)

    def has_previous_tool_calls(self) -> bool:
        """Check if there are any previous tool calls"""
        return bool(self.previous_tool_calls)
