"""
Team (organization) management: create a team, manage its members and
invitations, and let admins see how each seat is being used.
"""

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

from app.api.organization.invitation_emails import send_held_invitations
from app.auth.dependencies import get_required_user
from app.database.crud.organization_crud import (
    OrganizationCreate,
    OrganizationError,
    is_paid,
    organization_crud,
    organization_invitation_crud,
)
from app.database.crud.subscription_crud import subscription_crud
from app.database.database import get_db
from app.database.models import (
    Message,
    Organization,
    OrganizationInvitation,
    OrganizationMembership,
    OrganizationRoles,
    Paper,
    SubscriptionStatus,
)
from app.database.telemetry import track_event
from app.helpers.subscription_limits import get_user_usage_info
from app.schemas.user import CurrentUser
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func
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
        # False while the team is being set up; the email goes out once it's paid.
        "sent": invitation.email_sent_at is not None,
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
    rejected, or retracted. On a team that's still being set up, invitations
    are held and emailed once checkout goes through. Returns per-email results
    so one full seat or existing member doesn't fail the whole batch."""
    organization = get_organization_for_admin(db, organization_id, current_user)

    invited: List[OrganizationInvitation] = []
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

        invited.append(invitation)

    send_held_invitations(db, organization)

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
    for invitation in invited:
        db.refresh(invitation)
    return {
        "invited": [serialize_invitation(i) for i in invited],
        "failed": failed,
    }


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


def get_member_activity(
    db: Session, user_ids: List[uuid.UUID]
) -> Dict[uuid.UUID, Dict]:
    """For each user: when they last asked a question or opened a paper, how
    many questions they asked this week, and how many papers they opened in
    the last 30 days."""
    now = datetime.now(timezone.utc)
    week_ago, month_ago = now - timedelta(days=7), now - timedelta(days=30)
    activity: Dict[uuid.UUID, Dict] = {
        user_id: {
            "last_active_at": None,
            "questions_this_week": 0,
            "papers_opened_this_month": 0,
        }
        for user_id in user_ids
    }
    if not user_ids:
        return activity

    message_rows = (
        db.query(
            Message.user_id,
            func.max(Message.created_at),
            func.count(Message.id).filter(Message.created_at >= week_ago),
        )
        .filter(Message.user_id.in_(user_ids), Message.role == "user")
        .group_by(Message.user_id)
        .all()
    )
    paper_rows = (
        db.query(
            Paper.user_id,
            func.max(Paper.last_accessed_at),
            func.count(Paper.id).filter(Paper.last_accessed_at >= month_ago),
        )
        .filter(Paper.user_id.in_(user_ids))
        .group_by(Paper.user_id)
        .all()
    )

    for user_id, last_message_at, questions in message_rows:
        activity[user_id]["last_active_at"] = last_message_at
        activity[user_id]["questions_this_week"] = questions
    for user_id, last_opened_at, papers_opened in paper_rows:
        current = activity[user_id]["last_active_at"]
        if last_opened_at and (current is None or last_opened_at > current):
            activity[user_id]["last_active_at"] = last_opened_at
        activity[user_id]["papers_opened_this_month"] = papers_opened
    return activity


@router.get("/{organization_id}/usage")
def get_organization_usage(
    organization_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    """Per-seat usage for admins, plus a team summary. Limits apply to each
    seat individually, so this is a breakdown by member rather than a pooled
    total. The summary is what an admin needs to judge whether the plan is
    worth renewing."""
    get_organization_for_admin(db, organization_id, current_user)

    memberships = [
        m for m in organization_crud.get_members(db, organization_id) if m.user
    ]
    activity = get_member_activity(db, [uuid.UUID(str(m.user_id)) for m in memberships])
    week_ago = datetime.now(timezone.utc) - timedelta(days=7)

    members = []
    for membership in memberships:
        user = membership.user
        user_id = uuid.UUID(str(user.id))
        member_as_user = CurrentUser(
            id=user_id,
            email=str(user.email),
            name=user.name,  # type: ignore[arg-type]
        )
        usage_info = get_user_usage_info(db, member_as_user, track_high_usage=False)
        member_activity = activity[user_id]
        last_active_at = member_activity["last_active_at"]
        members.append(
            {
                **serialize_member(membership),
                "plan": usage_info["plan"],
                "limits": usage_info["limits"],
                "usage": usage_info["usage"],
                "last_active_at": (
                    last_active_at.isoformat() if last_active_at else None
                ),
                "questions_this_week": member_activity["questions_this_week"],
                "papers_opened_this_month": member_activity["papers_opened_this_month"],
            }
        )

    return {
        "summary": {
            "members": len(members),
            "active_this_week": sum(
                1
                for a in activity.values()
                if a["last_active_at"] and a["last_active_at"] >= week_ago
            ),
            "questions_this_week": sum(
                a["questions_this_week"] for a in activity.values()
            ),
            "papers_opened_this_month": sum(
                a["papers_opened_this_month"] for a in activity.values()
            ),
        },
        "members": members,
    }
