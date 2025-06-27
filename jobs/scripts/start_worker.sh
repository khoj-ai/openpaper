#!/bin/bash

# Start Celery worker with health monitoring
echo "Starting Celery worker..."
source .venv/bin/activate

# Set worker configuration
export CELERY_WORKER_AUTOSCALE="4,1"  # Max 4 concurrent tasks, min 1
export CELERY_WORKER_MAX_MEMORY_PER_CHILD="500000"  # 500MB

# Start worker with additional flags
python -m celery --app src.celery_app worker \
    --loglevel=info \
    --concurrency=2 \
    --max-tasks-per-child=1000 \
    --without-gossip \
    --without-mingle \
    --without-heartbeat \
    --time-limit=300 \
    --soft-time-limit=240
