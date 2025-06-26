#!/bin/bash

# Start Celery worker
echo "Starting Celery worker..."
source .venv/bin/activate
python -m celery --app src.celery_app worker --loglevel=info --queues=pdf_processing --concurrency=1
