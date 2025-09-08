from typing import Optional
from uuid import UUID

from app.database.crud.base_crud import CRUDBase
from app.database.models import Onboarding
from pydantic import BaseModel
from sqlalchemy.orm import Session


class OnboardingBase(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    company: Optional[str] = None
    research_fields: Optional[str] = None
    research_fields_other: Optional[str] = None
    job_titles: Optional[str] = None
    job_titles_other: Optional[str] = None
    reading_frequency: Optional[str] = None
    referral_source: Optional[str] = None
    referral_source_other: Optional[str] = None


class OnboardingCreate(OnboardingBase):
    user_id: UUID


class OnboardingUpdate(OnboardingBase):
    pass


class OnboardingCrud(CRUDBase[Onboarding, OnboardingCreate, OnboardingUpdate]):
    """CRUD operations specifically for Onboarding model"""

    pass


# Create a single instance to use throughout the application
onboarding_crud = OnboardingCrud(Onboarding)
