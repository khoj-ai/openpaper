"""
Team (organization) management: create a team, manage its members and
invitations, and let admins see how each seat is being used.
"""

import logging
import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional

from app.auth.dependencies import get_required_user
from app.database.crud.organization_crud import (
    ACTIVE_STATUSES,
    OrganizationCreate,
    OrganizationError,
    organization_crud,
    organization_invitation_crud,
)
from app.database.crud.subscription_crud import subscription_crud
from app.database.database import get_db
from app.database.models import (
    Organization,
    OrganizationInvitation,
    OrganizationMembership,
    OrganizationRoles,
    SubscriptionStatus,
)
from app.database.telemetry import track_event
from app.helpers.email import send_organization_invite_email
from app.helpers.subscription_limits import get_user_usage_info
from app.schemas.user import CurrentUser
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

router = APIRouter()

MAX_INVITES_PER_REQUEST = 50


class CreateOrganizationRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class RenameOrganizationRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class InviteRequest(BaseModel):
    emails: List[EmailStr] = Field(min_length=1, max_length=MAX_INVITES_PER_REQUEST)


class SetRoleRequest(BaseModel):
    role: OrganizationRoles


def is_paid(organization: Organization) -> bool:
    return bool(
        organization.status in ACTIVE_STATUSES
        and organization.current_period_end
        and organization.current_period_end > datetime.now(timezone.utc)
    )


def serialize_organization(
    organization: Organization, role: Optional[str] = None
) -> Dict:
    return {
        "id": str(organization.id),
        "name": organization.name,
        "plan": organization.plan,
        "status": organization.status,
        "is_paid": is_paid(organization),
        "seats": organization.seats,
        "current_period_end": (
            organization.current_period_end.isoformat()
            if organization.current_period_end
            else None
        ),
        "cancel_at_period_end": bool(organization.cancel_at_period_end),
        "role": role,
    }


def serialize_member(membership: OrganizationMembership) -> Dict:
    return {
        "user_id": str(membership.user_id),
        "name": membership.user.name if membership.user else None,
        "email": membership.user.email if membership.user else None,
        "picture": membership.user.picture if membership.user else None,
        "role": membership.role,
        "joined_at": (
            membership.created_at.isoformat() if membership.created_at else None
        ),
    }


def serialize_invitation(invitation: OrganizationInvitation) -> Dict:
    return {
        "id": str(invitation.id),
        "email": invitation.email,
        "role": invitation.role,
        "invited_at": (
            invitation.invited_at.isoformat() if invitation.invited_at else None
        ),
    }


def get_organization_for_member(
    db: Session, organization_id: uuid.UUID, user: CurrentUser
) -> tuple[Organization, OrganizationMembership]:
    """Fetch an organization the user belongs to; 404 otherwise, so non-members
    can't probe which team ids exist."""
    organization = organization_crud.get(db, id=organization_id)
    membership = (
        organization_crud.get_membership(
            db, organization_id=organization_id, user_id=user.id
        )
        if organization
        else None
    )
    if not organization or not membership:
        raise HTTPException(status_code=404, detail="Team not found")
    return organization, membership


def get_organization_for_admin(
    db: Session, organization_id: uuid.UUID, user: CurrentUser
) -> Organization:
    organization, membership = get_organization_for_member(db, organization_id, user)
    if membership.role != OrganizationRoles.ADMIN.value:
        raise HTTPException(status_code=403, detail="Only team admins can do that")
    return organization


def has_active_personal_subscription(db: Session, user: CurrentUser) -> bool:
    """A personal plan that will keep billing; one already set to cancel doesn't count."""
    subscription = subscription_crud.get_by_user_id(db, user.id)
    return bool(
        subscription
        and subscription.status
        in [
            SubscriptionStatus.ACTIVE.value,
            SubscriptionStatus.TRIALING.value,
            SubscriptionStatus.PAST_DUE.value,
        ]
        and not subscription.cancel_at_period_end
    )


