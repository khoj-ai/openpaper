import logging
import os

import uvicorn  # type: ignore
from app.api.annotation_api import annotation_router
from app.api.api import router
from app.api.conversation_api import conversation_router
from app.api.document_api import document_router
from app.api.highlight_api import highlight_router
from app.api.message_api import message_router
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

logging.basicConfig(
    level=logging.ERROR,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)

logger = logging.getLogger(__name__)

load_dotenv()

app = FastAPI(
    title="Annotated Paper",
    description="A web application for uploading and annotating papers.",
    version="1.0.0",
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods
    allow_headers=["*"],  # Allows all headers
)

# Mount the uploads directory
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

# Include the router in the main app
app.include_router(router, prefix="/api")
app.include_router(document_router, prefix="/api/paper")
app.include_router(conversation_router, prefix="/api/conversation")
app.include_router(message_router, prefix="/api/message")
app.include_router(highlight_router, prefix="/api/highlight")
app.include_router(annotation_router, prefix="/api/annotation")

if __name__ == "__main__":
    port = int(os.getenv("PORT", "8001"))
    log_config = uvicorn.config.LOGGING_CONFIG
    log_config["formatters"]["access"][
        "fmt"
    ] = "%(asctime)s - %(levelname)s - %(message)s"
    log_config["formatters"]["default"][
        "fmt"
    ] = "%(asctime)s - %(levelname)s - %(message)s"
    # Set higher log level to see more details
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=port,
        reload=True,
        log_level="debug",
        log_config=log_config,
    )
