import logging
import uuid

import stripe
from app.api.referral.service import get_active_attributed_referral
from app.api.subscription.config import (
    MONTHLY_PRICE_ID,
    YEARLY_PRICE_ID,
    YOUR_DOMAIN,
    SubscriptionInterval,
)
from app.auth.dependencies import get_required_user
from app.database.crud.subscription_crud import subscription_crud
from app.database.database import get_db
from app.database.models import SubscriptionStatus
from app.database.telemetry import track_event
from app.schemas.user import CurrentUser
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/create-checkout-session")
def create_checkout_session(
    interval: SubscriptionInterval,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    if interval not in SubscriptionInterval:
        raise HTTPException(status_code=400, detail="Invalid subscription interval")

    try:
        # Get or initialize customer ID
        subscription = subscription_crud.get_by_user_id(db, current_user.id)
        customer_id = None

        # Prevent duplicate subscriptions - if user already has an active or past_due subscription,
        # they should use the customer portal to manage it instead of creating a new one
        if subscription and subscription.status in [
            SubscriptionStatus.ACTIVE,
            SubscriptionStatus.PAST_DUE,
            SubscriptionStatus.TRIALING,
        ]:
            raise HTTPException(
                status_code=400,
                detail="You already have an active subscription. Please use the customer portal to manage your subscription or update your payment method.",
            )

        # Cancel any incomplete Stripe subscription before creating a new checkout session
        # This handles the case where a user's first payment attempt failed
        if (
            subscription
            and subscription.status == SubscriptionStatus.INCOMPLETE
            and subscription.stripe_subscription_id
        ):
            try:
                stripe.Subscription.cancel(str(subscription.stripe_subscription_id))
                logger.info(
                    f"Canceled incomplete subscription {subscription.stripe_subscription_id} for user {current_user.id}"
                )
            except Exception as e:
                logger.warning(
                    f"Failed to cancel incomplete subscription {subscription.stripe_subscription_id}: {e}"
                )

        # Create a Stripe Checkout session
        price_id = (
            MONTHLY_PRICE_ID
            if interval == SubscriptionInterval.MONTHLY
            else YEARLY_PRICE_ID
        )

        if subscription and subscription.stripe_customer_id:
            customer_id = subscription.stripe_customer_id
        else:
            # Create a new customer in Stripe
            customer = stripe.Customer.create(
                email=current_user.email,
                name=current_user.name if current_user.name else current_user.email,
                metadata={"user_id": str(current_user.id)},
            )
            customer_id = customer.id

            # Store customer ID in database
            if not subscription:
                subscription_crud.create_or_update(
                    db, current_user.id, {"stripe_customer_id": customer_id}
                )

        if not price_id:
            raise HTTPException(status_code=500, detail="Price ID not configured")

        # Create session parameters
        session_params = {
            "ui_mode": "embedded_page",
            "client_reference_id": str(current_user.id),
            "line_items": [{"quantity": 1, "price": price_id}],
            "mode": "subscription",
            "allow_promotion_codes": True,
            "return_url": f"{YOUR_DOMAIN}/subscribed?session_id={{CHECKOUT_SESSION_ID}}",
        }

        # If the user was referred and is still within the attribution window,
        # auto-apply their one-time coupon. Stripe rejects discounts alongside
        # allow_promotion_codes, so we drop the latter for referred sessions.
        #
        # We don't pre-check the coupon's validity via stripe.Coupon.retrieve.
        # get_active_attributed_referral already enforces our attribution
        # window, which matches the redeem_by we set on the Stripe coupon at
        # attribution time. The only way the two disagree is clock skew (or a
        # coupon manually deleted in the Stripe dashboard), and we catch that
        # rare case in the Session.create try/except below — cheaper than a
        # round-trip on every referred checkout.
        attributed_referral = get_active_attributed_referral(db, current_user.id)
        if attributed_referral and attributed_referral.referee_coupon_id:
            session_params["discounts"] = [
                {"coupon": str(attributed_referral.referee_coupon_id)}
            ]
            session_params.pop("allow_promotion_codes", None)

        # Add telemetry
        track_event(
            event_name="checkout_initiated",
            properties={
                "interval": interval,
                "has_referral_discount": bool(
                    attributed_referral and attributed_referral.referee_coupon_id
                ),
            },
            user_id=str(current_user.id),
            db=db,
        )

        # Add customer if available
        if customer_id:
            session_params["customer"] = str(customer_id)

        try:
            session = stripe.checkout.Session.create(**session_params)
        except stripe.InvalidRequestError as e:  # type: ignore[attr-defined]
            # Most common cause: the referral coupon expired between
            # attribution and checkout (Stripe enforces redeem_by independently
            # of our DB window). Drop the discount and retry once so checkout
            # still succeeds — the referrer can still earn credit when this
            # user converts, but the referee discount is forfeited.
            is_expired_coupon = (
                "discounts" in session_params
                and getattr(e, "code", None) == "coupon_expired"
            )
            if not is_expired_coupon:
                raise
            logger.warning(
                f"Referral coupon expired for user {current_user.id}, "
                f"retrying checkout without discount: {e}"
            )
            track_event(
                event_name="referral_coupon_expired_at_checkout",
                properties={"interval": interval},
                user_id=str(current_user.id),
                db=db,
            )
            session_params.pop("discounts", None)
            # Restore the promo-code entry point we dropped earlier so the user
            # can still type one manually if they have one.
            session_params["allow_promotion_codes"] = True
            session = stripe.checkout.Session.create(**session_params)

        return {"client_secret": session.client_secret}

    except Exception as e:
        logger.error(f"Error creating checkout session: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/session-status")
async def session_status(
    session_id: str,
    db: Session = Depends(get_db),
):
    try:
        session = stripe.checkout.Session.retrieve(session_id)
        customer_email = None
        backend_subscription_status = None
        backend_subscription_found = False

        if (
            hasattr(session, "customer_details")
            and session.customer_details is not None
        ):
            customer_email = session.customer_details.email

        # If the session is complete, also check our backend subscription status
        if session.status == "complete":
            # Get the client_reference_id which contains our user ID
            client_reference_id = session.client_reference_id
            subscription_id = session.subscription

            if client_reference_id:
                try:
                    # Check if we have the subscription in our database
                    user_id = uuid.UUID(client_reference_id)
                    subscription = subscription_crud.get_by_user_id(db, user_id)

                    if subscription and subscription.stripe_subscription_id:
                        backend_subscription_found = True
                        backend_subscription_status = (
                            str(subscription.status)
                            if subscription.status
                            else "unknown"
                        )

                        # Double-check that the subscription IDs match
                        if str(subscription.stripe_subscription_id) != subscription_id:
                            logger.warning(
                                f"Subscription ID mismatch for user {user_id}: "
                                f"session subscription {subscription_id} vs "
                                f"backend subscription {subscription.stripe_subscription_id}"
                            )
                    else:
                        logger.warning(
                            f"No subscription found in backend for user {user_id} "
                            f"despite completed checkout session {session_id}"
                        )

                except ValueError as ve:
                    logger.error(
                        f"Invalid user ID in session client_reference_id: {client_reference_id}"
                    )
                except Exception as be:
                    logger.error(f"Error checking backend subscription status: {be}")

        return {
            "status": session.status,
            "customer_email": customer_email,
            "backend_subscription_found": backend_subscription_found,
            "backend_subscription_status": backend_subscription_status,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
