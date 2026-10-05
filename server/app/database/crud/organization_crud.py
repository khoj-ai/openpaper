import uuid
from datetime import datetime, timezone
from typing import List, Optional

from app.database.crud.base_crud import CRUDBase
from app.database.models import (
    Organization,
    OrganizationInvitation,
    OrganizationMembership,
    OrganizationRoles,
    SubscriptionStatus,
    User,
)
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

ACTIVE_STATUSES = [SubscriptionStatus.ACTIVE.value, SubscriptionStatus.TRIALING.value]


class OrganizationError(Exception):
    """A request the organization can't satisfy; the message is safe to show the user."""


def normalize_email(email: str) -> str:
    return email.strip().lower()


class OrganizationCreate(BaseModel):
    name: str


class OrganizationUpdate(BaseModel):
    name: Optional[str] = None
    plan: Optional[str] = None
    status: Optional[str] = None
    seats: Optional[int] = None
    current_period_start: Optional[datetime] = None
    current_period_end: Optional[datetime] = None
    cancel_at_period_end: Optional[bool] = None
    canceled_at: Optional[datetime] = None
    stripe_customer_id: Optional[str] = None
    stripe_subscription_id: Optional[str] = None
    stripe_price_id: Optional[str] = None


class CRUDOrganization(CRUDBase[Organization, OrganizationCreate, OrganizationUpdate]):
    """CRUD operations for organizations and their memberships"""

    def create_with_admin(
        self, db: Session, *, obj_in: OrganizationCreate, admin_user_id: uuid.UUID
    ) -> Organization:
        """Create an organization and make its creator the first admin."""
        organization = Organization(name=obj_in.name)
        organization.memberships.append(
            OrganizationMembership(
                user_id=admin_user_id, role=OrganizationRoles.ADMIN.value
            )
        )
        db.add(organization)
        db.commit()
        db.refresh(organization)
        return organization

    def get_for_user(self, db: Session, user_id: uuid.UUID) -> List[Organization]:
        """All organizations the user belongs to, in any role."""
        return (
            db.query(Organization)
            .join(OrganizationMembership)
            .filter(OrganizationMembership.user_id == user_id)
            .order_by(Organization.created_at)
            .all()
        )

    def get_paid_for_user(self, db: Session, user_id: uuid.UUID) -> List[Organization]:
        """Organizations the user belongs to whose subscription is currently paid up."""
        return (
            db.query(Organization)
            .join(OrganizationMembership)
            .filter(
                OrganizationMembership.user_id == user_id,
                Organization.status.in_(ACTIVE_STATUSES),
                Organization.current_period_end > datetime.now(timezone.utc),
            )
            .all()
        )

    def get_by_stripe_subscription_id(
        self, db: Session, subscription_id: str
    ) -> Optional[Organization]:
        return (
            db.query(Organization)
            .filter(Organization.stripe_subscription_id == subscription_id)
            .first()
        )

    def get_membership(
        self, db: Session, *, organization_id: uuid.UUID, user_id: uuid.UUID
    ) -> Optional[OrganizationMembership]:
        return (
            db.query(OrganizationMembership)
            .filter(
                OrganizationMembership.organization_id == organization_id,
                OrganizationMembership.user_id == user_id,
            )
            .first()
        )

    def is_admin(
        self, db: Session, *, organization_id: uuid.UUID, user_id: uuid.UUID
    ) -> bool:
        membership = self.get_membership(
            db, organization_id=organization_id, user_id=user_id
        )
        return bool(membership and membership.role == OrganizationRoles.ADMIN.value)

    def count_members(self, db: Session, organization_id: uuid.UUID) -> int:
        return (
            db.query(OrganizationMembership)
            .filter(OrganizationMembership.organization_id == organization_id)
            .count()
        )

    def get_members(
        self, db: Session, organization_id: uuid.UUID
    ) -> List[OrganizationMembership]:
        return (
            db.query(OrganizationMembership)
            .options(joinedload(OrganizationMembership.user))
            .filter(OrganizationMembership.organization_id == organization_id)
            .order_by(OrganizationMembership.created_at)
            .all()
        )

    def seats_taken(self, db: Session, organization_id: uuid.UUID) -> int:
        """Members plus pending invitations: an invitation holds its seat."""
        return self.count_members(db, organization_id) + len(
            organization_invitation_crud.get_pending_for_organization(
                db, organization_id
            )
        )

    def _get_membership_or_raise(
        self, db: Session, organization_id: uuid.UUID, user_id: uuid.UUID
    ) -> OrganizationMembership:
        membership = self.get_membership(
            db, organization_id=organization_id, user_id=user_id
        )
        if not membership:
            raise OrganizationError("That person isn't a member of this team.")
        return membership

    def _ensure_not_last_admin(
        self, db: Session, membership: OrganizationMembership
    ) -> None:
        if membership.role != OrganizationRoles.ADMIN.value:
            return
        admin_count = (
            db.query(OrganizationMembership)
            .filter(
                OrganizationMembership.organization_id == membership.organization_id,
                OrganizationMembership.role == OrganizationRoles.ADMIN.value,
            )
            .count()
        )
        if admin_count <= 1:
            raise OrganizationError(
                "A team needs at least one admin. Make someone else an admin first."
            )

    def remove_member(
        self, db: Session, *, organization_id: uuid.UUID, user_id: uuid.UUID
    ) -> None:
        membership = self._get_membership_or_raise(db, organization_id, user_id)
        self._ensure_not_last_admin(db, membership)
        db.delete(membership)
        db.commit()

    def set_role(
        self,
        db: Session,
        *,
        organization_id: uuid.UUID,
        user_id: uuid.UUID,
        role: OrganizationRoles,
    ) -> OrganizationMembership:
        membership = self._get_membership_or_raise(db, organization_id, user_id)
        if role != OrganizationRoles.ADMIN:
            self._ensure_not_last_admin(db, membership)
        membership.role = role.value  # type: ignore[assignment]
        db.commit()
        db.refresh(membership)
        return membership


