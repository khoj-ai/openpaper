#!/bin/bash

# Health check script for Celery workers in ECS
# This script returns the correct exit code expected by ECS health checks:
# - Exit code 0: Container is healthy
# - Exit code 1: Container is unhealthy

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "[$(date)] Running worker health check from $SCRIPT_DIR..."

# Set PYTHONPATH to include project directory
export PYTHONPATH=$PROJECT_DIR:$PYTHONPATH

# Run the Python health check script and capture the exit code
# Redirect stderr to stdout to ensure all logs are captured
python3 "$SCRIPT_DIR/health_check.py" 2>&1
EXIT_CODE=$?

# Return the appropriate exit code for ECS health check
if [ $EXIT_CODE -eq 0 ]; then
    echo "[$(date)] Health check passed"
    exit 0
else
    echo "[$(date)] Health check failed with exit code $EXIT_CODE"
    exit 1
fi
