"""User-facing referral API routes."""

import logging

from app.api.referral.service import (
    ReferralAttributionError,
    attribute_referral,
    get_summary_payload,
)
from app.auth.dependencies import get_required_user
from app.database.crud.user_crud import user as user_crud
from app.database.database import get_db
from app.database.models import ReferralAttributionMethod
from app.database.telemetry import track_event
from app.schemas.user import CurrentUser
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

router = APIRouter()


class AttributeRequest(BaseModel):
    code: str
    via_link: bool = True


@router.get("/me")
async def get_my_referral_info(
    current_user: CurrentUser = Depends(get_required_user),
    db: Session = Depends(get_db),
):
    user = user_crud.get(db, id=current_user.id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )
    return get_summary_payload(db, user)


@router.post("/attribute")
async def attribute(
    request: AttributeRequest,
    current_user: CurrentUser = Depends(get_required_user),
    db: Session = Depends(get_db),
):
    user = user_crud.get(db, id=current_user.id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )

    method = (
        ReferralAttributionMethod.LINK
        if request.via_link
        else ReferralAttributionMethod.MANUAL_CODE
    )
    try:
        referral = attribute_referral(
            db,
            referee=user,
            code=request.code,
            attribution_method=method,
        )
    except ReferralAttributionError as e:
        return {"success": False, "reason": str(e)}

    if referral is None:
        return {"success": False, "reason": "Could not attribute referral"}

    track_event(
        "referral_attributed",
        user_id=str(user.id),
        properties={
            "referral_id": str(referral.id),
            "referrer_user_id": str(referral.referrer_user_id),
            "attribution_method": str(referral.attribution_method),
        },
        db=db,
    )

    return {"success": True, "referral_id": str(referral.id)}
