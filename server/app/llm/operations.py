from app.llm.citation_handler import CitationHandler
from app.llm.conversation_operations import ConversationOperations, DataTableOperations
from app.llm.hypothesis_operations import HypothesisOperations
from app.llm.json_parser import JSONParser
from app.llm.multi_paper_operations import MultiPaperOperations
from app.llm.paper_operations import PaperOperations


# For backward compatibility, create a unified Operations class
class Operations(
    HypothesisOperations,
    PaperOperations,
    MultiPaperOperations,
    ConversationOperations,
    DataTableOperations,
):
    """
    Unified operations class that combines all LLM operations
    Inherits from both hypothesis and paper operations for backward compatibility
    """

    pass


# Also expose individual components for more targeted usage
__all__ = [
    "Operations",
    "HypothesisOperations",
    "PaperOperations",
    "MultiPaperOperations",
    "ConversationOperations",
    "CitationHandler",
    "JSONParser",
    "DataTableOperations",
]

operations = Operations()
