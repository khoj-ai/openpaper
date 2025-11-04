import logging
import uuid

from app.auth.dependencies import get_required_user
from app.database.crud.paper_tag_crud import PaperTagCreate, paper_tag_crud
from app.database.database import get_db
from app.schemas.paper_tag import BulkTagRequest
from app.schemas.user import CurrentUser
from dotenv import load_dotenv
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

load_dotenv()

logger = logging.getLogger(__name__)

paper_tag_router = APIRouter()


@paper_tag_router.post("/", status_code=201)
def create_tag(
    tag_in: PaperTagCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """
    Create a new tag for the current user.
    """
    tag = paper_tag_crud.create(db, obj_in=tag_in, user=current_user)
    return {"id": str(tag.id), "name": tag.name, "color": tag.color}


@paper_tag_router.get("/")
def get_all_tags(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """
    Get all tags for the current user.
    """
    tags = paper_tag_crud.get_multi(db, user=current_user)
    return [{"id": str(t.id), "name": t.name, "color": t.color} for t in tags]


@paper_tag_router.post("/bulk", status_code=200)
def bulk_add_tags(
    request: BulkTagRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """
    Apply multiple tags to multiple papers.
    """
    try:
        paper_tag_crud.bulk_add_tags_to_papers(
            db,
            paper_ids=request.paper_ids,
            tag_ids=request.tag_ids,
            user=current_user,
        )
        return {"message": "Tags applied successfully."}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to apply tags in bulk: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to apply tags.")


@paper_tag_router.delete("/papers/{paper_id}/tags/{tag_id}", status_code=204)
def remove_tag_from_paper(
    paper_id: str,
    tag_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """
    Remove a tag from a specific paper.
    """
    paper_tag_crud.remove_tag_from_paper(
        db,
        paper_id=uuid.UUID(paper_id),
        tag_id=uuid.UUID(tag_id),
        user=current_user,
    )
    return


@paper_tag_router.get("/papers/{paper_id}/tags")
def get_tags_for_paper(
    paper_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """
    Get all tags for a specific paper.
    """
    tags = paper_tag_crud.get_tags_for_paper(
        db, paper_id=uuid.UUID(paper_id), user=current_user
    )
    return [{"id": str(t.id), "name": t.name, "color": t.color} for t in tags]


@paper_tag_router.get("/tags/{tag_id}/papers")
def get_papers_for_tag(
    tag_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """
    Get all papers associated with a specific tag.
    """
    papers = paper_tag_crud.get_papers_for_tag(
        db, tag_id=uuid.UUID(tag_id), user=current_user
    )
    return [
        {
            "id": str(p.id),
            "title": p.title,
            "authors": p.authors,
            "publish_date": p.publish_date,
        }
        for p in papers
    ]
