"""
Subscription limits and enforcement utilities.

This module defines the subscription plans and their associated limits,
and provides functions to check if a user can perform certain actions
based on their subscription plan.
"""

import logging
from datetime import datetime, timezone
from typing import Dict, Optional

from app.database.crud.paper_crud import paper_crud
from app.database.crud.subscription_crud import subscription_crud
from app.database.models import SubscriptionPlan, SubscriptionStatus
from app.schemas.user import CurrentUser
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

PAPER_UPLOAD_KEY = "paper_uploads"
KB_SIZE_KEY = "knowledge_base_size_mb"
CHAT_CREDITS_KEY = "chat_credits_daily"
AUDIO_OVERVIEWS_KEY = "audio_overviews_monthly"
MODELS_KEY = "models"

# Define subscription plan limits
SUBSCRIPTION_LIMITS = {
    SubscriptionPlan.BASIC: {
        # PAPER_UPLOAD_KEY: 10,
        PAPER_UPLOAD_KEY: 0,  # test
        # KB_SIZE_KEY: 500,
        KB_SIZE_KEY: 0,  # test
        CHAT_CREDITS_KEY: 500,
        AUDIO_OVERVIEWS_KEY: 5,
        MODELS_KEY: ["basic"],
    },
    SubscriptionPlan.RESEARCHER: {
        # PAPER_UPLOAD_KEY: 500,
        PAPER_UPLOAD_KEY: 0,  # test
        # KB_SIZE_KEY: 3 * 1024,  # 3 GB in MB
        KB_SIZE_KEY: 0,  # test
        CHAT_CREDITS_KEY: 10000,
        AUDIO_OVERVIEWS_KEY: 100,
        MODELS_KEY: ["basic", "advanced"],
    },
}


def get_user_subscription_plan(db: Session, user: CurrentUser) -> SubscriptionPlan:
    """
    Get the user's current subscription plan.
    Returns BASIC if no active subscription is found.
    """
    subscription = subscription_crud.get_by_user_id(db, user.id)

    if not subscription:
        return SubscriptionPlan.BASIC

    # Check if subscription is active and not expired
    if (
        subscription.current_period_end
        and subscription.current_period_end > datetime.now(timezone.utc)
    ):
        if subscription.status in [
            SubscriptionStatus.ACTIVE,
            SubscriptionStatus.TRIALING,
        ]:
            return SubscriptionPlan(subscription.plan)

    # If subscription is expired or inactive, return BASIC
    return SubscriptionPlan.BASIC


def get_plan_limits(plan: SubscriptionPlan) -> Dict:
    """Get the limits for a specific subscription plan."""
    return SUBSCRIPTION_LIMITS.get(plan, SUBSCRIPTION_LIMITS[SubscriptionPlan.BASIC])


def get_user_paper_count(db: Session, user: CurrentUser) -> int:
    """
    Get the total number of successfully uploaded papers for a user.
    Only counts papers that have completed upload processing.
    """
    papers = paper_crud.get_multi_uploads_completed(db=db, user=user, limit=1000)
    return len(papers)


def get_user_knowledge_base_size(db: Session, user: CurrentUser) -> int:
    """
    Get the total size of the user's knowledge base in MB.
    """
    return paper_crud.get_size_of_knowledge_base(db, user=user)


def get_user_knowledge_base_size_limit(db: Session, user: CurrentUser) -> Dict:
    """
    Get the knowledge base limits for a user based on their subscription plan.

    Returns:
        Dict: A dictionary containing the knowledge base size limit in MB.
    """
    plan = get_user_subscription_plan(db, user)
    limits = get_plan_limits(plan)

    return limits[KB_SIZE_KEY]


def can_user_upload_paper(db: Session, user: CurrentUser) -> tuple[bool, Optional[str]]:
    """
    Check if a user can upload a new paper based on their subscription limits.

    Returns:
        tuple: (can_upload: bool, error_message: Optional[str])
    """
    plan = get_user_subscription_plan(db, user)
    limits = get_plan_limits(plan)

    current_paper_count = get_user_paper_count(db, user)
    paper_limit = limits[PAPER_UPLOAD_KEY]

    # Handle unlimited plans
    if paper_limit == float("inf"):
        return True, None

    # If the user has reached their paper upload limit
    if current_paper_count >= paper_limit:
        plan_name = {
            SubscriptionPlan.BASIC: "Basic",
            SubscriptionPlan.RESEARCHER: "Researcher",
        }.get(plan, "Basic")
        return (
            False,
            f"You have reached your paper upload limit ({int(paper_limit)} papers) for the {plan_name} plan. Please upgrade your subscription to upload more papers.",
        )

    return True, None


def can_user_access_knowledge_base(
    db: Session, user: CurrentUser
) -> tuple[bool, Optional[str]]:
    """
    Check if a user can access their knowledge base based on their subscription limits.

    Returns:
        tuple: (can_access: bool, error_message: Optional[str])
    """
    plan = get_user_subscription_plan(db, user)
    limits = get_plan_limits(plan)

    current_size_mb = get_user_knowledge_base_size(db, user)
    kb_limit = limits[KB_SIZE_KEY]

    # Handle unlimited plans
    if kb_limit == float("inf"):
        return True, None

    # If the user has exceeded their knowledge base size limit
    if current_size_mb >= kb_limit:
        plan_name = {
            SubscriptionPlan.BASIC: "Basic",
            SubscriptionPlan.RESEARCHER: "Researcher",
        }.get(plan, "Basic")
        return (
            False,
            f"You have reached your knowledge base size limit ({int(kb_limit)} MB) for the {plan_name} plan. Please upgrade your subscription to access more data.",
        )

    return True, None


def get_user_usage_info(db: Session, user: CurrentUser) -> Dict:
    """
    Get comprehensive usage information for a user.

    Returns a dictionary with current usage and limits.
    """
    plan = get_user_subscription_plan(db, user)
    limits = get_plan_limits(plan)

    current_paper_count = get_user_paper_count(db, user)
    paper_limit = limits[PAPER_UPLOAD_KEY]

    # Handle unlimited plans
    papers_remaining = (
        None
        if paper_limit == float("inf")
        else max(0, int(paper_limit) - current_paper_count)
    )

    return {
        "plan": plan.value,
        "limits": {
            **limits,
            # Convert inf to a more readable format for the API
            "paper_uploads": (
                "unlimited" if paper_limit == float("inf") else int(paper_limit)
            ),
            "chat_credits_daily": (
                "unlimited"
                if limits["chat_credits_daily"] == float("inf")
                else limits["chat_credits_daily"]
            ),
            "audio_overviews_monthly": (
                "unlimited"
                if limits["audio_overviews_monthly"] == float("inf")
                else limits["audio_overviews_monthly"]
            ),
        },
        "usage": {
            "papers_uploaded": current_paper_count,
            "papers_remaining": papers_remaining,
        },
    }