organization_crud = CRUDOrganization(Organization)


class CRUDOrganizationInvitation:
    """
    Invitations hold a seat until accepted, rejected, or retracted. Only the
    account whose email matches the invitation can accept it.
    """

    def get_pending_for_organization(
        self, db: Session, organization_id: uuid.UUID
    ) -> List[OrganizationInvitation]:
        return (
            db.query(OrganizationInvitation)
            .filter(
                OrganizationInvitation.organization_id == organization_id,
                OrganizationInvitation.accepted_at.is_(None),
            )
            .order_by(OrganizationInvitation.invited_at)
            .all()
        )

    def get_pending_for_email(
        self, db: Session, email: str
    ) -> List[OrganizationInvitation]:
        return (
            db.query(OrganizationInvitation)
            .options(
                joinedload(OrganizationInvitation.organization),
                joinedload(OrganizationInvitation.inviter),
            )
            .filter(
                func.lower(OrganizationInvitation.email) == normalize_email(email),
                OrganizationInvitation.accepted_at.is_(None),
            )
            .all()
        )

    def invite(
        self,
        db: Session,
        *,
        organization: Organization,
        email: str,
        invited_by: uuid.UUID,
    ) -> OrganizationInvitation:
        email = normalize_email(email)
        organization_id: uuid.UUID = organization.id  # type: ignore[assignment]

        existing_member = (
            db.query(OrganizationMembership)
            .join(User)
            .filter(
                OrganizationMembership.organization_id == organization_id,
                func.lower(User.email) == email,
            )
            .first()
        )
        if existing_member:
            raise OrganizationError(f"{email} is already on this team.")

        for pending in self.get_pending_for_organization(db, organization_id):
            if normalize_email(str(pending.email)) == email:
                return pending

        if organization_crud.seats_taken(db, organization_id) >= organization.seats:
            raise OrganizationError(
                "Every seat is taken. Add seats or retract an invitation first."
            )

        invitation = OrganizationInvitation(
            organization_id=organization_id,
            email=email,
            invited_by=invited_by,
            role=OrganizationRoles.MEMBER.value,
        )
        db.add(invitation)
        db.commit()
        db.refresh(invitation)
        return invitation

    def _get_for_user(
        self, db: Session, invitation_id: uuid.UUID, user_email: str
    ) -> OrganizationInvitation:
        invitation = (
            db.query(OrganizationInvitation)
            .filter(
                OrganizationInvitation.id == invitation_id,
                OrganizationInvitation.accepted_at.is_(None),
            )
            .first()
        )
        if not invitation or normalize_email(str(invitation.email)) != normalize_email(
            user_email
        ):
            raise OrganizationError("Invitation not found.")
        return invitation

    def accept(
        self,
        db: Session,
        *,
        invitation_id: uuid.UUID,
        user_id: uuid.UUID,
        user_email: str,
    ) -> OrganizationMembership:
        invitation = self._get_for_user(db, invitation_id, user_email)

        membership = organization_crud.get_membership(
            db, organization_id=invitation.organization_id, user_id=user_id  # type: ignore[arg-type]
        )
        if not membership:
            membership = OrganizationMembership(
                organization_id=invitation.organization_id,
                user_id=user_id,
                role=invitation.role,
            )
            db.add(membership)

        invitation.accepted_at = datetime.now(timezone.utc)  # type: ignore[assignment]
        db.commit()
        db.refresh(membership)
        return membership

    def reject(self, db: Session, *, invitation_id: uuid.UUID, user_email: str) -> None:
        invitation = self._get_for_user(db, invitation_id, user_email)
        db.delete(invitation)
        db.commit()

    def retract(
        self, db: Session, *, invitation_id: uuid.UUID, organization_id: uuid.UUID
    ) -> None:
        invitation = (
            db.query(OrganizationInvitation)
            .filter(
                OrganizationInvitation.id == invitation_id,
                OrganizationInvitation.organization_id == organization_id,
                OrganizationInvitation.accepted_at.is_(None),
            )
            .first()
        )
        if not invitation:
            raise OrganizationError("Invitation not found.")
        db.delete(invitation)
        db.commit()


organization_invitation_crud = CRUDOrganizationInvitation()
