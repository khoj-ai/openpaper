import logging

from app.auth.dependencies import get_required_user
from app.database.crud.onboarding_crud import OnboardingCreate, onboarding_crud
from app.database.database import get_db
from app.database.telemetry import track_event
from app.helpers.email import send_profile_email
from app.schemas.user import CurrentUser
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy.sql import func

logger = logging.getLogger(__name__)

# Create API router
onboarding_router = APIRouter()


class CreateOnboardingRequest(BaseModel):
    name: str
    email: str
    company: str | None = None
    research_fields: str | None = None
    research_fields_other: str | None = None
    job_titles: str | None = None
    job_titles_other: str | None = None
    reading_frequency: str | None = None
    referral_source: str | None = None
    referral_source_other: str | None = None


@onboarding_router.post("")
async def create_onboarding(
    request: CreateOnboardingRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
) -> JSONResponse:
    """Create or update onboarding data for a user"""
    try:
        # Check if onboarding already exists for this user
        existing_onboarding = onboarding_crud.get_by(db, user=current_user)

        if existing_onboarding:
            # Update existing onboarding
            onboarding = onboarding_crud.update(
                db,
                db_obj=existing_onboarding,
                obj_in=request.model_dump(exclude_unset=True),
            )
            db.commit()
        else:
            # Create new onboarding
            onboarding = onboarding_crud.create(
                db,
                obj_in=OnboardingCreate(
                    user_id=current_user.id, **request.model_dump(exclude_unset=True)
                ),
                user=current_user,
            )
            db.commit()

        if not onboarding:
            return JSONResponse(
                status_code=404,
                content={"message": "Onboarding not found"},
            )

        prepared_onboarding = {
            "name": request.name,
            "email": request.email,
            "company": request.company,
            "job_titles_other": request.job_titles_other,
            "research_fields_other": request.research_fields_other,
            "referral_source": request.referral_source,
            "reading_frequency": request.reading_frequency,
        }

        job_titles_str = request.job_titles or ""
        prepared_onboarding["job_titles"] = [
            s.strip() for s in job_titles_str.lower().split(",") if s.strip()
        ]

        research_fields_str = request.research_fields or ""
        prepared_onboarding["research_fields"] = [
            s.strip() for s in research_fields_str.lower().split(",") if s.strip()
        ]

        track_event(
            "onboarding_completed",
            user_id=str(current_user.id),
            properties=prepared_onboarding,
        )

        send_profile_email(onboarding)

        return JSONResponse(
            status_code=201,
            content=onboarding.to_dict(),
        )
    except Exception as e:
        logger.error(f"Error creating/updating onboarding: {e}")
        return JSONResponse(
            status_code=400,
            content={"message": f"Failed to save onboarding data: {str(e)}"},
        )
