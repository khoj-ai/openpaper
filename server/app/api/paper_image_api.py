import logging
from typing import List

from app.auth.dependencies import get_required_user
from app.database.crud.paper_image_crud import paper_image_crud
from app.database.database import get_db
from app.database.telemetry import track_event
from app.helpers.s3 import s3_service
from app.schemas.user import CurrentUser
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# Create API router
paper_image_router = APIRouter()


@paper_image_router.get("/paper/{paper_id}")
async def get_paper_images_with_presigned_urls(
    paper_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
) -> JSONResponse:
    """Get all images for a specific paper with presigned URLs for direct access"""
    try:
        images = paper_image_crud.get_by_paper_id(
            db, paper_id=paper_id, user=current_user
        )

        if not images:
            return JSONResponse(
                status_code=200,
                content=[],
            )

        # Convert images to dict format and add presigned URLs
        image_list = []
        for image in images:
            image_dict = image.to_dict()

            # Generate presigned URL for the image
            presigned_url = s3_service.generate_presigned_url(
                object_key=str(image.s3_object_key)
            )

            if presigned_url:
                image_dict["presigned_url"] = presigned_url
            else:
                logger.warning(f"Could not generate presigned URL for image {image.id}")
                image_dict["presigned_url"] = None

            image_list.append(image_dict)

        track_event("paper_images_with_urls_retrieved", user_id=str(current_user.id))

        return JSONResponse(
            status_code=200,
            content=image_list,
        )
    except ValueError as e:
        logger.error(f"Paper not found or access denied: {e}")
        return JSONResponse(
            status_code=404,
            content={"message": str(e)},
        )
    except Exception as e:
        logger.error(f"Error fetching paper images with URLs: {e}")
        return JSONResponse(
            status_code=400,
            content={"message": f"Failed to fetch paper images with URLs: {str(e)}"},
        )


@paper_image_router.get("/{image_id}")
async def get_paper_image_by_id(
    image_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
) -> JSONResponse:
    """Get a specific paper image by ID"""
    try:
        image = paper_image_crud.get(db, id=image_id, user=current_user)

        if not image:
            return JSONResponse(
                status_code=404,
                content={"message": f"Image with ID {image_id} not found"},
            )

        track_event("paper_image_retrieved", user_id=str(current_user.id))

        return JSONResponse(
            status_code=200,
            content=image.to_dict(),
        )
    except Exception as e:
        logger.error(f"Error fetching paper image: {e}")
        return JSONResponse(
            status_code=400,
            content={"message": f"Failed to fetch paper image: {str(e)}"},
        )


@paper_image_router.get("/{image_id}/with_url")
async def get_paper_image_with_presigned_url(
    image_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
) -> JSONResponse:
    """Get a specific paper image by ID with presigned URL for direct access"""
    try:
        image = paper_image_crud.get(db, id=image_id, user=current_user)

        if not image:
            return JSONResponse(
                status_code=404,
                content={"message": f"Image with ID {image_id} not found"},
            )

        image_dict = image.to_dict()

        # Generate presigned URL for the image
        presigned_url = s3_service.generate_presigned_url(
            object_key=str(image.s3_object_key)
        )

        if presigned_url:
            image_dict["presigned_url"] = presigned_url
        else:
            logger.warning(f"Could not generate presigned URL for image {image.id}")
            return JSONResponse(
                status_code=404,
                content={"message": "Image file not found"},
            )

        track_event("paper_image_with_url_retrieved", user_id=str(current_user.id))

        return JSONResponse(
            status_code=200,
            content=image_dict,
        )
    except Exception as e:
        logger.error(f"Error fetching paper image with URL: {e}")
        return JSONResponse(
            status_code=400,
            content={"message": f"Failed to fetch paper image with URL: {str(e)}"},
        )
