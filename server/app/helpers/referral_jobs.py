"""Client for scheduling the delayed referral-settlement callback on the jobs service."""

import logging
from datetime import datetime, timezone
from typing import Optional

from app.helpers.celery_config import get_celery_broker_url, get_webhook_base_url
from celery import Celery
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)


def schedule_referral_settlement(
    referral_id: str,
    eta: datetime,
    *,
    webhook_base_url: Optional[str] = None,
    celery_broker_url: Optional[str] = None,
) -> Optional[str]:
    """
    Submit a delayed callback task that fires at `eta` and POSTs to the
    settlement webhook on the server. Returns the Celery task id, or None if
    the broker submission failed (the caller decides whether to surface that).
    """
    webhook_base_url = get_webhook_base_url(webhook_base_url)
    celery_broker_url = get_celery_broker_url(celery_broker_url)

    try:
        celery_app = Celery("openpaper_tasks", broker=celery_broker_url)
        celery_app.conf.update(
            broker_connection_retry_on_startup=True,
            broker_connection_retry=True,
            broker_connection_max_retries=3,
            task_serializer="json",
            accept_content=["json"],
            result_serializer="json",
            task_always_eager=False,
        )

        webhook_url = (
            f"{webhook_base_url}/api/webhooks/internal/referral-settle/{referral_id}"
        )

        task = celery_app.send_task(
            "delayed_referral_settlement_callback",
            kwargs={"webhook_url": webhook_url},
            eta=eta,
            # Explicit: the server's Celery instance has no task_routes, so we
            # must pin the queue here. Must match what the worker's `-Q` set
            # contains (see jobs/scripts/start_worker.sh).
            queue="user_processing",
        )
        seconds_until = (eta - datetime.now(timezone.utc)).total_seconds()
        logger.info(
            f"Scheduled referral settlement: referral={referral_id} task={task.id} "
            f"eta={eta.isoformat()} (in {seconds_until:.0f}s)"
        )
        return task.id
    except Exception as e:
        logger.error(
            f"Failed to schedule referral settlement for {referral_id}: {e}",
            exc_info=True,
        )
        return None
