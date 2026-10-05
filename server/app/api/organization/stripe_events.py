"""
Stripe webhook handling for team subscriptions. The main webhook hands events
here first; anything that isn't about a team falls through to the personal
subscription handling unchanged.
"""

import logging
from datetime import datetime, timezone
from typing import Optional

from app.api.subscription.config import is_team_price_id
from app.database.crud.organization_crud import organization_crud
from app.database.models import (
    Organization,
    OrganizationRoles,
    SubscriptionPlan,
    SubscriptionStatus,
)
from app.database.telemetry import track_event
from app.helpers.email import notify_billing_issue
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

SUBSCRIPTION_EVENTS = [
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "customer.subscription.past_due",
]
INVOICE_EVENTS = [
    "invoice.payment_failed",
    "invoice.payment_succeeded",
    "invoice.payment_action_required",
]


def _timestamp(value) -> Optional[datetime]:
    return datetime.fromtimestamp(value, tz=timezone.utc) if value else None


def _find_organization_for_subscription(
    db: Session, stripe_sub
) -> Optional[Organization]:
    organization = organization_crud.get_by_stripe_subscription_id(db, stripe_sub.id)
    if organization:
        return organization

    # First event for this subscription: link it through the metadata set at checkout.
    # StripeObject supports `in` and indexing, but not dict methods like .get().
    metadata = getattr(stripe_sub, "metadata", None)
    if metadata and "organization_id" in metadata:
        return organization_crud.get(db, id=metadata["organization_id"])
    return None


def _sync_from_subscription(
    db: Session, organization: Organization, stripe_sub, status: Optional[str] = None
) -> None:
    item = stripe_sub["items"]["data"][0]
    organization.stripe_subscription_id = stripe_sub.id
    organization.stripe_customer_id = stripe_sub.customer
    organization.stripe_price_id = item.price.id
    organization.plan = SubscriptionPlan.TEAM.value  # type: ignore[assignment]
    organization.status = status or stripe_sub.status
    organization.seats = item.quantity
    organization.current_period_start = _timestamp(
        getattr(item, "current_period_start", None)
    )
    organization.current_period_end = _timestamp(
        getattr(item, "current_period_end", None)
    )
    organization.cancel_at_period_end = bool(
        getattr(stripe_sub, "cancel_at_period_end", False)
        or getattr(stripe_sub, "cancel_at", None)
    )
    organization.canceled_at = _timestamp(getattr(stripe_sub, "canceled_at", None))
    db.commit()


def _notify_admins(db: Session, organization: Organization, message: str) -> None:
    for membership in organization_crud.get_members(db, organization.id):  # type: ignore[arg-type]
        if membership.role == OrganizationRoles.ADMIN.value and membership.user:
            notify_billing_issue(
                str(membership.user.email),
                message,
                str(membership.user.name or ""),
                manage_path=f"/team/{organization.id}",
            )


def handle_team_stripe_event(db: Session, event) -> bool:
    """Apply a Stripe event to the team it belongs to. Returns True if the
    event was a team event (handled here), False to let the personal
    subscription handler take it."""
    event_type = event["type"]
    obj = event["data"]["object"]

    if event_type in SUBSCRIPTION_EVENTS:
        items = obj["items"]["data"]
        if not items or not is_team_price_id(items[0].price.id):
            return False

        organization = _find_organization_for_subscription(db, obj)
        if not organization:
            logger.warning(
                f"Team subscription {obj.id} ({event_type}) has no matching team"
            )
            return True

        if event_type == "customer.subscription.deleted":
            _sync_from_subscription(
                db, organization, obj, status=SubscriptionStatus.CANCELED.value
            )
        elif event_type == "customer.subscription.past_due":
            _sync_from_subscription(
                db, organization, obj, status=SubscriptionStatus.PAST_DUE.value
            )
        else:
            _sync_from_subscription(db, organization, obj)

        track_event(
            f"team_{event_type.removeprefix('customer.').replace('.', '_')}",
            properties={
                "organization_id": str(organization.id),
                "subscription_id": obj.id,
                "status": organization.status,
                "seats": organization.seats,
            },
            db=db,
        )
        logger.info(
            f"Team {organization.id} subscription {obj.id}: {event_type} -> "
            f"{organization.status}, {organization.seats} seats"
        )
        return True

    if event_type in INVOICE_EVENTS:
        subscription_id = getattr(obj, "subscription", None)
        organization = (
            organization_crud.get_by_stripe_subscription_id(db, subscription_id)
            if subscription_id
            else None
        )
        if not organization:
            return False

        if event_type == "invoice.payment_succeeded":
            organization.status = SubscriptionStatus.ACTIVE.value  # type: ignore[assignment]
            db.commit()
        elif event_type == "invoice.payment_failed":
            organization.status = SubscriptionStatus.PAST_DUE.value  # type: ignore[assignment]
            db.commit()
            _notify_admins(
                db,
                organization,
                f"Payment failed for your team {organization.name}. Please update your payment method",
            )
        elif event_type == "invoice.payment_action_required":
            _notify_admins(
                db,
                organization,
                f"Payment for your team {organization.name} needs your action. Please complete it",
            )

        track_event(
            f"team_{event_type.replace('.', '_')}",
            properties={
                "organization_id": str(organization.id),
                "subscription_id": subscription_id,
                "invoice_id": obj.id,
            },
            db=db,
        )
        return True

    return False
