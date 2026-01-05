import re
from enum import Enum
from typing import Any, Dict, List, Union

from app.schemas.responses import ToolCall, ToolCallResult
from pydantic import BaseModel, Field


class ResponseStyle(str, Enum):
    NORMAL = "normal"
    CONCISE = "concise"
    DETAILED = "detailed"


class Evidence(BaseModel):
    """Model for managing evidence gathered from papers"""

    paper_id: str = Field(
        ...,
        description="Unique identifier for the paper. Not to be used for user-facing responses. Only for internal tracking.",
    )
    content: List[str] = Field(
        default_factory=list, description="List of evidence content strings"
    )
    metadata: Dict[str, List[str]] = Field(
        default_factory=dict, description="Metadata associated with the evidence"
    )

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

    evidence: Dict[str, Evidence] = Field(
        default_factory=dict, description="Mapping of paper IDs to their evidence"
    )
    previous_tool_calls: List[ToolCall] = Field(
        default_factory=list,
        description="List of previous tool calls made during evidence gathering",
    )
    tool_call_results: List[ToolCallResult] = Field(
        default_factory=list,
        description="List of tool call results for proper multi-turn function calling",
    )

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

    def add_tool_call_result(
        self, tool_call: ToolCall, result: Union[str, List, Dict, None]
    ) -> None:
        """Add a tool call result for proper multi-turn function calling"""
        self.tool_call_results.append(
            ToolCallResult(
                id=tool_call.id,
                name=tool_call.name,
                args=tool_call.args,
                result=result,
            )
        )

    def get_tool_call_results(self) -> List[ToolCallResult]:
        """Get all tool call results for passing to LLM"""
        return self.tool_call_results

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

    def has_evidence(self) -> bool:
        """Check if any evidence has been collected"""
        return bool(self.evidence)

    def has_previous_tool_calls(self) -> bool:
        """Check if there are any previous tool calls"""
        return bool(self.previous_tool_calls)

    def get_tool_results_size(self) -> int:
        """Calculate the total character size of all tool call results"""
        import json

        total_size = 0
        for result in self.tool_call_results:
            result_value = result.result
            if isinstance(result_value, (dict, list)):
                total_size += len(json.dumps(result_value))
            elif result_value is not None:
                total_size += len(str(result_value))
        return total_size

    def get_tool_results_for_compaction(self) -> List[Dict[str, Any]]:
        """Get tool results in a format suitable for LLM compaction"""
        import json

        results = []
        for result in self.tool_call_results:
            result_value = result.result
            if isinstance(result_value, (dict, list)):
                result_str = json.dumps(result_value)
            elif result_value is not None:
                result_str = str(result_value)
            else:
                result_str = "None"

            results.append(
                {
                    "id": result.id or "",
                    "name": result.name,
                    "result": result_str[
                        :10000
                    ],  # Truncate very long individual results
                }
            )
        return results

    def apply_compacted_results(
        self, compacted_results: List["CompactedToolResult"]
    ) -> None:
        """Replace tool call results with compacted versions, preserving original args"""
        # Build a lookup of original args by id
        original_args_by_id = {r.id: r.args for r in self.tool_call_results if r.id}

        self.tool_call_results = [
            ToolCallResult(
                id=cr.id,
                name=cr.name,
                args=original_args_by_id.get(cr.id, {}),
                result=cr.summary,
            )
            for cr in compacted_results
        ]

    def get_evidence_size(self) -> int:
        """Calculate the total character size of all evidence"""
        total_size = 0
        for evidence in self.evidence.values():
            for snippet in evidence.content:
                total_size += len(snippet)
        return total_size

    def apply_compacted_evidence(
        self, compacted_evidence: Dict[str, List[str]]
    ) -> None:
        """Replace evidence with compacted versions from LLM compaction"""
        # Clear existing evidence and load compacted version
        self.evidence.clear()
        for paper_id, snippets in compacted_evidence.items():
            self.evidence[paper_id] = Evidence(paper_id=paper_id, content=snippets)


class EvidenceSummaryResponse(BaseModel):
    """Response structure for evidence summarization

    Maps paper IDs to their respective summaries.
    Each paper_id should correspond to the summary for that paper's evidence.
    """

    summaries: Dict[str, str] = Field(
        default_factory=dict,
        description="Mapping of paper IDs to their respective summaries",
    )


class CompactedToolResult(BaseModel):
    """A single compacted tool result"""

    id: str = Field(description="The original tool call ID")
    name: str = Field(description="The tool/function name that was called")
    summary: str = Field(
        description="Concise summary of the result, preserving key information"
    )


class ToolResultCompactionResponse(BaseModel):
    """Response structure for tool result compaction"""

    compacted_results: List[CompactedToolResult] = Field(
        default_factory=list,
        description="List of compacted tool results with summaries",
    )


class EvidenceCompactionResponse(BaseModel):
    """Response structure for evidence compaction before chat response.

    The format matches EvidenceCollection.get_evidence_dict() output:
    Dict[str, List[str]] mapping paper_id to list of evidence strings.
    """

    compacted_evidence: Dict[str, List[str]] = Field(
        default_factory=dict,
        description="Mapping of paper IDs to their compacted evidence snippets. Each paper should have a reduced list of summarized evidence strings that preserve key findings, quotes, and data points.",
    )
