#!/bin/bash

# Start Celery worker
echo "Starting Celery worker..."
python -m celery --app src.celery_app worker --loglevel=info --queues=pdf_processing --concurrency=1
