"""Service-layer logic for in-app referrals."""

import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import stripe
from app.database.crud.referral_crud import referral_code_crud, referral_crud
from app.database.crud.user_crud import user as user_crud
from app.database.models import (
    Referral,
    ReferralAttributionMethod,
    ReferralStatus,
    User,
)
from app.database.telemetry import track_event
from app.helpers.abuse_detection import (
    check_referral_fraud,
    send_referral_threshold_alert,
)
from app.helpers.email import send_referral_converted_email
from app.helpers.referral_jobs import schedule_referral_settlement
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

CLIENT_DOMAIN = os.getenv("CLIENT_DOMAIN", "http://localhost:3000")

# How long after attribution a coupon and the attribution itself remain valid.
ATTRIBUTION_WINDOW_DAYS = 30
# Only freshly-created accounts may be attributed as referees. Prevents an
# existing user from pasting a stranger's code months later to get a discount.
REFEREE_FRESHNESS_HOURS = 24
# Stripe coupon configuration.
REFEREE_DISCOUNT_PERCENT = 50
# How long the referrer's credit sits in pending before becoming spendable.
CREDIT_HOLD_DAYS = 30
# Total pending+available credit (in cents) that triggers an admin review alert.
REVIEW_THRESHOLD_CENTS = 6000


class ReferralAttributionError(Exception):
    """Raised when a referral attribution cannot be applied."""


def build_share_url(code: str) -> str:
    return f"{CLIENT_DOMAIN}/?r={code}"


def get_summary_payload(db: Session, user: User) -> dict:
    code = referral_code_crud.get_or_create_for_user(db, user.id)  # type: ignore[arg-type]
    summary = referral_crud.get_summary_for_referrer(db, user.id)  # type: ignore[arg-type]
    return {
        "code": code.code,
        "share_url": build_share_url(str(code.code)),
        "referrer_credit_cents_per_referral": 600,
        "referee_discount_percent": REFEREE_DISCOUNT_PERCENT,
        "credit_hold_days": CREDIT_HOLD_DAYS,
        "summary": summary,
        "toast_seen": user.referral_toast_seen_at is not None,
    }


def _create_referee_coupon(referral: Referral) -> Optional[str]:
    """
    Create a one-time Stripe coupon bound to this specific referee.

    Returns the coupon ID on success, None on failure (caller decides if that
    aborts attribution — for now we keep the attribution row and skip the
    discount, which still lets the referrer earn credit on conversion).
    """
    try:
        redeem_by = int(
            (
                datetime.now(timezone.utc) + timedelta(days=ATTRIBUTION_WINDOW_DAYS)
            ).timestamp()
        )
        coupon = stripe.Coupon.create(
            percent_off=REFEREE_DISCOUNT_PERCENT,
            duration="once",
            max_redemptions=1,
            redeem_by=redeem_by,
            metadata={
                "referral_id": str(referral.id),
                "referrer_user_id": str(referral.referrer_user_id),
                "referee_user_id": str(referral.referee_user_id),
            },
        )
        return coupon.id
    except Exception as e:
        logger.error(
            f"Failed to create referee coupon for referral {referral.id}: {e}",
            exc_info=True,
        )
        return None


