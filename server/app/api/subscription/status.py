import logging
from datetime import datetime, timezone

import stripe
from app.api.subscription.config import (
    MONTHLY_PRICE_ID,
    YEARLY_PRICE_ID,
    SubscriptionInterval,
)
from app.auth.dependencies import get_required_user
from app.database.crud.subscription_crud import subscription_crud
from app.database.database import get_db
from app.helpers.subscription_limits import get_user_usage_info
from app.schemas.user import CurrentUser
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/user-subscription")
async def get_user_subscription(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """Get the current user's subscription status"""
    try:
        subscription = subscription_crud.get_by_user_id(db, current_user.id)

        if not subscription:
            return {"has_subscription": False, "subscription": None}

        plan_interval = None

        # If we have a Stripe subscription ID, get the latest data from Stripe
        if subscription and subscription.stripe_subscription_id:
            try:
                sub_id = str(subscription.stripe_subscription_id)
                stripe_sub = stripe.Subscription.retrieve(sub_id)

                # Update subscription in database with latest info from Stripe
                if hasattr(stripe_sub, "status"):
                    # Convert timestamps to datetime objects
                    period_start = None
                    period_end = None

                    # Period dates are on the subscription item, not the subscription
                    sub_item = (
                        stripe_sub["items"]["data"][0]
                        if stripe_sub["items"] and stripe_sub["items"]["data"]
                        else None
                    )
                    if sub_item and getattr(sub_item, "current_period_start", None):
                        period_start = datetime.fromtimestamp(
                            sub_item.current_period_start
                        )
                    if sub_item and getattr(sub_item, "current_period_end", None):
                        period_end = datetime.fromtimestamp(sub_item.current_period_end)

                    # Extract the product_id from the price object
                    stripe_price_id = (
                        sub_item.price.id
                        if sub_item and getattr(sub_item, "price", None)
                        else None
                    )
                    if stripe_price_id not in [MONTHLY_PRICE_ID, YEARLY_PRICE_ID]:
                        logger.info(
                            f"Skipping subscription update for unsupported price ID: {stripe_price_id}"
                        )
                        return {"has_subscription": False, "subscription": None}

                    # Determine plan interval based on price ID
                    if stripe_price_id == MONTHLY_PRICE_ID:
                        plan_interval = SubscriptionInterval.MONTHLY
                    elif stripe_price_id == YEARLY_PRICE_ID:
                        plan_interval = SubscriptionInterval.YEARLY

                    # Update subscription status
                    subscription = subscription_crud.update_subscription_status(
                        db,
                        sub_id,
                        stripe_sub["status"],
                        stripe_price_id=stripe_price_id,
                        period_start=period_start,
                        period_end=period_end,
                    )
            except Exception as e:
                # Log error but continue with local data
                pass

        # Guard against None
        if not subscription:
            return {"has_subscription": False, "subscription": None}

        # Format response
        status = str(subscription.status) if subscription.status else "inactive"
        current_period_end = subscription.current_period_end
        current_period_start = subscription.current_period_start
        cancel_at_period_end = (
            bool(subscription.cancel_at_period_end)
            if subscription.cancel_at_period_end is not None
            else False
        )

        is_valid_subscription = (
            current_period_end is not None
            and current_period_end > datetime.now(tz=timezone.utc)
        )

        # Determine if user had a subscription (has a record with stripe_subscription_id)
        had_subscription = subscription.stripe_subscription_id is not None

        # Check if the subscription needs payment attention
        requires_payment_update = status in ["past_due", "unpaid", "incomplete"]

        # Build scheduled_change info if a schedule exists
        scheduled_change = None
        if subscription.stripe_schedule_id and plan_interval:
            scheduled_new_interval = (
                "year" if plan_interval == SubscriptionInterval.MONTHLY else "month"
            )
            scheduled_change = {
                "new_interval": scheduled_new_interval,
                "effective_date": (
                    current_period_end.isoformat() if current_period_end else None
                ),
            }

        return {
            "has_subscription": is_valid_subscription,
            "had_subscription": had_subscription,
            "requires_payment_update": requires_payment_update,
            "subscription": {
                "status": status,
                "interval": plan_interval,
                "current_period_start": current_period_start,
                "current_period_end": current_period_end,
                "cancel_at_period_end": cancel_at_period_end,
            },
            "scheduled_change": scheduled_change,
        }

    except Exception as e:
        logger.error(f"Error getting user subscription: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/usage")
async def get_user_usage(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """Get the current user's subscription usage and limits"""
    try:
        usage_info = get_user_usage_info(db, current_user)
        return usage_info
    except Exception as e:
        logger.error(f"Error getting user usage: {e}")
        raise HTTPException(status_code=500, detail=str(e))
