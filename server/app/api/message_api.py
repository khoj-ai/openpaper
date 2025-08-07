import json
import logging
import uuid
from datetime import datetime, timezone
from typing import AsyncGenerator, List, Optional, Union

from app.auth.dependencies import get_required_user

# Wow I just saw this spelling error. Might leave for proof of humanity. DATE: 2025-07-16.
from app.database.crud.conversation_crud import conversation_crud
from app.database.crud.message_crud import MessageCreate, message_crud
from app.database.database import get_db
from app.database.models import ConversableType
from app.database.telemetry import track_event
from app.llm.base import LLMProvider
from app.llm.citation_handler import CitationHandler
from app.llm.operations import operations
from app.schemas.message import EvidenceCollection, ResponseStyle
from app.schemas.user import CurrentUser
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

load_dotenv()

logger = logging.getLogger(__name__)

logger.setLevel(logging.INFO)

# Create API router with prefix
message_router = APIRouter()

END_DELIMITER = "END_OF_STREAM"


async def _stream_chat_chunks(
    chunk_generator: AsyncGenerator[Union[dict, str], None],
    content_chunks: List[str],
    evidence_container: dict,
) -> AsyncGenerator[str, None]:
    """Helper to stream chat chunks and handle common logic."""
    async for chunk in chunk_generator:
        if not isinstance(chunk, dict):
            logger.warning(f"Received unexpected chunk format: {chunk}")
            continue

        chunk_type = chunk.get("type")
        chunk_content = chunk.get("content", "")

        if chunk_type == "content":
            content_chunks.append(chunk_content)
            try:
                json_response = json.dumps(
                    {"type": "content", "content": chunk_content}
                )
                yield f"{json_response}{END_DELIMITER}"
            except (TypeError, ValueError) as json_error:
                logger.warning(f"Failed to serialize chunk content: {json_error}")
                safe_content = (
                    str(chunk_content).encode("utf-8", errors="replace").decode("utf-8")
                )
                json_response = json.dumps({"type": "content", "content": safe_content})
                yield f"{json_response}{END_DELIMITER}"

        elif chunk_type == "references":
            evidence_container["evidence"] = chunk_content
            try:
                json_response = json.dumps(
                    {"type": "references", "content": chunk_content}
                )
                yield f"{json_response}{END_DELIMITER}"
            except (TypeError, ValueError) as json_error:
                logger.warning(f"Failed to serialize references: {json_error}")
                yield f"{json.dumps({'type': 'error', 'content': 'Failed to serialize references'})}{END_DELIMITER}"


@message_router.get("/models")
async def get_available_models() -> dict:
    return {"models": operations.get_chat_model_options()}


class EverythingChatRequest(BaseModel):
    conversation_id: str
    user_query: str
    user_references: Optional[List[str]] = None
    llm_provider: Optional[LLMProvider] = None


@message_router.post("/chat/everything")
async def chat_message_everything(
    request: EverythingChatRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
) -> StreamingResponse:
    """
    Send a chat message and stream the response from the LLM.

    This searches over the entire corpus of papers and returns a response based on the user's query.
    The response includes both the content and any relevant evidence gathered.
    """
    try:

        async def response_generator():
            try:
                content_chunks = []
                start_time = datetime.now(timezone.utc)
                evidence_container = {"evidence": None}
                evidence_collection: Optional[EvidenceCollection] = None

                # Ensure conversation is type EVERYTHING
                conversation = conversation_crud.get(
                    db, request.conversation_id, user=current_user
                )
                if (
                    conversation
                    and conversation.conversable_type != ConversableType.EVERYTHING
                ):
                    raise ValueError("Conversation is not of type EVERYTHING.")

                async for chunk in operations.gather_evidence(
                    conversation_id=request.conversation_id,
                    question=request.user_query,
                    current_user=current_user,
                    llm_provider=LLMProvider.OPENAI,
                    user_references=request.user_references,
                    db=db,
                ):
                    # Parse the chunk as a dictionary
                    if isinstance(chunk, dict):
                        chunk_type = chunk.get("type")
                        chunk_content = chunk.get("content", "")

                        if chunk_type == "evidence_gathered":
                            # Initialize evidence collection if not already done
                            if evidence_collection is None:
                                evidence_collection = EvidenceCollection()

                            # Add the evidence to the collection
                            assert isinstance(
                                chunk_content, dict
                            ), "Chunk content must be a dictionary"
                            # Cast the chunk_content to EvidenceCollection
                            evidence_collection.load_from_dict(chunk_content)
                        elif chunk_type == "status":
                            yield f"{json.dumps({'type': 'status', 'content': chunk_content})}{END_DELIMITER}"
                        else:
                            logger.debug(f"received chunks: {chunk}")

                if evidence_collection is None:
                    json_response = json.dumps(
                        {
                            "type": "content",
                            "content": "It looks like I couldn't find any relevant papers for your question. Please try rephrasing your question. If you think this is an error, please contact support.",
                        }
                    )
                    yield f"{json_response}{END_DELIMITER}"
                    return

                yield f"{json.dumps({'type': 'status', 'content': 'Cleaning and filtering evidence...'})}{END_DELIMITER}"

                cleaned_evidence = await operations.clean_evidence(
                    evidence_collection=evidence_collection,
                    original_question=request.user_query,
                    llm_provider=LLMProvider.OPENAI,
                )

                yield f"{json.dumps({'type': 'status', 'content': 'Generating response...'})}{END_DELIMITER}"

                chat_generator = operations.chat_with_everything(
                    question=request.user_query,
                    llm_provider=request.llm_provider,
                    user_references=request.user_references,
                    evidence_gathered=cleaned_evidence,
                    conversation_id=request.conversation_id,
                    current_user=current_user,
                    db=db,
                )
                async for stream_chunk in _stream_chat_chunks(
                    chunk_generator=chat_generator,
                    content_chunks=content_chunks,
                    evidence_container=evidence_container,
                ):
                    yield stream_chunk

                evidence = evidence_container["evidence"]

                # Save the complete message to the database
                full_content = "".join(content_chunks)

                formatted_references = (
                    CitationHandler.convert_references_to_dict(
                        references=request.user_references
                    )
                    if request.user_references
                    else None
                )

                # Save user message
                message_crud.create(
                    db,
                    obj_in=MessageCreate(
                        conversation_id=uuid.UUID(request.conversation_id),
                        role="user",
                        content=request.user_query,
                        references=formatted_references,
                    ),
                    user=current_user,
                )

                # Save assistant message with both content and evidence
                message_crud.create(
                    db,
                    obj_in=MessageCreate(
                        conversation_id=uuid.UUID(request.conversation_id),
                        role="assistant",
                        content=full_content,
                        references=evidence if evidence else None,
                    ),
                    user=current_user,
                )

                # Rename the conversation based on the chat history
                operations.rename_conversation(
                    db=db, conversation_id=request.conversation_id, user=current_user
                )

                # Track chat message event
                track_event(
                    "did_chat_message",
                    properties={
                        "has_user_references": bool(request.user_references),
                        "has_evidence": bool(evidence),
                        "llm_provider": (
                            request.llm_provider.value
                            if request.llm_provider
                            else "default"
                        ),
                        "time_taken": (
                            datetime.now(timezone.utc) - start_time
                        ).total_seconds(),
                        "type": "everything",
                    },
                    user_id=str(current_user.id),
                )

            except Exception as e:

                # Track error event
                track_event(
                    "everything_chat_message_error",
                    properties={
                        "error": str(e),
                        "type": "everything",
                        "conversation_id": str(request.conversation_id),
                    },
                    user_id=str(current_user.id),
                )

                logger.error(f"Error in streaming response: {e}", exc_info=True)
                yield f"{json.dumps({'type': 'error', 'content': str(e)})}{END_DELIMITER}"

        return StreamingResponse(response_generator(), media_type="text/event-stream")

    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error processing chat message: {e}")
        raise HTTPException(status_code=400, detail=str(e))


