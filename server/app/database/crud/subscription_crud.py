import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Union

from app.database.crud.base_crud import CRUDBase
from app.database.models import Subscription, SubscriptionPlan, SubscriptionStatus
from app.schemas.user import CurrentUser
from pydantic import BaseModel
from sqlalchemy.orm import Session


class SubscriptionCreate(BaseModel):
    """Schema for creating a subscription"""

    user_id: uuid.UUID
    stripe_customer_id: Optional[str] = None
    stripe_subscription_id: Optional[str] = None
    stripe_price_id: Optional[str] = None
    stripe_schedule_id: Optional[str] = None
    status: str = SubscriptionStatus.INCOMPLETE.value
    current_period_start: Optional[datetime] = None
    current_period_end: Optional[datetime] = None
    cancel_at_period_end: bool = False


class SubscriptionUpdate(BaseModel):
    """Schema for updating a subscription"""

    stripe_customer_id: Optional[str] = None
    stripe_subscription_id: Optional[str] = None
    stripe_price_id: Optional[str] = None
    stripe_schedule_id: Optional[str] = None
    status: Optional[str] = None
    current_period_start: Optional[datetime] = None
    current_period_end: Optional[datetime] = None
    cancel_at_period_end: Optional[bool] = None


class CRUDSubscription(CRUDBase[Subscription, SubscriptionCreate, SubscriptionUpdate]):
    """CRUD operations for subscription management"""

    def is_user_active(self, db: Session, user: CurrentUser) -> bool:
        """Check if the user has an active subscription"""
        subscription = self.get_by_user_id(db, user.id)
        if not subscription or not subscription.current_period_end:
            return False
        # User is active if `current_period_end` is in the future
        return subscription.current_period_end > datetime.now(
            tz=timezone.utc
        )  # type: ignore

    def get_by_user_id(self, db: Session, user_id: uuid.UUID) -> Optional[Subscription]:
        """Get subscription by user_id"""
        return db.query(self.model).filter(self.model.user_id == user_id).first()

    def get_by_stripe_subscription_id(
        self, db: Session, subscription_id: str
    ) -> Optional[Subscription]:
        """Get subscription by stripe_subscription_id"""
        return (
            db.query(self.model)
            .filter(self.model.stripe_subscription_id == subscription_id)
            .first()
        )

    def get_by_stripe_customer_id(
        self, db: Session, customer_id: str
    ) -> Optional[Subscription]:
        """Get subscription by stripe_customer_id"""
        return (
            db.query(self.model)
            .filter(self.model.stripe_customer_id == customer_id)
            .first()
        )

    def create_or_update(
        self, db: Session, user_id: uuid.UUID, subscription_data: Dict[str, Any]
    ) -> Subscription:
        """Create a subscription or update if exists"""
        subscription = self.get_by_user_id(db, user_id)

        if subscription:
            # Update existing subscription
            for key, value in subscription_data.items():
                setattr(subscription, key, value)
            db.commit()
            db.refresh(subscription)
            return subscription

        # Create new subscription
        create_data = SubscriptionCreate(user_id=user_id, **subscription_data)
        return self.create(db, obj_in=create_data)

    def update_subscription_status(
        self,
        db: Session,
        subscription_id: str,
        status: str,
        stripe_price_id: Optional[str] = None,
        plan: Optional[SubscriptionPlan] = None,
        period_start: Optional[datetime] = None,
        period_end: Optional[datetime] = None,
        cancel_at_period_end: Optional[bool] = None,
    ) -> Optional[Subscription]:
        """Update subscription status and period dates"""
        subscription = self.get_by_stripe_subscription_id(db, subscription_id)
        if not subscription:
            return None

        # Use setattr to update fields
        setattr(subscription, "status", status)
        if plan:
            setattr(subscription, "plan", plan)

        if stripe_price_id:
            setattr(subscription, "stripe_price_id", stripe_price_id)

        # Update period dates if provided
        if period_start:
            setattr(subscription, "current_period_start", period_start)

        if period_end:
            setattr(subscription, "current_period_end", period_end)

        if cancel_at_period_end is not None:
            setattr(subscription, "cancel_at_period_end", cancel_at_period_end)

        db.commit()
        db.refresh(subscription)
        return subscription


subscription_crud = CRUDSubscription(Subscription)
