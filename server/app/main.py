import logging
import os

import uvicorn  # type: ignore
from app.api.annotation_api import annotation_router
from app.api.api import router
from app.api.auth_api import auth_router
from app.api.conversation_api import conversation_router
from app.api.highlight_api import highlight_router
from app.api.message_api import message_router
from app.api.onboarding_api import onboarding_router
from app.api.paper_api import paper_router
from app.api.paper_audio_api import paper_audio_router
from app.api.paper_image_api import paper_image_router
from app.api.paper_search_api import paper_search_router
from app.api.paper_tag_api import paper_tag_router
from app.api.paper_upload_api import paper_upload_router
from app.api.project_audio_api import project_audio_router
from app.api.projects.project_conversations_api import project_conversations_router
from app.api.projects.project_papers_api import project_papers_router
from app.api.projects.projects_api import projects_router
from app.api.projects.projects_data_table_api import projects_data_table_router
from app.api.projects.projects_invitation_api import (
    router as projects_invitation_router,
)
from app.api.search_api import search_router
from app.api.subscription_api import subscription_router
from app.api.webhook_api import webhook_router
from app.database.admin import setup_admin
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

logging.basicConfig(
    level=logging.ERROR,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)

logger = logging.getLogger(__name__)

load_dotenv()

app = FastAPI(
    title="Open Paper",
    description="A web application for uploading and annotating papers.",
    version="1.0.0",
)

client_domain = os.getenv("CLIENT_DOMAIN", "http://localhost:3000")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[client_domain],
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=["*"],
    expose_headers=["*"],
    allow_credentials=True,  # This is required for cookies
    max_age=600,  # Cache preflight requests for 10 minutes
)

# Include the router in the main app
app.include_router(router, prefix="/api")
app.include_router(auth_router, prefix="/api/auth")  # Auth routes
app.include_router(paper_router, prefix="/api/paper")
app.include_router(conversation_router, prefix="/api/conversation")
app.include_router(message_router, prefix="/api/message")
app.include_router(highlight_router, prefix="/api/highlight")
app.include_router(annotation_router, prefix="/api/annotation")
app.include_router(projects_router, prefix="/api/projects")
app.include_router(project_papers_router, prefix="/api/projects/papers")
app.include_router(project_conversations_router, prefix="/api/projects/conversations")
app.include_router(projects_invitation_router, prefix="/api/projects/invitations")
app.include_router(paper_search_router, prefix="/api/search/global")
app.include_router(search_router, prefix="/api/search/local")
app.include_router(paper_audio_router, prefix="/api/paper/audio")
app.include_router(paper_image_router, prefix="/api/paper/image")
app.include_router(projects_data_table_router, prefix="/api/projects/tables")
app.include_router(paper_upload_router, prefix="/api/paper/upload")
app.include_router(project_audio_router, prefix="/api/projects/audio")
app.include_router(paper_tag_router, prefix="/api/paper/tag")
app.include_router(
    subscription_router, prefix="/api/subscription"
)  # Subscription routes
app.include_router(webhook_router, prefix="/api/webhooks")  # Webhook routes
app.include_router(onboarding_router, prefix="/api/onboarding")

setup_admin(app)  # Setup admin interface

if __name__ == "__main__":
    port = int(os.getenv("PORT", "8000"))
    log_config = uvicorn.config.LOGGING_CONFIG  # type: ignore
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
        # reload=True,
        log_level="debug",
        log_config=log_config,
        forwarded_allow_ips="*",  # Allow all forwarded IPs
        proxy_headers=True,  # Enable proxy headers
    )
