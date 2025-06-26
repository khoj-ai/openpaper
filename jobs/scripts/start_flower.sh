#!/bin/bash

# Start Flower monitoring dashboard
echo "Starting Flower dashboard..."
source .venv/bin/activate
python -m celery --app src.celery_app flower --port=5555