# Add this new model for the chat request
class ChatMessageRequest(BaseModel):
    paper_id: str
    conversation_id: str
    user_query: str
    user_references: Optional[List[str]] = None
    style: Optional[ResponseStyle] = ResponseStyle.NORMAL
    llm_provider: Optional[LLMProvider] = None


@message_router.post("/chat/paper")
async def chat_message_stream(
    request: ChatMessageRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
) -> StreamingResponse:
    """
    Send a chat message and stream the response from the LLM

    The response style can be:
    - normal: Standard balanced response
    - concise: Short and to the point
    - detailed: Comprehensive and thorough
    """
    try:

        async def response_generator():
            try:
                content_chunks = []
                start_time = datetime.now(timezone.utc)
                evidence_container = {"evidence": None}

                chat_generator = operations.chat_with_paper(
                    paper_id=request.paper_id,
                    conversation_id=request.conversation_id,
                    question=request.user_query,
                    current_user=current_user,
                    llm_provider=request.llm_provider,
                    user_references=request.user_references,
                    response_style=request.style,
                    db=db,
                )

                async for chunk in _stream_chat_chunks(
                    chunk_generator=chat_generator,
                    content_chunks=content_chunks,
                    evidence_container=evidence_container,
                ):
                    yield chunk

                evidence = evidence_container["evidence"]

                # Save the complete message to the database
                full_content = "".join(content_chunks)

                formatted_references = (
                    CitationHandler.convert_references_to_dict(
                        references=request.user_references
                    )
                    if request.user_references
                    else None
                )

                # Save user message
                message_crud.create(
                    db,
                    obj_in=MessageCreate(
                        conversation_id=uuid.UUID(request.conversation_id),
                        role="user",
                        content=request.user_query,
                        references=formatted_references,
                    ),
                    user=current_user,
                )

                # Save assistant message with both content and evidence
                message_crud.create(
                    db,
                    obj_in=MessageCreate(
                        conversation_id=uuid.UUID(request.conversation_id),
                        role="assistant",
                        content=full_content,
                        references=evidence if evidence else None,
                    ),
                    user=current_user,
                )

                # Track chat message event
                track_event(
                    "did_chat_message",
                    properties={
                        "response_style": (
                            request.style.value if request.style else "normal"
                        ),
                        "has_user_references": bool(request.user_references),
                        "has_evidence": bool(evidence),
                        "llm_provider": (
                            request.llm_provider.value
                            if request.llm_provider
                            else "default"
                        ),
                        "time_taken": (
                            datetime.now(timezone.utc) - start_time
                        ).total_seconds(),
                        "paper_id": str(request.paper_id),
                        "type": "paper",
                    },
                    user_id=str(current_user.id),
                )

            except Exception as e:

                # Track error event
                track_event(
                    "chat_message_error",
                    properties={
                        "error": str(e),
                        "paper_id": str(request.paper_id),
                        "conversation_id": str(request.conversation_id),
                    },
                    user_id=str(current_user.id),
                )

                logger.error(f"Error in streaming response: {e}", exc_info=True)
                yield f"{json.dumps({'type': 'error', 'content': str(e)})}{END_DELIMITER}"

        return StreamingResponse(response_generator(), media_type="text/event-stream")

    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error processing chat message: {e}")
        raise HTTPException(status_code=400, detail=str(e))
