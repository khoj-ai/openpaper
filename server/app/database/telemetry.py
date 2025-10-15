import os

from posthog import Posthog

POSTHOG_API_KEY = os.getenv("POSTHOG_API_KEY", None)
DEBUG = os.getenv("DEBUG", "False").lower() in ("true", "1", "t")

posthog = Posthog(
    POSTHOG_API_KEY,
    host="https://us.i.posthog.com",
    exception_autocapture_integrations=True,
)

posthog_sync = Posthog(
    POSTHOG_API_KEY,
    host="https://us.i.posthog.com",
    sync_mode=True,
    exception_autocapture_integrations=True,
)

if DEBUG:
    posthog.debug = True


def track_event(event_name, properties=None, user_id=None, sync=False):
    """
    Track an event with PostHog.

    :param event_name: Name of the event to track.
    :param properties: Optional dictionary of properties to associate with the event.
    """
    if POSTHOG_API_KEY and not DEBUG:
        if user_id is None:
            user_id = "anonymous"

        if sync:
            posthog_sync.capture(
                distinct_id=user_id, event=event_name, properties=properties or {}
            )
        else:
            posthog.capture(
                distinct_id=user_id, event=event_name, properties=properties or {}
            )
    else:
        print(
            f"PostHog tracking disabled. Event: {event_name}, Properties: {properties}"
        )
