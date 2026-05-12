"""User-facing referral API routes."""

import logging
from datetime import datetime, timezone

from app.api.referral.service import (
    REFEREE_DISCOUNT_PERCENT,
    ReferralAttributionError,
    attribute_referral,
    get_active_attributed_referral,
    get_summary_payload,
)
from app.auth.dependencies import get_required_user
from app.database.crud.referral_crud import referral_crud
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


@router.get("/balance")
async def get_balance(
    current_user: CurrentUser = Depends(get_required_user),
    db: Session = Depends(get_db),
):
    """Read-only referral standing for the current user.

    Used by surfaces that want to show "you have $X waiting" or "50% off
    waiting" without lazy-creating a referral code for users who haven't
    engaged with the share flow.
    """
    summary = referral_crud.get_summary_for_referrer(db, current_user.id)
    attributed = get_active_attributed_referral(db, current_user.id)
    return {
        "pending_cents": summary["pending_cents"],
        "available_cents": summary["available_cents"],
        "total_converted": summary["total_converted"],
        "referee_discount_percent": REFEREE_DISCOUNT_PERCENT,
        "referee_discount_available": bool(attributed and attributed.referee_coupon_id),
    }


@router.get("/toast-status")
async def get_toast_status(
    current_user: CurrentUser = Depends(get_required_user),
    db: Session = Depends(get_db),
):
    """Lightweight check for whether the milestone toast should be considered.

    Distinct from /me — does not lazy-create a referral code, so calling it on
    every authenticated page load is cheap and doesn't clutter the DB.
    """
    user = user_crud.get(db, id=current_user.id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )
    return {"toast_seen": user.referral_toast_seen_at is not None}


@router.post("/toast-seen")
async def mark_toast_seen(
    current_user: CurrentUser = Depends(get_required_user),
    db: Session = Depends(get_db),
):
    """Idempotent: stamp the user as having seen the referral milestone toast."""
    user = user_crud.get(db, id=current_user.id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )
    if user.referral_toast_seen_at is None:
        setattr(user, "referral_toast_seen_at", datetime.now(timezone.utc))
        db.commit()
    return {"success": True}