def attribute_referral(
    db: Session,
    *,
    referee: User,
    code: str,
    attribution_method: ReferralAttributionMethod,
) -> Optional[Referral]:
    """
    Record that `referee` was referred via `code`. Idempotent — if the referee
    already has any referral row (in any state) we return it unchanged.

    Raises ReferralAttributionError for invalid codes or fraud rejections.
    """
    code = code.strip().upper()
    if not code:
        raise ReferralAttributionError("Referral code is required")

    existing = referral_crud.get_by_referee(db, referee.id)  # type: ignore[arg-type]
    if existing:
        return existing

    if referee.created_at is None or referee.created_at < datetime.now(  # type: ignore[operator]
        timezone.utc
    ) - timedelta(
        hours=REFEREE_FRESHNESS_HOURS
    ):
        raise ReferralAttributionError(
            "Referral codes can only be applied to brand-new accounts"
        )

    referral_code = referral_code_crud.get_by_code(db, code)
    if referral_code is None:
        raise ReferralAttributionError("Unknown referral code")

    referrer = user_crud.get(db, id=referral_code.user_id)
    if referrer is None:
        raise ReferralAttributionError("Referrer no longer exists")

    is_clean, reason = check_referral_fraud(referrer, referee)
    if not is_clean:
        logger.info(
            f"Rejecting referral attribution for referee={referee.id} code={code} reason={reason}"
        )
        raise ReferralAttributionError(f"Referral rejected: {reason}")

    referral = referral_crud.create_attribution(
        db,
        referrer_user_id=uuid.UUID(str(referrer.id)),
        referee_user_id=uuid.UUID(str(referee.id)),
        code_used=code,
        attribution_method=attribution_method,
    )
    if referral is None:
        raise ReferralAttributionError("Could not record referral attribution")

    coupon_id = _create_referee_coupon(referral)
    if coupon_id:
        referral_crud.set_referee_coupon(db, referral, coupon_id)

    return referral


def handle_referee_converted(db: Session, referee_user_id: uuid.UUID) -> None:
    """
    Called from the Stripe subscription webhook when a user converts to a paid
    plan. If the user has an attributed referral, runs the second-pass fraud
    check, marks the referral credit_pending, schedules the settlement
    callback, emails the referrer, and alerts admin if a review threshold is
    crossed. All-or-nothing semantics: any failure here is logged but does not
    abort subscription creation.
    """
    referral = referral_crud.get_attributed_for_referee(db, referee_user_id)
    if referral is None:
        return

    referrer = user_crud.get(db, id=referral.referrer_user_id)
    referee = user_crud.get(db, id=referee_user_id)
    if referrer is None or referee is None:
        logger.error(f"Could not load referrer/referee for referral {referral.id}")
        return

    is_clean, reason = check_referral_fraud(referrer, referee)
    if not is_clean:
        referral_crud.mark_rejected_fraud(db, referral, reason or "fraud_check_failed")
        track_event(
            "referral_fraud_rejected",
            user_id=str(referee_user_id),
            properties={"referral_id": str(referral.id), "reason": reason},
            db=db,
        )
        return

    now = datetime.now(timezone.utc)
    credit_available_at = now + timedelta(days=CREDIT_HOLD_DAYS)
    referral_crud.mark_credit_pending(
        db, referral, converted_at=now, credit_available_at=credit_available_at
    )

    schedule_referral_settlement(str(referral.id), eta=credit_available_at)

    try:
        send_referral_converted_email(
            to_email=str(referrer.email),
            referee_email=str(referee.email),
            credit_cents=int(referral.referrer_credit_cents),  # type: ignore[arg-type]
            available_at=credit_available_at,
        )
    except Exception as e:
        logger.error(f"Failed to send referral_converted email: {e}", exc_info=True)

    summary = referral_crud.get_summary_for_referrer(db, uuid.UUID(str(referrer.id)))
    if summary["pending_cents"] + summary["available_cents"] >= REVIEW_THRESHOLD_CENTS:
        send_referral_threshold_alert(
            referrer, summary["pending_cents"] + summary["available_cents"]
        )

    track_event(
        "referral_converted",
        user_id=str(referee_user_id),
        properties={
            "referral_id": str(referral.id),
            "referrer_user_id": str(referrer.id),
        },
        db=db,
    )


def get_active_attributed_referral(
    db: Session, referee_user_id: uuid.UUID
) -> Optional[Referral]:
    """
    Return the referee's attributed (un-converted) referral if it's still
    within the attribution window. Used at checkout to apply the coupon.
    """
    referral = referral_crud.get_attributed_for_referee(db, referee_user_id)
    if not referral:
        return None

    cutoff = datetime.now(timezone.utc) - timedelta(days=ATTRIBUTION_WINDOW_DAYS)
    if referral.created_at and referral.created_at < cutoff:  # type: ignore[operator]
        return None

    return referral
