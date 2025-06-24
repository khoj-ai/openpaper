#!/bin/bash

# Start FastAPI application
echo "Starting FastAPI application..."
python -m uvicorn src.app:app --host 0.0.0.0 --port 8001 --reload --log-level info
