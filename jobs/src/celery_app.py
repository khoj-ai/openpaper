"""
Celery application configuration and setup.
"""
import os
from dotenv import load_dotenv
from celery import Celery # type: ignore

load_dotenv()  # Load environment variables from .env file

BROKER_URL = os.getenv("CELERY_BROKER_URL", "pyamqp://guest@localhost:5672//")
BACKEND_URL = os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/0")

# Create Celery instance
celery_app = Celery(
    "openpaper_tasks",
    broker=BROKER_URL,
    backend=BACKEND_URL,
    include=["src.tasks"]
)

# Celery configuration
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    result_expires=3600,  # Results expire after 1 hour
    task_routes={
        "upload_and_process_file": {"queue": "pdf_processing"}
    },
    worker_prefetch_multiplier=1,  # Process one task at a time
    task_acks_late=True,
    reject_on_worker_lost=True,
    task_acks_on_failure_or_timeout=True,
    worker_max_tasks_per_child=1000,
    # Health monitoring settings
    worker_send_task_events=True,
    task_send_sent_event=True,
    worker_hijack_root_logger=False,
    worker_log_color=False,
    # Worker heartbeat and timeout settings
    broker_heartbeat=30,
    broker_heartbeat_checkrate=2.0,
    worker_disable_rate_limits=True,
    # Memory and resource limits
    worker_max_memory_per_child=500000,  # 500MB in KB
)

celery_app.autodiscover_tasks()

if __name__ == "__main__":
    celery_app.start()
