import os

from app.database.crud.subscription_crud import subscription_crud
from app.database.database import get_db
from posthog import Posthog

POSTHOG_API_KEY = os.getenv("POSTHOG_API_KEY", None)
DEBUG = os.getenv("DEBUG", "False").lower() in ("true", "1", "t")

posthog = Posthog(
    POSTHOG_API_KEY,
    host="https://us.i.posthog.com",
    enable_exception_autocapture=True,
)

posthog_sync = Posthog(
    POSTHOG_API_KEY,
    host="https://us.i.posthog.com",
    sync_mode=True,
    enable_exception_autocapture=True,
)

if DEBUG:
    posthog.debug = True


def track_event(event_name, properties={}, user_id=None, sync=False):
    """
    Track an event with PostHog.

    :param event_name: Name of the event to track.
    :param properties: Optional dictionary of properties to associate with the event.
    """
    if POSTHOG_API_KEY and not DEBUG:
        subscription = None
        if user_id is None:
            user_id = "anonymous"
        else:
            db = next(get_db())
            subscription = subscription_crud.get_by_user_id(db, user_id=user_id)

            if subscription:
                properties.update(
                    {
                        "subscription_plan": subscription.plan,
                        "subscription_status": subscription.status,
                    }
                )
            else:
                properties.update(
                    {
                        "subscription_plan": None,
                        "subscription_status": None,
                    }
                )

        if sync:
            posthog_sync.capture(
                distinct_id=user_id, event=event_name, properties=properties
            )
        else:
            posthog.capture(
                distinct_id=user_id, event=event_name, properties=properties
            )
    else:
        print(
            f"PostHog tracking disabled. Event: {event_name}, Properties: {properties}"
        )
