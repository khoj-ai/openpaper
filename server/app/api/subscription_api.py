import logging
import os
import uuid
from datetime import datetime
from enum import Enum

import stripe
from app.auth.dependencies import get_required_user
from app.database.crud.subscription_crud import subscription_crud
from app.database.database import get_db
from app.database.models import SubscriptionPlan, SubscriptionStatus
from app.database.telemetry import track_event
from app.schemas.user import CurrentUser
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

STRIPE_API_KEY = os.getenv("STRIPE_API_KEY")
if not STRIPE_API_KEY:
    raise ValueError("STRIPE_API_KEY environment variable is not set")

STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET")

logger = logging.getLogger(__name__)

MONTHLY_PRICE_ID = os.getenv("STRIPE_MONTHLY_PRICE_ID")
YEARLY_PRICE_ID = os.getenv("STRIPE_YEARLY_PRICE_ID")
YOUR_DOMAIN = os.getenv("FRONTEND_URL", "http://localhost:3000")

stripe.api_key = STRIPE_API_KEY

subscription_router = APIRouter()


class SubscriptionInterval(str, Enum):
    MONTHLY = "month"
    YEARLY = "year"


@subscription_router.post("/create-checkout-session")
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
            "ui_mode": "embedded",
            "client_reference_id": str(current_user.id),
            "line_items": [{"quantity": 1, "price": price_id}],
            "mode": "subscription",
            "return_url": f"{YOUR_DOMAIN}/return?session_id={{CHECKOUT_SESSION_ID}}",
        }

        # Add customer if available
        if customer_id:
            session_params["customer"] = str(customer_id)

        session = stripe.checkout.Session.create(**session_params)

        return {"client_secret": session.client_secret}

    except Exception as e:
        logger.error(f"Error creating checkout session: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@subscription_router.get("/session-status")
async def session_status(session_id: str):
    try:
        session = stripe.checkout.Session.retrieve(session_id)
        customer_email = None
        if (
            hasattr(session, "customer_details")
            and session.customer_details is not None
        ):
            customer_email = session.customer_details.email

        return {"status": session.status, "customer_email": customer_email}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@subscription_router.get("/user-subscription")
async def get_user_subscription(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """Get the current user's subscription status"""
    try:
        subscription = subscription_crud.get_by_user_id(db, current_user.id)

        if not subscription:
            return {"has_subscription": False, "subscription": None}

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

                    if hasattr(stripe_sub, "current_period_start"):
                        period_start = datetime.fromtimestamp(
                            stripe_sub["current_period_start"]
                        )

                    if hasattr(stripe_sub, "current_period_end"):
                        period_end = datetime.fromtimestamp(
                            stripe_sub["current_period_end"]
                        )

                    # Update subscription status
                    subscription = subscription_crud.update_subscription_status(
                        db,
                        sub_id,
                        stripe_sub["status"],
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
        cancel_at_period_end = (
            bool(subscription.cancel_at_period_end)
            if subscription.cancel_at_period_end is not None
            else False
        )

        return {
            "has_subscription": status == "active",
            "subscription": {
                "status": status,
                "current_period_end": current_period_end,
                "cancel_at_period_end": cancel_at_period_end,
            },
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@subscription_router.post("/stripe")
async def handle_stripe_webhook(
    request: Request,
    stripe_signature: str = Header(None),
    db: Session = Depends(get_db),
):
    """
    Handle Stripe webhook events for subscription management
    """
    if not STRIPE_WEBHOOK_SECRET:
        raise HTTPException(
            status_code=500, detail="Stripe webhook secret not configured"
        )

    try:
        # Get the request body as bytes
        payload = await request.body()

        # Verify the webhook signature
        try:
            event = stripe.Webhook.construct_event(
                payload, stripe_signature, STRIPE_WEBHOOK_SECRET
            )
        except Exception as e:
            logger.error(f"Invalid Stripe webhook signature: {e}")
            raise HTTPException(
                status_code=400, detail="Invalid Stripe webhook signature"
            )

        # Handle the event
        event_type = event["type"]
        logger.info(f"Processing Stripe event: {event_type}")

        if event_type == "checkout.session.completed":
            # Payment is successful and the subscription is created
            session = event["data"]["object"]
            customer_id = session.get("customer")
            subscription_id = session.get("subscription")
            client_reference_id = session.get(
                "client_reference_id"
            )  # This contains our user ID

            if client_reference_id and subscription_id:
                # Fetch subscription details from Stripe
                try:
                    stripe_sub = stripe.Subscription.retrieve(subscription_id)
                    subscription_obj = stripe_sub["items"]["data"][0]

                    stripe_received_price_id = stripe_sub.get("plan", {}).get("id")

                    if stripe_received_price_id not in [
                        MONTHLY_PRICE_ID,
                        YEARLY_PRICE_ID,
                    ]:
                        logger.info(
                            f"Skipping subscription creation for unsupported price ID: {stripe_received_price_id}"
                        )
                        return  # Stop processing if the price ID is unsupported

                    # Update subscription in database. Upgrade to a researcher plan!
                    subscription_data = {
                        "stripe_customer_id": customer_id,
                        "stripe_subscription_id": subscription_id,
                        "stripe_price_id": stripe_sub.get("plan", {}).get("id"),
                        "plan": SubscriptionPlan.RESEARCHER,
                        "status": stripe_sub.get("status"),
                        "current_period_start": datetime.fromtimestamp(
                            subscription_obj.get("current_period_start", 0)
                        ),
                        "current_period_end": datetime.fromtimestamp(
                            subscription_obj.get("current_period_end", 0)
                        ),
                        "cancel_at_period_end": stripe_sub.get(
                            "cancel_at_period_end", False
                        ),
                    }

                    # Save to database
                    subscription = subscription_crud.create_or_update(
                        db, uuid.UUID(client_reference_id), subscription_data
                    )

                    logger.info(
                        f"User {client_reference_id} subscribed with subscription ID {subscription_id}"
                    )

                    # Track subscription event
                    track_event(
                        event_name="subscription_created",
                        properties={
                            "user_id": client_reference_id,
                            "subscription_id": subscription_id,
                            "customer_id": customer_id,
                            "status": stripe_sub.get("status"),
                        },
                    )

                except Exception as e:
                    logger.error(f"Error processing subscription: {e}")

        elif event_type == "customer.subscription.updated":
            stripe_sub = event["data"]["object"]
            subscription_id = stripe_sub.get("id")

            try:
                # Find subscription in our database
                subscription = subscription_crud.get_by_stripe_subscription_id(
                    db, subscription_id
                )

                if subscription:
                    # Update with new data

                    subscription_crud.update_subscription_status(
                        db,
                        subscription_id,
                        stripe_sub.get("status"),
                        period_start=(
                            datetime.fromtimestamp(
                                stripe_sub.get("current_period_start", 0)
                            )
                            if stripe_sub.get("current_period_start")
                            else None
                        ),
                        period_end=(
                            datetime.fromtimestamp(
                                stripe_sub.get("current_period_end", 0)
                            )
                            if stripe_sub.get("current_period_end")
                            else None
                        ),
                    )

                    logger.info(
                        f"Subscription {subscription_id} updated to status: {stripe_sub.get('status')}"
                    )

            except Exception as e:
                logger.error(f"Error updating subscription: {e}")

        elif event_type == "customer.subscription.deleted":
            stripe_sub = event["data"]["object"]
            subscription_id = stripe_sub.get("id")

            try:
                # Update subscription status to canceled
                subscription = subscription_crud.get_by_stripe_subscription_id(
                    db, subscription_id
                )

                if subscription:
                    # Downgrade to BASIC plan on cancellation
                    subscription_crud.update_subscription_status(
                        db,
                        subscription_id,
                        SubscriptionStatus.CANCELED,
                        SubscriptionPlan.BASIC,
                    )

                    logger.info(f"Subscription {subscription_id} has been canceled")

            except Exception as e:
                logger.error(f"Error canceling subscription: {e}")

        # Return a 200 response to acknowledge receipt of the event
        return {"success": True}

    except Exception as e:
        logger.error(f"Error processing Stripe webhook: {e}")
        raise HTTPException(status_code=500, detail=str(e))
