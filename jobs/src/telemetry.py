import os
import logging
import atexit
from posthog import Posthog

POSTHOG_API_KEY = os.getenv("POSTHOG_API_KEY", '')
DEBUG = os.getenv("DEBUG", "False").lower() in ("true", "1", "t")

# Unfortunately we have to use sync_mode here because PostHog's async mode is not compatible with our Celery setup. See also: https://github.com/PostHog/posthog-python/issues/79
posthog = Posthog(POSTHOG_API_KEY, host="https://us.i.posthog.com", sync_mode=True)

logger = logging.getLogger(__name__)

if DEBUG:
    posthog.debug = True

# Ensure PostHog shuts down properly on exit
atexit.register(lambda: posthog.shutdown())

def track_event(event_name, distinct_id="celery", properties=None):
    if POSTHOG_API_KEY and not DEBUG:
        try:
            logger.info(f"Sending event: {event_name} for {distinct_id}")
            posthog.capture(
                distinct_id=distinct_id, event=event_name, properties=properties or {}
            )
            logger.info("Event sent successfully")
        except Exception as e:
            logger.error(f"Error sending to PostHog: {e}")
    else:
        logger.info(f"PostHog tracking disabled. Event: {event_name}, Properties: {properties}")
