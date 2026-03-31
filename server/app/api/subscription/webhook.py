import logging
import uuid
from datetime import datetime
from typing import Optional

import stripe
from app.api.subscription.config import (
    MONTHLY_PRICE_ID,
    STRIPE_WEBHOOK_SECRET,
    YEARLY_PRICE_ID,
    is_valid_price_id,
)
from app.database.crud.subscription_crud import subscription_crud
from app.database.crud.user_crud import user as user_crud
from app.database.database import get_db
from app.database.models import SubscriptionPlan, SubscriptionStatus
from app.database.telemetry import track_event
from app.helpers.email import (
    notify_billing_issue,
    send_confirmation_cancellation_email,
    send_subscription_welcome_email,
)
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/stripe")
async def handle_stripe_webhook(
    request: Request,
    stripe_signature: str = Header(None),
    db: Session = Depends(get_db),
):
    """Handle Stripe webhook events for subscription management"""

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
            "subscription_schedule.completed",
            "subscription_schedule.released",
        ]:
            logger.info(f"Skipping unsupported event type: {event_type}")
            return {"success": False}

        if event_type == "checkout.session.completed":
            session = event["data"]["object"]
            customer_id = session.customer
            subscription_id = session.subscription
            client_reference_id = session.client_reference_id

            if client_reference_id and customer_id:
                try:
                    logger.info(
                        f"Checkout completed for user {client_reference_id}, customer {customer_id}, subscription {subscription_id}"
                    )

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
            stripe_sub = event["data"]["object"]
            subscription_id = stripe_sub.id
            customer_id = stripe_sub.customer

            try:
                stripe_received_price_id = None
                sub_items = stripe_sub["items"]["data"]
                if sub_items:
                    stripe_received_price_id = sub_items[0].price.id

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
                    user_id = existing_subscription.user_id  # type: ignore
                else:
                    try:
                        stripe_customer = stripe.Customer.retrieve(customer_id)
                        customer_email = stripe_customer.email

                        if customer_email:
                            user = user_crud.get_by_email(db=db, email=customer_email)

                            if user:
                                user_id = (
                                    uuid.UUID(str(user.id)) if str(user.id) else None
                                )
                                logger.info(
                                    f"Found user {user_id} by email {customer_email} for customer {customer_id}"
                                )
                            else:
                                logger.warning(
                                    f"No user found with email {customer_email} for customer {customer_id}"
                                )
                        else:
                            logger.warning(
                                f"No email found for Stripe customer {customer_id}"
                            )

                    except Exception as e:
                        logger.error(
                            f"Error retrieving Stripe customer {customer_id}: {e}"
                        )

                if user_id:
                    webhook_sub_item = stripe_sub["items"]["data"][0]
                    subscription_data = {
                        "stripe_customer_id": customer_id,
                        "stripe_subscription_id": subscription_id,
                        "stripe_price_id": stripe_received_price_id,
                        "plan": SubscriptionPlan.RESEARCHER,
                        "status": stripe_sub.status,
                        "current_period_start": (
                            datetime.fromtimestamp(
                                webhook_sub_item.current_period_start
                            )
                            if getattr(webhook_sub_item, "current_period_start", None)
                            else None
                        ),
                        "current_period_end": (
                            datetime.fromtimestamp(webhook_sub_item.current_period_end)
                            if getattr(webhook_sub_item, "current_period_end", None)
                            else None
                        ),
                        "cancel_at_period_end": stripe_sub.cancel_at_period_end,
                    }

                    subscription = subscription_crud.create_or_update(
                        db, user_id, subscription_data
                    )

                    logger.info(
                        f"Subscription created for user {user_id} with ID {subscription_id}"
                    )

                    # Send welcome email
                    user = user_crud.get(db, id=user_id)
                    if user:
                        send_subscription_welcome_email(str(user.email))

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
            subscription_id = stripe_sub.id

            try:
                subscription = subscription_crud.get_by_stripe_subscription_id(
                    db, subscription_id
                )

                if subscription:
                    stripe_received_price_id = None
                    sub_items = stripe_sub["items"]["data"]
                    if sub_items:
                        stripe_received_price_id = sub_items[0].price.id

                    if stripe_received_price_id and not is_valid_price_id(
                        stripe_received_price_id
                    ):
                        logger.info(
                            f"Skipping subscription update for unsupported price ID: {stripe_received_price_id}"
                        )
                        return {"success": False}

                    cancel_at_period_end = getattr(
                        stripe_sub, "cancel_at_period_end", False
                    )
                    cancel_at = getattr(stripe_sub, "cancel_at", None)
                    previous_cancel_at_period_end = subscription.cancel_at_period_end

                    is_scheduled_for_cancellation = cancel_at_period_end or (
                        cancel_at is not None
                    )
                    was_scheduled_for_cancellation = previous_cancel_at_period_end

                    updated_sub_item = stripe_sub["items"]["data"][0]

                    subscription_crud.update_subscription_status(
                        db,
                        subscription_id,
                        stripe_sub.status,
                        stripe_price_id=stripe_received_price_id,
                        period_start=(
                            datetime.fromtimestamp(
                                updated_sub_item.current_period_start
                            )
                            if getattr(updated_sub_item, "current_period_start", None)
                            else None
                        ),
                        period_end=(
                            datetime.fromtimestamp(updated_sub_item.current_period_end)
                            if getattr(updated_sub_item, "current_period_end", None)
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
                                    "customer_id": stripe_sub.customer,
                                    "interval": (
                                        "yearly"
                                        if stripe_received_price_id == YEARLY_PRICE_ID
                                        else (
                                            "monthly"
                                            if stripe_received_price_id
                                            == MONTHLY_PRICE_ID
                                            else "unknown"
                                        )
                                    ),
                                    "canceled_at": (
                                        datetime.fromtimestamp(
                                            stripe_sub.canceled_at
                                        ).isoformat()
                                        if getattr(stripe_sub, "canceled_at", None)
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
            subscription_id = stripe_sub.id

            try:
                subscription = subscription_crud.get_by_stripe_subscription_id(
                    db, subscription_id
                )

                if subscription:
                    stripe_received_price_id = None
                    sub_items = stripe_sub["items"]["data"]
                    if sub_items:
                        stripe_received_price_id = sub_items[0].price.id

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

                    track_event(
                        event_name="subscription_canceled",
                        properties={
                            "subscription_id": subscription_id,
                            "customer_id": stripe_sub.customer,
                            "interval": (
                                "yearly"
                                if stripe_received_price_id == YEARLY_PRICE_ID
                                else (
                                    "monthly"
                                    if stripe_received_price_id == MONTHLY_PRICE_ID
                                    else "unknown"
                                )
                            ),
                            "canceled_at": (
                                datetime.fromtimestamp(
                                    stripe_sub.canceled_at
                                ).isoformat()
                                if getattr(stripe_sub, "canceled_at", None)
                                else None
                            ),
                        },
                        user_id=str(subscription.user_id),
                    )

            except Exception as e:
                logger.error(f"Error canceling subscription: {e}")

        elif event_type == "invoice.payment_failed":
            invoice = event["data"]["object"]
            subscription_id = invoice.subscription
            customer_id = invoice.customer

            try:
                if subscription_id:
                    subscription = subscription_crud.get_by_stripe_subscription_id(
                        db, subscription_id
                    )

                    if subscription:
                        subscription_crud.update_subscription_status(
                            db, subscription_id, status=SubscriptionStatus.PAST_DUE
                        )

                        track_event(
                            event_name="payment_failed",
                            properties={
                                "subscription_id": subscription_id,
                                "customer_id": customer_id,
                                "invoice_id": invoice.id,
                            },
                            user_id=str(subscription.user_id),
                        )

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
            subscription_id = invoice.subscription

            try:
                if subscription_id:
                    subscription = subscription_crud.get_by_stripe_subscription_id(
                        db, subscription_id
                    )

                    if subscription:
                        subscription_crud.update_subscription_status(
                            db, subscription_id, status=SubscriptionStatus.ACTIVE
                        )

                        track_event(
                            event_name="payment_succeeded",
                            properties={
                                "subscription_id": subscription_id,
                                "invoice_id": invoice.id,
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
            subscription_id = invoice.subscription

            try:
                if subscription_id:
                    subscription = subscription_crud.get_by_stripe_subscription_id(
                        db, subscription_id
                    )

                    if subscription:
                        track_event(
                            event_name="payment_action_required",
                            properties={
                                "subscription_id": subscription_id,
                                "invoice_id": invoice.id,
                            },
                            user_id=str(subscription.user_id),
                        )

                        logger.info(
                            f"Payment action required for subscription {subscription_id}"
                        )

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
            subscription_id = stripe_sub.id

            try:
                subscription = subscription_crud.get_by_stripe_subscription_id(
                    db, subscription_id
                )

                if subscription:
                    subscription_crud.update_subscription_status(
                        db,
                        subscription_id,
                        status="past_due",
                    )

                    track_event(
                        event_name="subscription_past_due",
                        properties={
                            "user_id": str(subscription.user_id),
                            "subscription_id": subscription_id,
                        },
                        user_id=str(subscription.user_id),
                    )

                    logger.warning(f"Subscription {subscription_id} is now past due")

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

        elif event_type in [
            "subscription_schedule.completed",
            "subscription_schedule.released",
        ]:
            schedule = event["data"]["object"]
            schedule_id = schedule.id
            subscription_id = schedule.subscription

            try:
                if subscription_id:
                    subscription = subscription_crud.get_by_stripe_subscription_id(
                        db, subscription_id
                    )

                    if (
                        subscription
                        and str(subscription.stripe_schedule_id) == schedule_id
                    ):
                        subscription_crud.create_or_update(
                            db,
                            uuid.UUID(str(subscription.user_id)),
                            {"stripe_schedule_id": None},
                        )
                        logger.info(
                            f"Cleared schedule_id {schedule_id} from subscription {subscription_id} "
                            f"(event: {event_type})"
                        )
            except Exception as e:
                logger.error(
                    f"Error processing {event_type} for schedule {schedule_id}: {e}",
                    exc_info=True,
                )

        # Return a 200 response to acknowledge receipt of the event.
        return {"success": True}

    except Exception as e:
        logger.error(f"Error processing Stripe webhook: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