@router.post("")
def create_organization(
    request: CreateOrganizationRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """Create a team with the current user as its first admin. Seats are bought
    separately through checkout."""
    organization = organization_crud.create_with_admin(
        db,
        obj_in=OrganizationCreate(name=request.name.strip()),
        admin_user_id=current_user.id,
    )
    track_event(
        "organization_created",
        properties={"organization_id": str(organization.id)},
        user_id=str(current_user.id),
        db=db,
    )
    return serialize_organization(organization, role=OrganizationRoles.ADMIN.value)


@router.get("")
def list_my_organizations(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """Teams the user belongs to, plus whether they're still paying for a
    personal plan (so the client can suggest canceling it once a team covers them)."""
    organizations = []
    for organization in organization_crud.get_for_user(db, current_user.id):
        membership = organization_crud.get_membership(
            db, organization_id=organization.id, user_id=current_user.id  # type: ignore[arg-type]
        )
        organizations.append(
            serialize_organization(
                organization, role=membership.role if membership else None
            )
        )
    return {
        "organizations": organizations,
        "has_active_personal_subscription": has_active_personal_subscription(
            db, current_user
        ),
    }


@router.get("/invitations")
def list_my_invitations(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """Pending team invitations addressed to the current user's email."""
    invitations = organization_invitation_crud.get_pending_for_email(
        db, current_user.email
    )
    return {
        "invitations": [
            {
                **serialize_invitation(invitation),
                "organization_id": str(invitation.organization_id),
                "organization_name": invitation.organization.name,
                "invited_by": (
                    invitation.inviter.name or invitation.inviter.email
                    if invitation.inviter
                    else None
                ),
            }
            for invitation in invitations
        ]
    }


@router.post("/invitations/{invitation_id}/accept")
def accept_invitation(
    invitation_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    try:
        membership = organization_invitation_crud.accept(
            db,
            invitation_id=invitation_id,
            user_id=current_user.id,
            user_email=current_user.email,
        )
    except OrganizationError as e:
        raise HTTPException(status_code=404, detail=str(e))

    track_event(
        "organization_invitation_accepted",
        properties={"organization_id": str(membership.organization_id)},
        user_id=str(current_user.id),
        db=db,
    )
    return {
        "organization": serialize_organization(
            membership.organization, role=membership.role
        ),
        "has_active_personal_subscription": has_active_personal_subscription(
            db, current_user
        ),
    }


@router.post("/invitations/{invitation_id}/reject")
def reject_invitation(
    invitation_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    try:
        organization_invitation_crud.reject(
            db, invitation_id=invitation_id, user_email=current_user.email
        )
    except OrganizationError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"success": True}


@router.get("/{organization_id}")
def get_organization(
    organization_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """Team details. Members see who's on the team; admins also see pending
    invitations and seat counts."""
    organization, membership = get_organization_for_member(
        db, organization_id, current_user
    )
    is_admin = membership.role == OrganizationRoles.ADMIN.value
    members = organization_crud.get_members(db, organization_id)

    response = {
        "organization": serialize_organization(organization, role=membership.role),
        "members": [serialize_member(m) for m in members],
    }
    if is_admin:
        invitations = organization_invitation_crud.get_pending_for_organization(
            db, organization_id
        )
        response["invitations"] = [serialize_invitation(i) for i in invitations]
        response["seats_taken"] = len(members) + len(invitations)
    return response


@router.patch("/{organization_id}")
def rename_organization(
    organization_id: uuid.UUID,
    request: RenameOrganizationRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    organization = get_organization_for_admin(db, organization_id, current_user)
    organization.name = request.name.strip()  # type: ignore[assignment]
    db.commit()
    db.refresh(organization)
    return serialize_organization(organization, role=OrganizationRoles.ADMIN.value)


@router.post("/{organization_id}/invitations")
def invite_members(
    organization_id: uuid.UUID,
    request: InviteRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """Invite people by email. Each invitation holds a seat until it's accepted,
    rejected, or retracted. Returns per-email results so one full seat or
    existing member doesn't fail the whole batch."""
    organization = get_organization_for_admin(db, organization_id, current_user)
    if not is_paid(organization):
        raise HTTPException(
            status_code=400,
            detail="Buy seats for this team before inviting people.",
        )

    invited: List[Dict] = []
    failed: List[Dict] = []
    for email in request.emails:
        try:
            invitation = organization_invitation_crud.invite(
                db,
                organization=organization,
                email=str(email),
                invited_by=current_user.id,
            )
        except OrganizationError as e:
            failed.append({"email": str(email), "error": str(e)})
            continue

        invited.append(serialize_invitation(invitation))
        send_organization_invite_email(
            to_email=str(invitation.email),
            from_name=current_user.name or current_user.email,
            organization_name=str(organization.name),
        )

    if invited:
        track_event(
            "organization_members_invited",
            properties={
                "organization_id": str(organization_id),
                "count": len(invited),
            },
            user_id=str(current_user.id),
            db=db,
        )
    return {"invited": invited, "failed": failed}


@router.delete("/{organization_id}/invitations/{invitation_id}")
def retract_invitation(
    organization_id: uuid.UUID,
    invitation_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    get_organization_for_admin(db, organization_id, current_user)
    try:
        organization_invitation_crud.retract(
            db, invitation_id=invitation_id, organization_id=organization_id
        )
    except OrganizationError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"success": True}


@router.delete("/{organization_id}/members/{user_id}")
def remove_member(
    organization_id: uuid.UUID,
    user_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """Admins can remove anyone; members can remove themselves (leave the team)."""
    if user_id == current_user.id:
        get_organization_for_member(db, organization_id, current_user)
    else:
        get_organization_for_admin(db, organization_id, current_user)

    try:
        organization_crud.remove_member(
            db, organization_id=organization_id, user_id=user_id
        )
    except OrganizationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"success": True}


@router.put("/{organization_id}/members/{user_id}/role")
def set_member_role(
    organization_id: uuid.UUID,
    user_id: uuid.UUID,
    request: SetRoleRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    get_organization_for_admin(db, organization_id, current_user)
    try:
        membership = organization_crud.set_role(
            db, organization_id=organization_id, user_id=user_id, role=request.role
        )
    except OrganizationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return serialize_member(membership)


@router.get("/{organization_id}/usage")
def get_organization_usage(
    organization_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """Per-seat usage for admins. Limits apply to each seat individually, so this
    is a breakdown by member rather than a pooled total."""
    get_organization_for_admin(db, organization_id, current_user)

    members = []
    for membership in organization_crud.get_members(db, organization_id):
        user = membership.user
        if not user:
            continue
        member_as_user = CurrentUser(
            id=uuid.UUID(str(user.id)),
            email=str(user.email),
            name=user.name,  # type: ignore[arg-type]
        )
        usage_info = get_user_usage_info(db, member_as_user, track_high_usage=False)
        members.append(
            {
                **serialize_member(membership),
                "plan": usage_info["plan"],
                "limits": usage_info["limits"],
                "usage": usage_info["usage"],
            }
        )
    return {"members": members}
