import logging
import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Optional

from app.database.crud.subscription_crud import subscription_crud
from app.database.database import SessionLocal
from posthog import Posthog

logger = logging.getLogger(__name__)

POSTHOG_API_KEY = os.getenv("POSTHOG_API_KEY", None)
DEBUG = os.getenv("DEBUG", "False").lower() in ("true", "1", "t")

posthog = Posthog(
    POSTHOG_API_KEY,
    host="https://us.i.posthog.com",
    enable_exception_autocapture=True,
)

if DEBUG:
    posthog.debug = True

# Events are enriched with a database lookup, which would otherwise block the
# caller, often an event loop. One thread keeps events in order and holds at
# most one connection.
_sender = ThreadPoolExecutor(max_workers=1, thread_name_prefix="telemetry")


def _subscription_properties(user_id: str) -> dict[str, Any]:
    subscription = None
    try:
        user_uuid = uuid.UUID(user_id)
        with SessionLocal() as db:
            subscription = subscription_crud.get_by_user_id(db, user_id=user_uuid)
    except ValueError:
        pass
    except Exception as e:
        logger.warning("track_event: subscription lookup failed: %s", e)
    return {
        "subscription_plan": subscription.plan if subscription else None,
        "subscription_status": subscription.status if subscription else None,
    }


def _send(event_name: str, properties: dict[str, Any], user_id: Optional[str]) -> None:
    try:
        if user_id is not None:
            properties.update(_subscription_properties(user_id))
        posthog.capture(
            distinct_id=user_id or "anonymous",
            event=event_name,
            properties=properties,
        )
    except Exception as e:
        logger.warning("track_event: failed to send %s: %s", event_name, e)


def track_event(
    event_name: str,
    properties: Optional[dict[str, Any]] = None,
    user_id: Any = None,
) -> None:
    """
    Track an event with PostHog, tagged with the user's subscription.

    Returns at once, as the event is sent from a background thread, and never
    raises, so telemetry can't fail the work it records.

    :param event_name: Name of the event to track.
    :param properties: Optional dictionary of properties to associate with the event.
    :param user_id: User ID to associate with the event, or None for anonymous.
    """
    properties = dict(properties or {})
    if POSTHOG_API_KEY and not DEBUG:
        try:
            _sender.submit(
                _send, event_name, properties, None if user_id is None else str(user_id)
            )
        except RuntimeError:
            # The process is exiting and the sender no longer takes events.
            logger.warning("track_event: dropped %s during shutdown", event_name)
    else:
        print(
            f"PostHog tracking disabled. Event: {event_name}, Properties: {properties}"
        )
