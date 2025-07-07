"""
Subscription limits and enforcement utilities.

This module defines the subscription plans and their associated limits,
and provides functions to check if a user can perform certain actions
based on their subscription plan.
"""

import logging
from datetime import datetime, timezone
from typing import Dict, Optional

from app.database.crud.audio_overview_crud import audio_overview_crud
from app.database.crud.message_crud import message_crud
from app.database.crud.paper_crud import paper_crud
from app.database.crud.subscription_crud import subscription_crud
from app.database.models import SubscriptionPlan, SubscriptionStatus
from app.schemas.user import CurrentUser
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

PAPER_UPLOAD_KEY = "paper_uploads"
KB_SIZE_KEY = "knowledge_base_size"
CHAT_CREDITS_KEY = "chat_credits_weekly"
AUDIO_OVERVIEWS_KEY = "audio_overviews_weekly"

# Define subscription plan limits
SUBSCRIPTION_LIMITS = {
    SubscriptionPlan.BASIC: {
        PAPER_UPLOAD_KEY: 20,
        KB_SIZE_KEY: 500 * 1024,  # 500 MB in KB
        CHAT_CREDITS_KEY: 5000,
        AUDIO_OVERVIEWS_KEY: 5,
    },
    SubscriptionPlan.RESEARCHER: {
        PAPER_UPLOAD_KEY: 500,
        KB_SIZE_KEY: 3 * 1024 * 1024,  # 3 GB in KB
        CHAT_CREDITS_KEY: 100000,
        AUDIO_OVERVIEWS_KEY: 100,
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


def get_user_paper_count_limit(db: Session, user: CurrentUser) -> int:
    """
    Get the paper upload limits for a user based on their subscription plan.

    Returns:
        int: The paper upload limit.
    """
    plan = get_user_subscription_plan(db, user)
    limits = get_plan_limits(plan)

    return limits[PAPER_UPLOAD_KEY]


def get_user_knowledge_base_size(db: Session, user: CurrentUser) -> int:
    """
    Get the total size of the user's knowledge base in MB.
    """
    return paper_crud.get_size_of_knowledge_base(db, user=user)


def get_user_knowledge_base_size_limit(db: Session, user: CurrentUser) -> int:
    """
    Get the knowledge base limits for a user based on their subscription plan.

    Returns:
        int: The knowledge base size limit in MB.
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

    current_paper_count = paper_crud.get_total_paper_count(db=db, user=user)
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
            f"You have reached your paper upload limit ({int(paper_limit)} papers) for the {plan_name} plan. Please upgrade your subscription to upload more papers, or delete existing papers to free up space.",
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


def get_user_chat_credits_used_today(db: Session, user: CurrentUser) -> int:
    """
    Get the number of chat credits used by the user today.
    """
    return message_crud.get_chat_credits_used_this_week(db, current_user=user)


def get_user_audio_overviews_used_this_month(db: Session, user: CurrentUser) -> int:
    """
    Get the number of audio overviews used by the user this month.
    """
    return audio_overview_crud.get_audio_overviews_used_this_week(db, current_user=user)


def get_user_usage_info(db: Session, user: CurrentUser) -> Dict:
    """
    Get comprehensive usage information for a user.

    Returns a dictionary with current usage and limits.
    """
    plan = get_user_subscription_plan(db, user)
    limits = get_plan_limits(plan)

    current_paper_count = paper_crud.get_total_paper_count(db=db, user=user)
    paper_limit = limits[PAPER_UPLOAD_KEY]

    total_size = paper_crud.get_size_of_knowledge_base(db, user=user)
    total_size_allowed = limits[KB_SIZE_KEY]

    chat_credits_allowed = limits[CHAT_CREDITS_KEY]
    chat_credits_used = get_user_chat_credits_used_today(db, user)

    audio_overviews_allowed = limits[AUDIO_OVERVIEWS_KEY]
    audio_overviews_used_this_month = get_user_audio_overviews_used_this_month(db, user)

    chat_credits_remaining = (
        None
        if chat_credits_allowed == float("inf")
        else max(0, int(chat_credits_allowed) - chat_credits_used)
    )

    audio_overviews_remaining = (
        None
        if audio_overviews_allowed == float("inf")
        else max(0, int(audio_overviews_allowed) - audio_overviews_used_this_month)
    )

    # Handle unlimited plans
    papers_remaining = (
        None
        if paper_limit == float("inf")
        else max(0, int(paper_limit) - current_paper_count)
    )

    knowledge_base_remaining = (
        None
        if total_size_allowed == float("inf")
        else max(0, int(total_size_allowed) - total_size)
    )

    return {
        "plan": plan.value,
        "limits": {
            **limits,
        },
        "usage": {
            "paper_uploads": current_paper_count,
            "paper_uploads_remaining": papers_remaining,
            "knowledge_base_size": total_size,
            "knowledge_base_size_remaining": knowledge_base_remaining,
            "chat_credits_used": chat_credits_used,
            "chat_credits_remaining": chat_credits_remaining,
            "audio_overviews_used": audio_overviews_used_this_month,
            "audio_overviews_remaining": audio_overviews_remaining,
        },
    }
