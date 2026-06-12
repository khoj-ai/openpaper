"""Shared connection defaults for the Celery jobs service.

The server submits tasks to the jobs worker from a few places (PDF processing,
referral settlement), all of which need the same broker / webhook / status-API
endpoints. Keeping the defaults here avoids drift between those call sites.

The broker default points at RabbitMQ, which is what the jobs worker consumes
from (see ``jobs/src/celery_app.py``). Override any of these via the matching
environment variable in deployed environments.
"""

import os

DEFAULT_CELERY_BROKER_URL = "pyamqp://guest@localhost:5672//"
DEFAULT_WEBHOOK_BASE_URL = "http://localhost:8000"
DEFAULT_CELERY_API_URL = "http://localhost:8001"


def get_celery_broker_url(override: str | None = None) -> str:
    """Resolve the Celery broker URL (explicit override > env var > default)."""
    return override or os.getenv("CELERY_BROKER_URL", DEFAULT_CELERY_BROKER_URL)


def get_webhook_base_url(override: str | None = None) -> str:
    """Resolve the base URL the jobs worker calls back for webhooks."""
    return override or os.getenv("WEBHOOK_BASE_URL", DEFAULT_WEBHOOK_BASE_URL)


def get_celery_api_url(override: str | None = None) -> str:
    """Resolve the base URL of the Celery status API service."""
    return override or os.getenv("CELERY_API_URL", DEFAULT_CELERY_API_URL)
