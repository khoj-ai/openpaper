import uuid
from datetime import datetime, timezone
from typing import List, Optional

from app.database.crud.base_crud import CRUDBase
from app.database.models import (
    Organization,
    OrganizationMembership,
    OrganizationRoles,
    SubscriptionStatus,
)
from pydantic import BaseModel
from sqlalchemy.orm import Session

ACTIVE_STATUSES = [SubscriptionStatus.ACTIVE.value, SubscriptionStatus.TRIALING.value]


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


organization_crud = CRUDOrganization(Organization)
