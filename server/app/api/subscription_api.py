import logging
import os
import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Optional

import stripe
from app.auth.dependencies import get_required_user
from app.database.crud.subscription_crud import subscription_crud
from app.database.crud.user_crud import user as user_crud
from app.database.database import get_db
from app.database.models import SubscriptionPlan, SubscriptionStatus
from app.database.telemetry import track_event
from app.helpers.email import (
    notify_billing_issue,
    notify_converted_billing_interval,
    send_confirmation_cancellation_email,
    send_subscription_welcome_email,
)
from app.helpers.subscription_limits import get_user_usage_info
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
YOUR_DOMAIN = os.getenv("CLIENT_DOMAIN", "http://localhost:3000")

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


@subscription_router.get("/session-status")
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
            client_reference_id = session.get("client_reference_id")
            subscription_id = session.get("subscription")

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

                    if hasattr(stripe_sub, "current_period_start"):
                        period_start = datetime.fromtimestamp(
                            stripe_sub["current_period_start"]
                        )

                    if hasattr(stripe_sub, "current_period_end"):
                        period_end = datetime.fromtimestamp(
                            stripe_sub["current_period_end"]
                        )

                    # Extract the product_id from the price object
                    stripe_price_id = stripe_sub.get("plan", {}).get("id")
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
        # This helps the frontend know to show "Manage Subscription" instead of "Subscribe"
        # for users with expired/past_due subscriptions
        had_subscription = subscription.stripe_subscription_id is not None

        # Check if the subscription needs payment attention (past_due or payment failed)
        requires_payment_update = status in ["past_due", "unpaid"]

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

    def is_valid_price_id(price_id: str) -> bool:
        """Check if the price ID is one of our configured prices."""
        return price_id in [MONTHLY_PRICE_ID, YEARLY_PRICE_ID]

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

        # Skip processing events that are not supported
        if event_type not in [
            "checkout.session.completed",
            "customer.subscription.updated",
            "customer.subscription.created",
            "customer.subscription.deleted",
            "invoice.payment_failed",
            "invoice.payment_action_required",
            "customer.subscription.past_due",
            "invoice.payment_succeeded",
        ]:
            logger.info(f"Skipping unsupported event type: {event_type}")
            return {"success": False}

        if event_type == "checkout.session.completed":
            # Payment is successful - log the event but let subscription.created handle the actual subscription
            session = event["data"]["object"]
            customer_id = session.get("customer")
            subscription_id = session.get("subscription")
            client_reference_id = session.get(
                "client_reference_id"
            )  # This contains our user ID

            if client_reference_id and customer_id:
                try:
                    logger.info(
                        f"Checkout completed for user {client_reference_id}, customer {customer_id}, subscription {subscription_id}"
                    )

                    # Track checkout completion event
                    track_event(
                        event_name="checkout_completed",
                        properties={
                            "user_id": client_reference_id,
                            "subscription_id": subscription_id,
                            "customer_id": customer_id,
                        },
                    )

                except Exception as e:
                    logger.error(
                        f"Error processing checkout completion: {e}", exc_info=True
                    )

        elif event_type == "customer.subscription.created":
            # Subscription created - this handles all subscription creation (checkout and direct)
            stripe_sub = event["data"]["object"]
            subscription_id = stripe_sub.get("id")
            customer_id = stripe_sub.get("customer")

            try:
                # Get price ID from subscription items to validate it's one of ours
                stripe_received_price_id = None
                if stripe_sub.get("plan"):
                    stripe_received_price_id = stripe_sub.plan.stripe_id

                if stripe_received_price_id and not is_valid_price_id(
                    stripe_received_price_id
                ):
                    logger.info(
                        f"Skipping subscription creation for unsupported price ID: {stripe_received_price_id}"
                    )
                    return {"success": False}

                # Try to find the user by customer ID
                existing_subscription = subscription_crud.get_by_stripe_customer_id(
                    db, customer_id
                )

                user_id: Optional[uuid.UUID] = None
                if existing_subscription:
                    # Get the user_id from the subscription
                    user_id = existing_subscription.user_id  # type: ignore
                else:
                    # No existing subscription found, try to find user by email from Stripe customer
                    try:
                        stripe_customer = stripe.Customer.retrieve(customer_id)
                        customer_email = stripe_customer.get("email")

                        if customer_email:
                            # Find user by email in our database
                            user = user_crud.get_by_email(db=db, email=customer_email)

                            if user:
                                user_id = (
                                    uuid.UUID(str(user.id)) if str(user.id) else None
                                )  # This should already be a UUID
                                logger.info(
                                    f"Found user {user_id} by email {customer_email} for customer {customer_id}"
                                )
                            else:
                                logger.warning(
                                    f"No user found with email {customer_email} for customer {customer_id}"
                                )
                        else:
                            # TODO: track how often this happens. If it's happening regularly, set up email notification to inform the user of the subscription issue. Result: someone has subscribed, but we can't link the subscription to their account.
                            logger.warning(
                                f"No email found for Stripe customer {customer_id}"
                            )

                    except Exception as e:
                        logger.error(
                            f"Error retrieving Stripe customer {customer_id}: {e}"
                        )

                if user_id:
                    # Create or update subscription in database with new subscription data
                    subscription_data = {
                        "stripe_customer_id": customer_id,
                        "stripe_subscription_id": subscription_id,
                        "stripe_price_id": stripe_received_price_id,
                        "plan": SubscriptionPlan.RESEARCHER,
                        "status": stripe_sub.status,
                        "current_period_start": datetime.fromtimestamp(
                            stripe_sub["current_period_start"]
                        ),
                        "current_period_end": datetime.fromtimestamp(
                            stripe_sub["current_period_end"]
                        ),
                        "cancel_at_period_end": stripe_sub["cancel_at_period_end"],
                    }

                    # Save to database using create_or_update
                    subscription = subscription_crud.create_or_update(
                        db, user_id, subscription_data
                    )

                    logger.info(
                        f"Subscription created for user {user_id} with ID {subscription_id}"
                    )

                    # Send welcome email!
                    user = user_crud.get(db, id=user_id)
                    if user:
                        send_subscription_welcome_email(str(user.email))

                    # Track subscription creation event
                    track_event(
                        event_name="subscription_created",
                        properties={
                            "subscription_id": subscription_id,
                            "customer_id": customer_id,
                            "status": stripe_sub.status,
                        },
                        user_id=str(user_id),
                    )
                else:
                    logger.warning(
                        f"Could not find user for customer {customer_id} when processing subscription.created"
                    )

            except Exception as e:
                logger.error(
                    f"Error processing subscription creation: {e}", exc_info=True
                )

        elif event_type == "customer.subscription.updated":
            stripe_sub = event["data"]["object"]
            subscription_id = stripe_sub.get("id")

            try:
                # Find subscription in our database
                subscription = subscription_crud.get_by_stripe_subscription_id(
                    db, subscription_id
                )

                if subscription:
                    # Get price ID from subscription items to validate it's one of ours
                    stripe_received_price_id = None
                    if stripe_sub.get("plan"):
                        stripe_received_price_id = stripe_sub.plan.stripe_id

                    if stripe_received_price_id and not is_valid_price_id(
                        stripe_received_price_id
                    ):
                        logger.info(
                            f"Skipping subscription update for unsupported price ID: {stripe_received_price_id}"
                        )
                        return {"success": False}

                    # Check if subscription is being scheduled for cancellation
                    # Stripe supports two cancellation methods:
                    # 1. cancel_at_period_end: true - cancels at end of current period
                    # 2. cancel_at: timestamp - cancels at a specific future date
                    cancel_at_period_end = stripe_sub.get("cancel_at_period_end", False)
                    cancel_at = stripe_sub.get("cancel_at")
                    previous_cancel_at_period_end = subscription.cancel_at_period_end

                    # Treat either cancellation method as a pending cancellation
                    is_scheduled_for_cancellation = cancel_at_period_end or (
                        cancel_at is not None
                    )
                    was_scheduled_for_cancellation = previous_cancel_at_period_end

                    # Update with new data
                    subscription_crud.update_subscription_status(
                        db,
                        subscription_id,
                        stripe_sub.status,
                        stripe_price_id=stripe_received_price_id,
                        period_start=(
                            datetime.fromtimestamp(stripe_sub["current_period_start"])
                            if stripe_sub.get("current_period_start")
                            else None
                        ),
                        period_end=(
                            datetime.fromtimestamp(stripe_sub["current_period_end"])
                            if stripe_sub.get("current_period_end")
                            else None
                        ),
                        cancel_at_period_end=is_scheduled_for_cancellation,
                    )

                    # Track subscription cancellation event when cancellation is newly scheduled
                    if (
                        is_scheduled_for_cancellation
                        and not was_scheduled_for_cancellation
                    ):
                        user_obj = user_crud.get(db, id=subscription.user_id)
                        if user_obj:
                            user_display_name = (
                                str(user_obj.name).split(" ")[0]
                                if user_obj.name
                                else None
                            )
                            send_confirmation_cancellation_email(
                                to_email=str(user_obj.email),
                                name=user_display_name,
                            )
                            track_event(
                                event_name="subscription_canceled",
                                properties={
                                    "subscription_id": subscription_id,
                                    "customer_id": stripe_sub.get("customer"),
                                    "interval": (
                                        "yearly"
                                        if stripe_received_price_id == YEARLY_PRICE_ID
                                        else "monthly"
                                    ),
                                    "canceled_at": (
                                        datetime.fromtimestamp(
                                            stripe_sub.get("canceled_at", 0)
                                        ).isoformat()
                                        if stripe_sub.get("canceled_at")
                                        else None
                                    ),
                                    "cancel_at_period_end": True,
                                },
                                user_id=str(subscription.user_id),
                            )
                        logger.info(
                            f"Subscription {subscription_id} scheduled for cancellation at period end"
                        )

                    logger.info(
                        f"Subscription {subscription_id} updated to status: {stripe_sub.status}"
                    )

            except Exception as e:
                logger.error(f"Error updating subscription: {e}")

        elif event_type == "customer.subscription.deleted":
            stripe_sub = event["data"]["object"]
            subscription_id = stripe_sub.get("id")

            try:
                # Find subscription in our database
                subscription = subscription_crud.get_by_stripe_subscription_id(
                    db, subscription_id
                )

                if subscription:
                    # Get price ID from subscription items to validate it's one of ours
                    stripe_received_price_id = None
                    if stripe_sub.get("plan"):
                        stripe_received_price_id = stripe_sub.plan.stripe_id

                    if stripe_received_price_id and not is_valid_price_id(
                        stripe_received_price_id
                    ):
                        logger.info(
                            f"Skipping subscription deletion for unsupported price ID: {stripe_received_price_id}"
                        )
                        return {"success": False}

                    # Downgrade to BASIC plan on cancellation
                    subscription_crud.update_subscription_status(
                        db,
                        subscription_id,
                        stripe_price_id=stripe_received_price_id,
                        status=SubscriptionStatus.CANCELED,
                        plan=SubscriptionPlan.BASIC,
                        cancel_at_period_end=True,
                    )

                    logger.info(f"Subscription {subscription_id} has been canceled")

                    # Track subscription cancellation event
                    track_event(
                        event_name="subscription_canceled",
                        properties={
                            "subscription_id": subscription_id,
                            "customer_id": stripe_sub.get("customer"),
                            "interval": (
                                "yearly"
                                if stripe_received_price_id == YEARLY_PRICE_ID
                                else "monthly"
                            ),
                            "canceled_at": (
                                datetime.fromtimestamp(
                                    stripe_sub.get("canceled_at", 0)
                                ).isoformat()
                                if stripe_sub.get("canceled_at")
                                else None
                            ),
                        },
                        user_id=str(subscription.user_id),
                    )

            except Exception as e:
                logger.error(f"Error canceling subscription: {e}")

        elif event_type == "invoice.payment_failed":
            invoice = event["data"]["object"]
            subscription_id = invoice.get("subscription")
            customer_id = invoice.get("customer")

            try:
                if subscription_id:
                    # Find subscription in our database
                    subscription = subscription_crud.get_by_stripe_subscription_id(
                        db, subscription_id
                    )

                    if subscription:
                        # Update subscription status to past_due
                        subscription_crud.update_subscription_status(
                            db, subscription_id, status=SubscriptionStatus.PAST_DUE
                        )

                        # Track payment failure event
                        track_event(
                            event_name="payment_failed",
                            properties={
                                "subscription_id": subscription_id,
                                "customer_id": customer_id,
                                "invoice_id": invoice.get("id"),
                            },
                            user_id=str(subscription.user_id),
                        )

                        # Get user email and name for notification
                        user = user_crud.get(db, id=subscription.user_id)

                        if not user:
                            logger.warning(
                                f"No user found for subscription {subscription_id} when processing payment failure"
                            )
                            return {"success": False}

                        logger.warning(
                            f"Payment failed for subscription {subscription_id}, user {subscription.user_id}"
                        )

                        email_message = "Payment failed for your subscription. Please update your payment method"

                        notify_billing_issue(
                            str(user.email), email_message, str(user.name)
                        )

            except Exception as e:
                logger.error(f"Error processing payment failure: {e}", exc_info=True)

        elif event_type == "invoice.payment_succeeded":
            invoice = event["data"]["object"]
            subscription_id = invoice.get("subscription")

            try:
                if subscription_id:
                    # Find subscription in our database
                    subscription = subscription_crud.get_by_stripe_subscription_id(
                        db, subscription_id
                    )

                    if subscription:
                        # Update subscription status to active
                        subscription_crud.update_subscription_status(
                            db, subscription_id, status=SubscriptionStatus.ACTIVE
                        )

                        # Track payment success event
                        track_event(
                            event_name="payment_succeeded",
                            properties={
                                "subscription_id": subscription_id,
                                "invoice_id": invoice.get("id"),
                            },
                            user_id=str(subscription.user_id),
                        )

                        logger.info(
                            f"Payment succeeded for subscription {subscription_id}"
                        )

            except Exception as e:
                logger.error(f"Error processing payment success: {e}", exc_info=True)

        elif event_type == "invoice.payment_action_required":
            invoice = event["data"]["object"]
            subscription_id = invoice.get("subscription")

            try:
                if subscription_id:
                    subscription = subscription_crud.get_by_stripe_subscription_id(
                        db, subscription_id
                    )

                    if subscription:
                        # Track payment action required event
                        track_event(
                            event_name="payment_action_required",
                            properties={
                                "subscription_id": subscription_id,
                                "invoice_id": invoice.get("id"),
                            },
                            user_id=str(subscription.user_id),
                        )

                        logger.info(
                            f"Payment action required for subscription {subscription_id}"
                        )

                        # Get user email and name for notification
                        user = user_crud.get(db, id=subscription.user_id)
                        if not user:
                            logger.warning(
                                f"No user found for subscription {subscription_id} when processing payment action required"
                            )
                            return {"success": False}

                        email_message = "Payment action required for your subscription. Please complete the required action."

                        notify_billing_issue(
                            str(user.email), email_message, str(user.name)
                        )

            except Exception as e:
                logger.error(
                    f"Error processing payment action required: {e}", exc_info=True
                )

        elif event_type == "customer.subscription.past_due":
            stripe_sub = event["data"]["object"]
            subscription_id = stripe_sub.get("id")

            try:
                subscription = subscription_crud.get_by_stripe_subscription_id(
                    db, subscription_id
                )

                if subscription:
                    # Update subscription status
                    subscription_crud.update_subscription_status(
                        db,
                        subscription_id,
                        status="past_due",
                    )

                    # Track past due event
                    track_event(
                        event_name="subscription_past_due",
                        properties={
                            "user_id": str(subscription.user_id),
                            "subscription_id": subscription_id,
                        },
                        user_id=str(subscription.user_id),
                    )

                    logger.warning(f"Subscription {subscription_id} is now past due")

                    # Get user email and name for notification
                    user = user_crud.get(db, id=subscription.user_id)
                    if not user:
                        logger.warning(
                            f"No user found for subscription {subscription_id} when processing past due subscription"
                        )
                        return {"success": False}
                    email_message = "Your subscription is past due. Please update your payment method to avoid service interruption."
                    notify_billing_issue(str(user.email), email_message, str(user.name))

            except Exception as e:
                logger.error(
                    f"Error processing past due subscription: {e}", exc_info=True
                )

        # Return a 200 response to acknowledge receipt of the event. We should only arrive here if the event was processed successfully.
        return {"success": True}

    except Exception as e:
        logger.error(f"Error processing Stripe webhook: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@subscription_router.get("/usage")
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


@subscription_router.post("/create-portal-session")
def create_customer_portal_session(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """Create a Stripe customer portal session for the current user"""
    try:
        # Get the user's subscription to retrieve the Stripe customer ID
        subscription = subscription_crud.get_by_user_id(db, current_user.id)

        if not subscription or not subscription.stripe_customer_id:
            raise HTTPException(
                status_code=400,
                detail="No active subscription found or customer ID not available",
            )

        # Create the customer portal session
        portal_session = stripe.billing_portal.Session.create(
            customer=str(subscription.stripe_customer_id),
            return_url=f"{YOUR_DOMAIN}/pricing",  # Redirect back to pricing page
        )

        return {"url": portal_session.url}

    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except Exception as e:
        logger.error(f"Error creating customer portal session: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@subscription_router.post("/resubscribe")
def resubscribe(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """
    Reactivate a canceled subscription or reverse a scheduled cancellation.

    This endpoint handles two scenarios:
    1. If subscription is scheduled for cancellation (cancel_at_period_end=true),
       it will reverse the cancellation by setting cancel_at_period_end=false
    2. If subscription is already canceled, it will create a new subscription
       using the existing customer and payment method

    Requirements:
    - User must have an existing subscription record
    - User must have a Stripe customer ID
    - User must have a Stripe subscription ID (active, canceled, or scheduled for cancellation)
    """
    try:
        # Get the user's existing subscription
        subscription = subscription_crud.get_by_user_id(db, current_user.id)

        if not subscription:
            return {
                "success": False,
                "error": "No existing subscription found. Please create a new subscription instead.",
            }

        if not subscription.stripe_customer_id:
            return {
                "success": False,
                "error": "No Stripe customer ID found. Please create a new subscription instead.",
            }

        if not subscription.stripe_subscription_id:
            return {
                "success": False,
                "error": "No Stripe subscription found. Please create a new subscription instead.",
            }

        try:
            subscription_id = str(subscription.stripe_subscription_id)

            # Check if the Stripe subscription still exists and is canceled
            stripe_sub = stripe.Subscription.retrieve(subscription_id)

            if stripe_sub.status == "canceled":
                # Subscription is already canceled - create a new subscription
                logger.info(
                    f"Subscription {stripe_sub.id} is already canceled, creating new subscription"
                )

                # Try to get the payment method from the previous subscription
                payment_method_id = None
                try:
                    # Get the customer's default payment method
                    customer = stripe.Customer.retrieve(
                        str(subscription.stripe_customer_id)
                    )
                    if customer.get("invoice_settings", {}).get(
                        "default_payment_method"
                    ):
                        payment_method_id = customer["invoice_settings"][
                            "default_payment_method"
                        ]

                    # If no default payment method, try to get from the canceled subscription
                    if not payment_method_id and stripe_sub.get(
                        "default_payment_method"
                    ):
                        payment_method_id = stripe_sub["default_payment_method"]

                    # If still no payment method, get the customer's payment methods
                    if not payment_method_id:
                        payment_methods = stripe.PaymentMethod.list(
                            customer=str(subscription.stripe_customer_id), type="card"
                        )
                        if payment_methods.data:
                            payment_method_id = payment_methods.data[0].id

                except Exception as pm_error:
                    logger.warning(
                        f"Could not retrieve payment method for customer {subscription.stripe_customer_id}: {pm_error}"
                    )
                    return {
                        "success": False,
                        "error": "no_payment_method",
                        "message": "No payment method available. Please use the checkout flow to add a payment method and resubscribe.",
                        "redirect_to_checkout": True,
                    }

                stripe_price_id = str(subscription.stripe_price_id)
                if not stripe_price_id:
                    return {
                        "success": False,
                        "error": "no_price_id",
                        "message": "No price ID found for the subscription. Please contact support.",
                        "redirect_to_checkout": True,
                    }

                # Create subscription parameters
                subscription_params = {
                    "customer": str(subscription.stripe_customer_id),
                    "items": [{"price": stripe_price_id}],
                    "metadata": {"user_id": str(current_user.id)},
                }

                # Add payment method if we found one
                if payment_method_id:
                    subscription_params["default_payment_method"] = payment_method_id

                # Create a new subscription for the existing customer
                try:
                    new_stripe_sub = stripe.Subscription.create(**subscription_params)

                    # Track resubscription event
                    track_event(
                        event_name="subscription_reactivated_new",
                        properties={
                            "old_subscription_id": str(
                                subscription.stripe_subscription_id
                            ),
                            "new_subscription_id": new_stripe_sub.id,
                            "customer_id": str(subscription.stripe_customer_id),
                            "interval": (
                                "yearly"
                                if stripe_price_id == YEARLY_PRICE_ID
                                else "monthly"
                            ),
                        },
                        user_id=str(current_user.id),
                    )

                    logger.info(
                        f"Created new subscription {new_stripe_sub.id} for user {current_user.id}"
                    )
                    return {"success": True, "subscription_id": new_stripe_sub.id}

                except Exception as stripe_error:
                    # Check for specific payment-related errors
                    error_message = str(stripe_error).lower()
                    if any(
                        keyword in error_message
                        for keyword in ["card", "declined", "insufficient", "payment"]
                    ):
                        logger.warning(
                            f"Payment error during resubscription for user {current_user.id}: {stripe_error}"
                        )
                        return {
                            "success": False,
                            "error": "payment_failed",
                            "message": "Your payment method was declined. Please update your payment method and try again.",
                            "redirect_to_checkout": True,
                        }
                    else:
                        # Re-raise other errors to be handled by outer exception handler
                        raise stripe_error

            elif stripe_sub.cancel_at_period_end:
                # Subscription is scheduled for cancellation - reverse the cancellation
                logger.info(
                    f"Subscription {stripe_sub.id} is scheduled for cancellation, reversing cancellation"
                )

                # Update the subscription to prevent cancellation
                updated_sub = stripe.Subscription.modify(
                    str(subscription.stripe_subscription_id), cancel_at_period_end=False
                )

                # We should receive a webhook event for this, so let the db update take place in the webhook handler

                logger.info(f"Reversed cancellation for subscription {updated_sub.id}")

                # Track cancellation reversal event
                track_event(
                    event_name="subscription_cancellation_reversed",
                    properties={
                        "subscription_id": str(subscription.stripe_subscription_id),
                        "customer_id": str(subscription.stripe_customer_id),
                    },
                    user_id=str(current_user.id),
                )

                logger.info(
                    f"Reversed cancellation for subscription {stripe_sub.id} for user {current_user.id}"
                )
                return {
                    "success": True,
                    "subscription_id": str(subscription.stripe_subscription_id),
                    "action": "cancellation_reversed",
                    "message": "Your subscription cancellation has been reversed and will continue.",
                }

            else:
                # Subscription is active or in trial - no action needed
                logger.info(f"Subscription {stripe_sub.id} is active, no action needed")
                return {
                    "success": True,
                    "subscription_id": str(subscription.stripe_subscription_id),
                    "action": "no_action",
                    "message": "Your subscription is still active.",
                }

        except Exception as stripe_error:
            # Check if the error is due to missing payment method
            if (
                "no attached payment source" in str(stripe_error).lower()
                or "default payment method" in str(stripe_error).lower()
            ):
                logger.info(
                    f"No payment method available for customer {subscription.stripe_customer_id}, redirecting to checkout"
                )
                return {
                    "success": False,
                    "error": "no_payment_method",
                    "message": "No payment method available. Please use the checkout flow to add a payment method and resubscribe.",
                    "redirect_to_checkout": True,
                }
            else:
                # Stripe subscription doesn't exist anymore or other error
                logger.error(
                    f"Error retrieving Stripe subscription {subscription.stripe_subscription_id}: {stripe_error}",
                    exc_info=True,
                )
                return {
                    "success": False,
                    "error": "Previous subscription not found in Stripe",
                }

    except Exception as e:
        logger.error(f"Error during resubscription: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# Subscription Interval Management Endpoints
# These endpoints allow users to change their subscription billing intervals
@subscription_router.post("/change-interval")
def change_subscription_interval(
    new_interval: SubscriptionInterval,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """
    Change the billing interval of the current user's subscription.
    """
    try:
        # Get the user's current subscription
        subscription = subscription_crud.get_by_user_id(db, current_user.id)

        if not subscription:
            return {"success": False, "error": "No existing subscription found"}

        if not subscription.stripe_subscription_id:
            return {"success": False, "error": "No Stripe subscription ID found"}

        subscription_id = str(subscription.stripe_subscription_id)

        # Get the current Stripe subscription
        stripe_sub = stripe.Subscription.retrieve(subscription_id)

        # Check if subscription is active
        if stripe_sub.status not in ["active", "trialing"]:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot change interval for subscription with status: {stripe_sub.status}",
            )

        # Determine the new price ID based on the requested interval
        if MONTHLY_PRICE_ID is None or YEARLY_PRICE_ID is None:
            raise HTTPException(
                status_code=500, detail="Stripe price IDs not properly configured"
            )

        new_price_id: str = (
            MONTHLY_PRICE_ID
            if new_interval == SubscriptionInterval.MONTHLY
            else YEARLY_PRICE_ID
        )

        # Get current price ID to check if change is actually needed
        current_price_id = stripe_sub["items"]["data"][0]["price"]["id"]

        if current_price_id == new_price_id:
            return {
                "success": False,
                "message": f"Subscription is already on {new_interval.value}ly billing",
            }

        # Update the subscription directly
        try:
            updated_subscription = stripe.Subscription.modify(
                subscription_id,
                items=[
                    {
                        "id": stripe_sub["items"]["data"][0]["id"],
                        "price": new_price_id,
                    }
                ],
                proration_behavior="create_prorations",
                billing_cycle_anchor="now",
            )

            effective_date = datetime.fromtimestamp(
                updated_subscription["items"]["data"][0]["current_period_end"]
            )

        except Exception as e:
            logger.error(f"Error updating subscription: {e}")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to update subscription: {str(e)}",
            )

        # Track the interval change event
        track_event(
            event_name="subscription_interval_changed",
            properties={
                "subscription_id": subscription_id,
                "old_interval": (
                    "yearly" if current_price_id == YEARLY_PRICE_ID else "monthly"
                ),
                "new_interval": new_interval.value + "ly",
                "effective_date": effective_date.isoformat(),
            },
            user_id=str(current_user.id),
        )

        logger.info(
            f"Subscription {subscription_id} for user {current_user.id} changed from "
            f"{'yearly' if current_price_id == YEARLY_PRICE_ID else 'monthly'} to "
            f"{new_interval.value}ly, effective at: {effective_date}"
        )

        # Notify user about the billing interval change
        notify_converted_billing_interval(
            email=current_user.email,
            new_interval=new_interval.value,
            name=current_user.name,
        )

        return {
            "success": True,
            "message": f"Subscription interval will change to {new_interval.value}ly at the end of the current billing cycle",
            "current_period_end": effective_date,
            "new_interval": new_interval.value + "ly",
        }

    except Exception as stripe_error:
        logger.error(
            f"Error when changing subscription interval: {stripe_error}", exc_info=True
        )
        if "stripe" in str(stripe_error).lower():
            raise HTTPException(
                status_code=400, detail=f"Stripe error: {str(stripe_error)}"
            )
        else:
            logger.error(
                f"Error changing subscription interval: {str(stripe_error)}",
                exc_info=True,
            )
            raise HTTPException(status_code=500, detail=str(stripe_error))
