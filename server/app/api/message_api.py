import logging
import uuid
from pathlib import Path

from app.database.crud.message_crud import MessageCreate, message_crud
from app.database.database import get_db
from app.database.models import Conversation, Document
from app.llm.operations import Operations
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

load_dotenv()

logger = logging.getLogger(__name__)

logger.setLevel(logging.INFO)

# Create uploads directory if it doesn't exist
UPLOAD_DIR = Path("uploads")

# Create API router with prefix
message_router = APIRouter()

llm_operations = Operations()


# Add this new model for the chat request
class ChatMessageRequest(BaseModel):
    paper_id: str
    conversation_id: str
    user_query: str


@message_router.post("/chat")
async def chat_message_stream(
    request: ChatMessageRequest, db: Session = Depends(get_db)
) -> StreamingResponse:
    """
    Send a chat message and stream the response from the LLM
    """
    try:
        # Create generator function for streaming
        async def response_generator():
            try:
                full_response = []

                # Stream the AI response and accumulate it
                async for chunk in llm_operations.chat_with_paper(
                    paper_id=request.paper_id,
                    conversation_id=request.conversation_id,
                    question=request.user_query,
                    db=db,
                ):
                    full_response.append(chunk)
                    logger.info(f"Streaming chunk: {chunk}")
                    yield f"data: {chunk}\n\n"

                # Finally, save the new user and assistant messages to the database
                message_crud.create(
                    db,
                    obj_in=MessageCreate(
                        conversation_id=uuid.UUID(request.conversation_id),
                        role="user",
                        content=request.user_query,
                    ),
                )

                message_crud.create(
                    db,
                    obj_in=MessageCreate(
                        conversation_id=uuid.UUID(request.conversation_id),
                        role="assistant",
                        content="".join(full_response),
                    ),
                )

            except Exception as e:
                logger.error(f"Error in streaming response: {e}", exc_info=True)
                yield f"data: Error: {str(e)}\n\n"

        return StreamingResponse(response_generator(), media_type="text/event-stream")

    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error processing chat message: {e}")
        raise HTTPException(status_code=400, detail=str(e))
