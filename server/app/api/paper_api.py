import logging
import uuid
from typing import List, Optional

from app.auth.dependencies import get_current_user, get_required_user
from app.database.crud.annotation_crud import annotation_crud
from app.database.crud.conversation_crud import conversation_crud
from app.database.crud.highlight_crud import highlight_crud
from app.database.crud.paper_crud import PaperUpdate, paper_crud
from app.database.crud.paper_note_crud import (
    PaperNoteCreate,
    PaperNoteUpdate,
    paper_note_crud,
)
from app.database.crud.projects.project_paper_crud import project_paper_crud
from app.database.database import get_db
from app.database.models import Paper, PaperStatus
from app.database.telemetry import track_event
from app.helpers.s3 import s3_service
from app.schemas.responses import ResponseCitation
from app.schemas.user import CurrentUser
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

load_dotenv()

logger = logging.getLogger(__name__)

# Create API router with prefix
paper_router = APIRouter()


class SharePaperSchemaResponse(BaseModel):
    paper_data: dict
    highlight_data: dict
    annotations_data: dict


class CreatePaperNoteSchema(BaseModel):
    content: Optional[str]


class UpdatePaperNoteSchema(BaseModel):
    content: str


@paper_router.get("/all")
async def get_paper_ids(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """
    Get all paper IDs
    """
    papers: List[Paper] = paper_crud.get_multi_uploads_completed(db, user=current_user)
    return JSONResponse(
        status_code=200,
        content={
            "papers": [
                {
                    "id": str(paper.id),
                    "title": paper.title,
                    "created_at": str(paper.created_at),
                    "abstract": paper.abstract,
                    "authors": paper.authors,
                    "institutions": paper.institutions,
                    "keywords": paper.keywords,
                    "status": paper.status,
                    "preview_url": paper.preview_url,
                    "size_in_kb": paper.size_in_kb,
                    "publish_date": (
                        str(paper.publish_date) if paper.publish_date else None
                    ),
                    "file_url": s3_service.get_cached_presigned_url_by_owner(
                        db,
                        str(paper.id),
                        str(paper.s3_object_key),
                        str(current_user.id),
                    ),
                }
                for paper in papers
            ]
        },
    )


@paper_router.get("/active")
async def get_active_paper_ids(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """
    Get all active paper IDs
    """
    papers: List[Paper] = paper_crud.get_multi_uploads_completed(
        db, user=current_user, status=PaperStatus.reading
    )
    if not papers:
        return JSONResponse(
            status_code=404, content={"message": "No active papers found"}
        )
    return JSONResponse(
        status_code=200,
        content={
            "papers": [
                {
                    "id": str(paper.id),
                    "title": paper.title,
                    "created_at": str(paper.created_at),
                    "abstract": paper.abstract,
                    "authors": paper.authors,
                    "institutions": paper.institutions,
                    "keywords": paper.keywords,
                    "status": paper.status,
                    "tags": [tag.name for tag in paper.tags],
                }
                for paper in papers
            ]
        },
    )


@paper_router.get("/note")
async def get_paper_note(
    paper_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """
    Get the paper note associated with this document.
    """
    target_paper = paper_crud.get(
        db, id=paper_id, user=current_user, update_last_accessed=True
    )

    if not target_paper:
        raise HTTPException(status_code=404, detail=f"No document with id {paper_id}")

    paper_note = paper_note_crud.get_paper_note_by_paper_id(
        db, paper_id=paper_id, user=current_user
    )

    if paper_note:
        return JSONResponse(content=paper_note.to_dict(), status_code=200)

    raise HTTPException(
        status_code=404, detail=f"Paper Note does not exist for document {paper_id}"
    )


@paper_router.post("/note")
async def create_paper_note(
    paper_id: str,
    request: CreatePaperNoteSchema,
    db: Session = Depends(get_db),
    current_user: Optional[CurrentUser] = Depends(get_required_user),
):
    """
    Create the paper note associated with this document
    """
    content = request.content
    target_paper = paper_crud.get(
        db, id=paper_id, user=current_user, update_last_accessed=True
    )

    if not target_paper:
        raise HTTPException(status_code=404, detail=f"No document with id {paper_id}")

    paper_note_to_create = PaperNoteCreate(
        paper_id=uuid.UUID(paper_id), content=content
    )

    paper_note = paper_note_crud.create(
        db, obj_in=paper_note_to_create, user=current_user
    )

    if not paper_note:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to create paper note for document ID {paper_id}",
        )

    track_event(
        "paper_note_created",
        properties={
            "paper_id": str(paper_note.paper_id),
            "note_id": str(paper_note.id),
        },
        user_id=str(current_user.id) if current_user else None,
    )

    return JSONResponse(content=paper_note.to_dict(), status_code=201)


@paper_router.post("/status")
async def set_paper_status(
    paper_id: str,
    status: PaperStatus,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """
    Set the status of a paper
    """
    target_paper = paper_crud.get(db, id=paper_id, user=current_user)

    if not target_paper:
        raise HTTPException(status_code=404, detail=f"No document with id {paper_id}")

    paper_update = PaperUpdate(status=status)
    updated_paper = paper_crud.update(
        db=db, db_obj=target_paper, obj_in=paper_update, user=current_user
    )

    if not updated_paper:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to update paper status for document ID {paper_id}",
        )

    track_event(
        "paper_status_updated",
        properties={
            "paper_id": str(updated_paper.id),
            "status": updated_paper.status,
        },
        user_id=str(current_user.id),
    )

    return JSONResponse(content=updated_paper.to_dict(), status_code=200)


@paper_router.get("/relevant")
async def get_relevant_papers(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """
    Get the most relevant papers uploaded by the user
    """
    papers: List[Paper] = paper_crud.get_top_relevant_papers(db, user=current_user)
    if not papers:
        return JSONResponse(
            status_code=404, content={"message": "No relevant papers found"}
        )

    return JSONResponse(
        status_code=200,
        content={
            "papers": [
                {
                    "id": str(paper.id),
                    "title": paper.title,
                    "created_at": str(paper.created_at),
                    "abstract": paper.abstract,
                    "authors": paper.authors,
                    "institutions": paper.institutions,
                    "keywords": paper.keywords,
                    "status": paper.status,
                    "preview_url": paper.preview_url,
                    "size_in_kb": paper.size_in_kb,
                }
                for paper in papers
            ]
        },
    )


@paper_router.put("/note")
async def update_paper_note(
    paper_id: str,
    request: UpdatePaperNoteSchema,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """
    Update the paper note associated with this document
    """
    content = request.content
    target_paper = paper_crud.get(
        db, id=paper_id, user=current_user, update_last_accessed=True
    )

    if not target_paper:
        raise HTTPException(status_code=404, detail=f"No document with id {paper_id}")

    paper_note = paper_note_crud.get_paper_note_by_paper_id(
        db, paper_id=paper_id, user=current_user
    )

    if not paper_note:
        raise HTTPException(
            status_code=404,
            detail=f"No paper note associated with document ID {paper_id}",
        )

    paper_note_to_update = PaperNoteUpdate(content=content)

    updated_paper_note = paper_note_crud.update(
        db=db, db_obj=paper_note, obj_in=paper_note_to_update, user=current_user
    )

    if not updated_paper_note:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to update paper note for document ID {paper_id}",
        )

    track_event(
        "paper_note_updated",
        properties={
            "paper_id": str(updated_paper_note.paper_id),
            "note_id": str(updated_paper_note.id),
            "content_length": (
                len(str(updated_paper_note.content))
                if updated_paper_note.content
                else 0
            ),
        },
        user_id=str(current_user.id) if current_user else None,
    )

    return JSONResponse(content=updated_paper_note.to_dict(), status_code=200)


@paper_router.get("/conversation")
async def get_mru_paper_conversation(
    paper_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """
    Get latest conversation associated with specific document
    """
    casted_paper_id = uuid.UUID(paper_id)

    # Fetch the document from the database
    document = paper_crud.get(
        db, id=paper_id, user=current_user, update_last_accessed=True
    )

    if not document:
        return JSONResponse(status_code=404, content={"message": "Document not found"})

    # Fetch the latest conversation associated with the document
    conversations = conversation_crud.get_document_conversations(
        db, paper_id=casted_paper_id, current_user=current_user
    )

    if not conversations or len(conversations) == 0:
        # No conversations found for the document
        logger.info(f"No conversations found for document ID {paper_id}")
        return JSONResponse(
            status_code=404, content={"message": "No conversations found"}
        )

    latest_conversation = conversations[-1]

    # Prepare the response data
    conversation_data = (
        latest_conversation.to_dict()
    )  # Assuming to_dict() method exists

    # Return the conversation data
    return JSONResponse(status_code=200, content=conversation_data)


@paper_router.get("")
async def get_pdf(
    request: Request,
    id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """
    Get a document by ID
    """
    # Fetch the document from the database
    paper = paper_crud.get(db, id=id, user=current_user, update_last_accessed=True)

    if not paper:
        return JSONResponse(status_code=404, content={"message": "Document not found"})

    paper_data = paper.to_dict()

    signed_url = s3_service.get_cached_presigned_url(
        db,
        paper_id=str(paper.id),
        object_key=str(paper.s3_object_key),
        current_user=current_user,
    )
    if not signed_url:
        return JSONResponse(status_code=404, content={"message": "File not found"})

    paper_data["file_url"] = signed_url
    paper_data["summary_citations"] = [  # type: ignore
        ResponseCitation.model_validate(citation).model_dump()
        for citation in paper.summary_citations or []
    ]

    paper_data["summary"] = paper_crud.get_summary_replace_image_placeholders(
        db, paper_id=id, current_user=current_user
    )

    # Return the file URL
    return JSONResponse(status_code=200, content=paper_data)


@paper_router.post("/share")
async def share_pdf(
    request: Request,
    id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """
    Share a document by ID
    """
    # Fetch the document from the database
    paper = paper_crud.get(db, id=id, user=current_user)

    paper_crud.make_public(db, paper_id=id, user=current_user)
    if not paper:
        return JSONResponse(status_code=404, content={"message": "Document not found"})

    track_event(
        "paper_share",
        properties={
            "paper_id": str(paper.id),
            "share_id": paper.share_id,
        },
        user_id=str(current_user.id),
    )

    # Return the generated share id
    return JSONResponse(
        status_code=200,
        content={
            "message": "Document shared successfully",
            "share_id": paper.share_id,
        },
    )


@paper_router.post("/unshare")
async def unshare_pdf(
    request: Request,
    id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """
    Unshare a document by ID
    """
    # Fetch the document from the database
    paper = paper_crud.get(db, id=id, user=current_user)

    if not paper:
        return JSONResponse(status_code=404, content={"message": "Document not found"})

    paper_crud.make_private(db, paper_id=id, user=current_user)

    track_event(
        "paper_unshare",
        properties={
            "paper_id": str(paper.id),
            "share_id": paper.share_id,
        },
        user_id=str(current_user.id),
    )

    # Return the generated share id
    return JSONResponse(
        status_code=200,
        content={
            "message": "Document unshared successfully",
        },
    )


@paper_router.get("/share")
async def get_shared_pdf(
    request: Request,
    id: str,
    db: Session = Depends(get_db),
    current_user: Optional[CurrentUser] = Depends(get_current_user),
):
    """
    Get a shared document by ID
    """
    # Fetch the document from the database
    response = {}

    paper = paper_crud.get_public_paper(db, share_id=id)

    if not paper:
        return JSONResponse(status_code=404, content={"message": "Document not found"})

    paper_data = paper.to_dict()

    signed_url = s3_service.get_cached_presigned_url_by_owner(
        db,
        paper_id=str(paper.id),
        object_key=str(paper.s3_object_key),
        owner_id=str(paper.user_id),
    )
    if not signed_url:
        return JSONResponse(status_code=404, content={"message": "File not found"})

    annotations = annotation_crud.get_public_annotations_data_by_paper_id(
        db, share_id=uuid.UUID(id)
    )

    highlights = highlight_crud.get_public_highlights_data_by_paper_id(db, share_id=id)

    paper_data["file_url"] = signed_url
    paper_data["summary_citations"] = [  # type: ignore
        ResponseCitation.model_validate(citation).model_dump()
        for citation in paper.summary_citations or []
    ]
    paper_data["summary"] = (
        paper_crud.get_summary_replace_image_placeholders_shared_paper(
            db, paper_id=str(paper.id)
        )
    )
    response["paper"] = paper_data
    response["highlights"] = [highlight.to_dict() for highlight in highlights]
    response["annotations"] = [annotation.to_dict() for annotation in annotations]
    response["owner"] = {"name": paper.user.name, "picture": paper.user.picture}

    track_event(
        "paper_shared_view",
        properties={
            "paper_id": str(paper.id),
            "share_id": paper.share_id,
        },
        user_id=str(current_user.id) if current_user else None,
    )

    # Return the file URL
    return JSONResponse(status_code=200, content=response)


@paper_router.delete("")
async def delete_pdf(
    request: Request,
    id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """
    Delete a document by ID
    """
    # Fetch the document from the database
    paper = paper_crud.get(db, id=id, user=current_user)

    if not paper:
        return JSONResponse(status_code=404, content={"message": "Document not found"})

    s3_object_key = paper.s3_object_key

    # Delete the document from the database
    try:
        projects = project_paper_crud.get_projects_by_paper_id(
            db, paper_id=uuid.UUID(id), user=current_user
        )

        if len(projects) > 0:
            return JSONResponse(
                status_code=400,
                content={
                    "message": "Cannot delete document associated with projects. Please remove the document from all projects before deleting."
                },
            )

        removed_paper = paper_crud.remove(db, id=id, user=current_user)
        if not removed_paper:
            return JSONResponse(
                status_code=500, content={"message": "Failed to delete document"}
            )

        # Delete the file from S3 if s3_object_key exists
        if s3_object_key:
            s3_service.delete_file(str(s3_object_key))
            logger.info(f"Deleted S3 object: {s3_object_key}")

        return JSONResponse(status_code=200, content={"message": "Document deleted"})
    except Exception as e:
        logger.error(f"Error deleting document: {str(e)}")
        return JSONResponse(
            status_code=500,
            content={"message": f"Error deleting document: {str(e)}"},
        )
