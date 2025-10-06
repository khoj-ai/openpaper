"""
Refactored subscription interval change using Stripe Subscription Schedules

This demonstrates the proper approach to handle interval changes without double charging.
The key changes from the original implementation:

1. Use Subscription Schedules instead of direct subscription modification
2. Create a schedule that handles the transition at period end
3. Add webhook handlers for schedule events
4. Handle edge cases with existing schedules
"""

from datetime import datetime
from typing import Optional

import stripe


def get_existing_schedule_for_subscription(
    subscription_id: str, customer: str
) -> Optional[stripe.SubscriptionSchedule]:
    """
    Check if there's an existing active subscription schedule for the given subscription.
    Returns the schedule if found, None otherwise.
    """
    try:
        schedules = stripe.SubscriptionSchedule.list(limit=10, customer=customer)

        # Filter for schedules that match our subscription
        for schedule in schedules.data:
            if (
                hasattr(schedule, "subscription")
                and schedule.subscription == subscription_id
                and schedule.status in ["active", "not_started"]
            ):
                return schedule

        return None
    except Exception as e:
        print(f"Error checking for existing schedules: {e}")
        return None


def cancel_existing_schedule(subscription_id: str, customer: str) -> bool:
    """
    Cancel any existing active subscription schedule for the given subscription.
    Returns True if successful or no schedule existed, False on error.
    """
    try:
        existing_schedule = get_existing_schedule_for_subscription(
            subscription_id, customer=customer
        )
        if existing_schedule:
            stripe.SubscriptionSchedule.cancel(existing_schedule.id)
            print(
                f"Canceled existing schedule {existing_schedule.id} for subscription {subscription_id}"
            )
        return True
    except Exception as e:
        print(f"Error canceling existing schedule: {e}")
        return False


def change_subscription_interval_with_schedule(
    subscription_id: str,
    new_price_id: str,
    current_price_id: str,
    user_id: str,
    customer_id: str,
):
    """
    Change subscription interval using Subscription Schedules to avoid double charging.

    This function:
    1. Checks for existing subscription schedules
    2. If found, modifies the existing schedule (preserving completed phases, updating future phases)
    3. If not found, creates a new schedule
    4. Ensures the interval change happens at the end of the current billing period
    """

    # Get current subscription details
    stripe_sub = stripe.Subscription.retrieve(subscription_id)

    # Get current_period_end from the first subscription item
    if (
        not stripe_sub.get("items")
        or not stripe_sub["items"].get("data")
        or len(stripe_sub["items"]["data"]) == 0
    ):
        raise Exception("Unable to retrieve subscription items")

    first_item = stripe_sub["items"]["data"][0]
    current_period_end = first_item.get("current_period_end")

    # Check for existing schedule
    existing_schedule = get_existing_schedule_for_subscription(
        subscription_id, customer_id
    )

    if existing_schedule:
        print(
            f"Found existing schedule {existing_schedule.id}, modifying it instead of creating new one"
        )

        # Get existing phases and preserve completed ones
        existing_phases = existing_schedule.get("phases", [])
        new_phases = []
        current_time = datetime.now().timestamp()

        # Preserve all completed phases and current phase, but update future phases
        for i, phase in enumerate(existing_phases):
            phase_start = phase.get("start_date")
            phase_end = phase.get("end_date")

            # If this phase has already started (current or completed), keep it as-is
            if phase_start and phase_start <= current_time:
                # If this is the current phase, make sure it ends at current_period_end
                if phase_end is None or phase_end > current_time:
                    # This is the current active phase - update its end date to current_period_end
                    phase_copy = dict(phase)
                    phase_copy["end_date"] = current_period_end
                    new_phases.append(phase_copy)
                else:
                    # This is a completed phase - keep as-is
                    new_phases.append(phase)
            # Skip future phases - we'll replace them with our new interval change

        # Add the new interval phase after the current period ends
        new_phases.append(
            {
                "items": [
                    {
                        "price": new_price_id,
                        "quantity": 1,
                    }
                ],
                "iterations": 1,  # Just one billing cycle, then release
            }
        )

        # Modify the existing schedule
        schedule = stripe.SubscriptionSchedule.modify(
            existing_schedule.id,
            end_behavior="release",  # Release subscription to continue normally after schedule
            phases=new_phases,
            metadata={
                "user_id": user_id,
                "old_price_id": current_price_id,
                "new_price_id": new_price_id,
                "change_type": "interval_change",
                "modified_at": str(datetime.now().timestamp()),
            },
        )

        effective_date = datetime.fromtimestamp(current_period_end)
        print(f"Modified existing schedule {schedule.id} for interval change")

    else:
        print(f"No existing schedule found, creating new one from subscription")

        # Create a new schedule from the existing subscription
        schedule = stripe.SubscriptionSchedule.create(
            from_subscription=subscription_id,
        )

        # Get phases from the newly created schedule
        phases = schedule.phases
        current_phase = phases[0]

        # Convert the items from the current phase to the format required for modification
        current_phase_items_for_modify = []
        for item in current_phase.items:
            current_phase_items_for_modify.append(
                {"price": item.price, "quantity": item.quantity}
            )

        # Update the schedule with two phases:
        # Phase 1: Continue current subscription until period end
        # Phase 2: Switch to new price for one billing cycle, then release
        schedule = stripe.SubscriptionSchedule.modify(
            schedule.id,
            end_behavior="release",  # Release subscription to continue normally after schedule
            phases=[
                {
                    # Phase 1: Explicitly define the current phase
                    "items": current_phase_items_for_modify,
                    "start_date": current_phase.start_date,
                    "end_date": current_phase.end_date,
                },
                {
                    # Phase 2: New interval starting at the end of the current phase
                    "items": [
                        {
                            "price": new_price_id,
                            "quantity": 1,
                        }
                    ],
                    "iterations": 1,  # Just one billing cycle, then release
                },
            ],
            metadata={
                "user_id": user_id,
                "old_price_id": current_price_id,
                "new_price_id": new_price_id,
                "change_type": "interval_change",
            },
        )

        effective_date = datetime.fromtimestamp(current_period_end)
        print(f"Created new schedule {schedule.id} for interval change")

    return {
        "schedule_id": schedule.id,
        "effective_date": effective_date,
        "status": "scheduled",
    }
