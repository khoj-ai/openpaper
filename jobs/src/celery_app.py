"""
Celery application configuration and setup.
"""
import os
import ssl
from dotenv import load_dotenv
from celery import Celery # type: ignore


BROKER_URL = os.getenv("CELERY_BROKER_URL", "pyamqp://guest@localhost:5672//")
BACKEND_URL = os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/0")

# Create Celery instance
celery_app = Celery(
    "openpaper_tasks",
    broker=BROKER_URL,
    backend=BACKEND_URL,
    include=["src.tasks"]
)

transport_options = {}

if BACKEND_URL.startswith("rediss://"):
    transport_options.update({
        "ssl_cert_reqs": ssl.CERT_REQUIRED
    })

load_dotenv()  # Load environment variables from .env file

# Celery configuration
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    result_backend_transport_options=transport_options,
    timezone="UTC",
    enable_utc=True,
    result_expires=3600,  # Results expire after 1 hour
    task_routes={
        "upload_and_process_file": {"queue": "pdf_processing"}
    },
    worker_prefetch_multiplier=1,  # Process one task at a time
    task_acks_late=True,
    worker_max_tasks_per_child=1000,
)

celery_app.autodiscover_tasks()

if __name__ == "__main__":
    celery_app.start()
