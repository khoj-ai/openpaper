#!/bin/bash

# Start Celery Beat scheduler for periodic tasks (e.g. Zotero auto-sync).
# Run this as a single separate process - do NOT run multiple instances.
echo "Starting Celery Beat scheduler..."
source .venv/bin/activate

python -m celery --app src.celery_app beat --loglevel=info
