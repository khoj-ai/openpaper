import json
import logging
import uuid
from pathlib import Path
from typing import List, Optional, Union

from app.auth.dependencies import get_required_user
from app.database.crud.message_crud import MessageCreate, message_crud
from app.database.database import get_db
from app.llm.operations import Operations
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

llm_operations = Operations()


# Add this new model for the chat request
class ChatMessageRequest(BaseModel):
    paper_id: str
    conversation_id: str
    user_query: str
    user_references: Optional[List[str]] = None


@message_router.post("/chat")
async def chat_message_stream(
    request: ChatMessageRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
) -> StreamingResponse:
    """
    Send a chat message and stream the response from the LLM
    """
    try:

        async def response_generator():
            try:
                content_chunks = []
                evidence: dict[str, list[dict[str, Union[str, int]]]] | None = None  # type: ignore

                async for chunk in llm_operations.chat_with_paper(
                    paper_id=request.paper_id,
                    conversation_id=request.conversation_id,
                    question=request.user_query,
                    current_user=current_user,
                    user_references=request.user_references,
                    db=db,
                ):
                    # Parse the chunk as a dictionary
                    if isinstance(chunk, dict):
                        chunk_type = chunk.get("type")
                        chunk_content = chunk.get("content", "")

                        if chunk_type == "content":
                            content_chunks.append(chunk_content)
                            # Stream content chunks immediately
                            yield f"{json.dumps({'type': 'content', 'content': chunk_content})}"
                        elif chunk_type == "references":
                            evidence = chunk_content
                            # Stream evidence when received
                            yield f"{json.dumps({'type': 'references', 'content': evidence})}"
                    else:
                        logger.warning(f"Received unexpected chunk format: {chunk}")

                # Save the complete message to the database
                full_content = "".join(content_chunks)

                formatted_references = llm_operations.convert_references_to_dict(
                    references=request.user_references
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
                    current_user=current_user,
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
                    current_user=current_user,
                )

            except Exception as e:
                logger.error(f"Error in streaming response: {e}", exc_info=True)
                yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"

        return StreamingResponse(response_generator(), media_type="text/event-stream")

    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error processing chat message: {e}")
        raise HTTPException(status_code=400, detail=str(e))
