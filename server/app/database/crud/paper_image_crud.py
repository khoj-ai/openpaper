import logging
import uuid
from typing import List, Optional

from app.database.crud.base_crud import CRUDBase
from app.database.models import Paper, PaperImage
from app.schemas.user import CurrentUser
from pydantic import BaseModel
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


# Define Pydantic models for type safety
class PaperImageBase(BaseModel):
    paper_id: uuid.UUID
    s3_object_key: str
    image_url: str
    format: str
    size_bytes: int
    width: int
    height: int
    page_number: int
    image_index: int
    placeholder_id: str
    caption: Optional[str] = None


class PaperImageCreate(PaperImageBase):
    pass


class PaperImageUpdate(BaseModel):
    s3_object_key: Optional[str] = None
    image_url: Optional[str] = None
    format: Optional[str] = None
    size_bytes: Optional[int] = None
    width: Optional[int] = None
    height: Optional[int] = None
    page_number: Optional[int] = None
    image_index: Optional[int] = None
    caption: Optional[str] = None
    placeholder_id: Optional[str] = None


# Paper Image CRUD that inherits from the base CRUD
class PaperImageCRUD(CRUDBase[PaperImage, PaperImageCreate, PaperImageUpdate]):
    """CRUD operations specifically for PaperImage model"""

    def create_with_paper_validation(
        self, db: Session, *, obj_in: PaperImageCreate, user: CurrentUser
    ) -> Optional[PaperImage]:
        """
        Create a paper image with validation that the paper exists and belongs to the user
        """
        # Verify the paper exists and belongs to the user
        paper = (
            db.query(Paper)
            .filter(Paper.id == obj_in.paper_id, Paper.user_id == user.id)
            .first()
        )

        if not paper:
            raise ValueError(
                f"Paper with ID {obj_in.paper_id} not found or doesn't belong to user"
            )

        return self.create(db, obj_in=obj_in, user=user)

    def create_multiple_with_paper_validation(
        self, db: Session, *, images: List[PaperImageCreate], user: CurrentUser
    ) -> List[PaperImage]:
        """
        Create multiple paper images with validation that the papers exist and belong to the user
        """
        if not images:
            return []

        # Get all unique paper IDs
        paper_ids = list(set(img.paper_id for img in images))

        # Verify all papers exist and belong to the user
        existing_papers = (
            db.query(Paper.id)
            .filter(Paper.id.in_(paper_ids), Paper.user_id == user.id)
            .all()
        )

        existing_paper_ids = {paper.id for paper in existing_papers}

        # Check if any paper IDs are missing
        missing_paper_ids = set(paper_ids) - existing_paper_ids
        if missing_paper_ids:
            raise ValueError(
                f"Papers with IDs {missing_paper_ids} not found or don't belong to user"
            )

        # Create all images
        created_images = []
        for image in images:
            created_image = self.create(db, obj_in=image, user=user)
            if created_image:
                created_images.append(created_image)

        return created_images

    def get_by_paper_id(
        self, db: Session, *, paper_id: str, user: CurrentUser
    ) -> List[PaperImage]:
        """
        Get all images for a specific paper
        """
        # First verify the paper belongs to the user
        paper = (
            db.query(Paper)
            .filter(Paper.id == paper_id, Paper.user_id == user.id)
            .first()
        )

        if not paper:
            raise ValueError(
                f"Paper with ID {paper_id} not found or doesn't belong to user"
            )

        return (
            db.query(PaperImage)
            .filter(PaperImage.paper_id == paper_id)
            .order_by(PaperImage.page_number, PaperImage.image_index)
            .all()
        )


# Create a single instance to use throughout the application
paper_image_crud = PaperImageCRUD(PaperImage)
