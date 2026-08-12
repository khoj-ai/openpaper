from app.llm.chart_operations import ChartOperations
from app.llm.citation_handler import CitationHandler
from app.llm.conversation_operations import ConversationOperations, DataTableOperations
from app.llm.json_parser import JSONParser
from app.llm.multi_paper_operations import MultiPaperOperations
from app.llm.paper_operations import PaperOperations


# For backward compatibility, create a unified Operations class
class Operations(
    PaperOperations,
    MultiPaperOperations,
    ConversationOperations,
    # ChartOperations subclasses DataTableOperations, so it precedes it here
    # to keep the linearization consistent.
    ChartOperations,
    DataTableOperations,
):
    """
    Unified operations class that combines all LLM operations
    """

    pass


# Also expose individual components for more targeted usage
__all__ = [
    "Operations",
    "PaperOperations",
    "MultiPaperOperations",
    "ConversationOperations",
    "CitationHandler",
    "JSONParser",
    "DataTableOperations",
]

operations = Operations()
