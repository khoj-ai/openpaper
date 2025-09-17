import re
from enum import Enum
from typing import Dict, List, Optional, Union

from app.schemas.responses import ToolCall
from pydantic import BaseModel, Field


class ResponseStyle(str, Enum):
    NORMAL = "normal"
    CONCISE = "concise"
    DETAILED = "detailed"


class Evidence(BaseModel):
    """Model for managing evidence gathered from papers"""

    paper_id: str
    content: List[str]
    metadata: Dict[str, List[str]] = {}  # Store line numbers and other metadata

    def add_content(
        self, content: Union[str, List[str]], with_line_numbers: bool = False
    ) -> None:
        """Add content to the evidence"""
        if isinstance(content, str):
            self.content.append(content)
            if with_line_numbers:
                # Extract line numbers from content like "123: some text"
                line_match = re.match(r"^(\d+):\s*(.+)", content)
                if line_match:
                    line_num = line_match.group(1)
                    clean_content = line_match.group(2)
                    if "line_numbers" not in self.metadata:
                        self.metadata["line_numbers"] = []
                    self.metadata["line_numbers"].append(line_num)
                    # Replace with clean content
                    self.content[-1] = clean_content
        else:
            for item in content:
                self.add_content(item, with_line_numbers)

    def get_clean_content(self) -> List[str]:
        """Get content without line number prefixes"""
        return self.content

    def get_line_numbers(self) -> List[str]:
        """Get associated line numbers"""
        return self.metadata.get("line_numbers", [])


class EvidenceCollection(BaseModel):
    """Collection of evidence from multiple papers"""

    evidence: Dict[str, Evidence] = {}
    previous_tool_calls: List[ToolCall] = []

    def load_from_dict(self, evidence_dict: Dict[str, List[str]]) -> None:
        """Load evidence from a dictionary format"""
        for paper_id, content in evidence_dict.items():
            self.evidence[paper_id] = Evidence(paper_id=paper_id, content=content)

    def add_evidence(
        self,
        paper_id: str,
        content: Union[str, List[str]],
        preserve_line_numbers: bool = False,
    ) -> None:
        """Add evidence for a specific paper"""
        if paper_id not in self.evidence:
            self.evidence[paper_id] = Evidence(paper_id=paper_id, content=[])
        self.evidence[paper_id].add_content(
            content, with_line_numbers=preserve_line_numbers
        )

    def add_tool_call(self, tool_call: ToolCall) -> None:
        """Add a tool call to the collection"""
        self.previous_tool_calls.append(tool_call)

    def get_evidence_dict(self) -> Dict[str, List[str]]:
        """Convert to dictionary format for backward compatibility - returns clean content without line numbers"""
        return {
            paper_id: evidence.get_clean_content()
            for paper_id, evidence in self.evidence.items()
        }

    def get_evidence_dict_with_metadata(
        self,
    ) -> Dict[str, Dict[str, Union[List[str], Dict]]]:
        """Get evidence with metadata for agent context"""
        return {
            paper_id: {"content": evidence.content, "metadata": evidence.metadata}
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


class EvidenceCleaningInstructions(BaseModel):
    """Instructions for cleaning evidence from a single paper"""

    keep: List[int] = Field(
        default_factory=list,
        description="List of indices to keep from the paper's evidence",
    )
    drop: List[int] = Field(
        default_factory=list,
        description="List of indices to drop from the paper's evidence",
    )


class EvidenceCleaningResponse(BaseModel):
    """Complete response structure for evidence cleaning

    Maps paper IDs to their respective cleaning instructions.
    Each paper_id should correspond to cleaning instructions for that paper's evidence snippets.
    """

    papers: Dict[str, EvidenceCleaningInstructions] = Field(
        default_factory=dict,
        description="Mapping of paper IDs to their respective cleaning instructions",
    )
