"""
Seat-based billing for teams. One Stripe customer and subscription per team,
paid by an admin; the subscription quantity is the number of seats.
"""

import logging
import uuid

import stripe
from app.api.organization.organizations_api import (
    get_organization_for_admin,
    serialize_organization,
)
from app.api.subscription.config import (
    TEAM_MONTHLY_PRICE_ID,
    TEAM_YEARLY_PRICE_ID,
    YOUR_DOMAIN,
    SubscriptionInterval,
)
from app.auth.dependencies import get_required_user
from app.database.crud.organization_crud import organization_crud
from app.database.database import get_db
from app.database.models import OrganizationRoles, SubscriptionStatus
from app.database.telemetry import track_event
from app.schemas.user import CurrentUser
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

router = APIRouter()

MAX_SEATS = 500

# Statuses where the team already has a live subscription to manage, rather
# than one to buy.
LIVE_STATUSES = [
    SubscriptionStatus.ACTIVE.value,
    SubscriptionStatus.TRIALING.value,
    SubscriptionStatus.PAST_DUE.value,
]


class CheckoutRequest(BaseModel):
    interval: SubscriptionInterval
    seats: int = Field(ge=1, le=MAX_SEATS)


class SeatsRequest(BaseModel):
    seats: int = Field(ge=1, le=MAX_SEATS)


def _ensure_enough_seats(db: Session, organization_id: uuid.UUID, seats: int) -> None:
    seats_taken = organization_crud.seats_taken(db, organization_id)
    if seats < seats_taken:
        raise HTTPException(
            status_code=400,
            detail=(
                f"{seats_taken} seats are in use by members and pending invitations. "
                "Remove someone or retract an invitation first."
            ),
        )


@router.post("/{organization_id}/checkout")
def create_team_checkout_session(
    organization_id: uuid.UUID,
    request: CheckoutRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """Start an embedded Stripe checkout for the team's seats."""
    organization = get_organization_for_admin(db, organization_id, current_user)

    if organization.status in LIVE_STATUSES and organization.stripe_subscription_id:
        raise HTTPException(
            status_code=400,
            detail="This team already has a subscription. Change seats or use the billing portal instead.",
        )
    _ensure_enough_seats(db, organization_id, request.seats)

    price_id = (
        TEAM_MONTHLY_PRICE_ID
        if request.interval == SubscriptionInterval.MONTHLY
        else TEAM_YEARLY_PRICE_ID
    )
    if not price_id:
        raise HTTPException(status_code=500, detail="Team price ID not configured")

    try:
        # A previous checkout whose first payment failed leaves an incomplete
        # subscription behind; cancel it so the team doesn't end up with two.
        if (
            organization.status == SubscriptionStatus.INCOMPLETE.value
            and organization.stripe_subscription_id
        ):
            try:
                stripe.Subscription.cancel(str(organization.stripe_subscription_id))
            except Exception as e:
                logger.warning(
                    f"Failed to cancel incomplete team subscription "
                    f"{organization.stripe_subscription_id}: {e}"
                )

        if not organization.stripe_customer_id:
            customer = stripe.Customer.create(
                email=current_user.email,
                name=str(organization.name),
                metadata={
                    "organization_id": str(organization.id),
                    "created_by_user_id": str(current_user.id),
                },
            )
            organization.stripe_customer_id = customer.id  # type: ignore[assignment]
            db.commit()

        metadata = {"organization_id": str(organization.id)}
        session = stripe.checkout.Session.create(
            ui_mode="embedded_page",
            customer=str(organization.stripe_customer_id),
            client_reference_id=str(current_user.id),
            line_items=[{"price": price_id, "quantity": request.seats}],
            mode="subscription",
            allow_promotion_codes=True,
            metadata=metadata,
            subscription_data={"metadata": metadata},
            return_url=f"{YOUR_DOMAIN}/team/{organization.id}?session_id={{CHECKOUT_SESSION_ID}}",
        )
    except Exception as e:
        logger.error(f"Error creating team checkout session: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Could not start checkout")

    track_event(
        "team_checkout_initiated",
        properties={
            "organization_id": str(organization.id),
            "interval": request.interval,
            "seats": request.seats,
        },
        user_id=str(current_user.id),
        db=db,
    )
    return {"client_secret": session.client_secret}


@router.put("/{organization_id}/seats")
def change_seats(
    organization_id: uuid.UUID,
    request: SeatsRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """Change the number of seats on a live subscription. Stripe prorates the
    difference onto the next invoice."""
    organization = get_organization_for_admin(db, organization_id, current_user)

    if (
        organization.status not in LIVE_STATUSES
        or not organization.stripe_subscription_id
    ):
        raise HTTPException(
            status_code=400, detail="This team doesn't have a subscription yet."
        )
    _ensure_enough_seats(db, organization_id, request.seats)

    if request.seats == organization.seats:
        return serialize_organization(organization, role=OrganizationRoles.ADMIN.value)

    try:
        stripe_sub = stripe.Subscription.retrieve(
            str(organization.stripe_subscription_id)
        )
        item_id = stripe_sub["items"]["data"][0]["id"]
        stripe.Subscription.modify(
            str(organization.stripe_subscription_id),
            items=[{"id": item_id, "quantity": request.seats}],
            proration_behavior="create_prorations",
        )
    except Exception as e:
        logger.error(
            f"Error changing seats for team {organization_id}: {e}", exc_info=True
        )
        raise HTTPException(status_code=500, detail="Could not change seats")

    # The subscription.updated webhook will confirm this; set it now so the
    # admin can invite into the new seats immediately.
    previous_seats = organization.seats
    organization.seats = request.seats  # type: ignore[assignment]
    db.commit()
    db.refresh(organization)

    track_event(
        "team_seats_changed",
        properties={
            "organization_id": str(organization_id),
            "from": previous_seats,
            "to": request.seats,
        },
        user_id=str(current_user.id),
        db=db,
    )
    return serialize_organization(organization, role=OrganizationRoles.ADMIN.value)


@router.post("/{organization_id}/portal")
def create_team_portal_session(
    organization_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """Stripe billing portal for the team: payment method, invoices, cancellation."""
    organization = get_organization_for_admin(db, organization_id, current_user)
    if not organization.stripe_customer_id:
        raise HTTPException(
            status_code=400, detail="This team doesn't have billing set up yet."
        )

    try:
        portal_session = stripe.billing_portal.Session.create(
            customer=str(organization.stripe_customer_id),
            return_url=f"{YOUR_DOMAIN}/team/{organization.id}",
        )
    except Exception as e:
        logger.error(f"Error creating team portal session: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Could not open billing portal")
    return {"url": portal_session.url}
