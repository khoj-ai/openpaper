import logging
import uuid

import stripe
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

        # Add telemetry
        track_event(
            event_name="checkout_initiated",
            properties={
                "interval": interval,
            },
            user_id=str(current_user.id),
        )

        # Add customer if available
        if customer_id:
            session_params["customer"] = str(customer_id)

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
