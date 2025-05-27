from app.llm.citation_handler import CitationHandler
from app.llm.hypothesis_operations import HypothesisOperations
from app.llm.json_parser import JSONParser
from app.llm.paper_operations import PaperOperations


# For backward compatibility, create a unified Operations class
class Operations(HypothesisOperations, PaperOperations):
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
    "CitationHandler",
    "JSONParser",
]

operations = Operations()
