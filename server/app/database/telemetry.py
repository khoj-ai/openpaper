import logging
import os
import uuid
from typing import Optional

from app.database.crud.subscription_crud import subscription_crud
from app.database.database import SessionLocal
from posthog import Posthog
from sqlalchemy.exc import InvalidRequestError, OperationalError
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

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


def _lookup_subscription(db: Optional[Session], user_id: str):
    """
    Look up a user's subscription for event enrichment.

    Prefer the request-scoped session when available so we don't check out an
    extra connection per event. If it's been closed or left in a bad state
    (PendingRollbackError, ResourceClosedError, and similar all subclass
    InvalidRequestError), silently fall back to a fresh session — telemetry
    should never take down the caller's flow.
    """
    try:
        user_uuid = uuid.UUID(user_id)
    except (ValueError, TypeError):
        return None

    if db is not None:
        try:
            return subscription_crud.get_by_user_id(db, user_id=user_uuid)
        except (InvalidRequestError, OperationalError) as e:
            logger.warning(
                "track_event: provided db session unusable (%s); falling back",
                type(e).__name__,
            )

    try:
        with SessionLocal() as fresh_db:
            return subscription_crud.get_by_user_id(fresh_db, user_id=user_uuid)
    except Exception as e:
        logger.warning("track_event: subscription lookup failed: %s", e)
        return None


def track_event(
    event_name,
    properties={},
    user_id=None,
    sync=False,
    db: Optional[Session] = None,
):
    """
    Track an event with PostHog.

    :param event_name: Name of the event to track.
    :param properties: Optional dictionary of properties to associate with the event.
    :param user_id: User ID to associate with the event, or None for anonymous.
    :param sync: If True, send the event synchronously (blocks until sent).
    :param db: Optional request-scoped session to reuse for the subscription
               lookup. Falls back to a fresh session if None or unusable.
    """
    if POSTHOG_API_KEY and not DEBUG:
        subscription = None
        if user_id is None:
            user_id = "anonymous"
        else:
            subscription = _lookup_subscription(db, str(user_id))

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
