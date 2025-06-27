#!/bin/bash

# Health check script for Celery workers
# This script can be used by container orchestrators like ECS/Kubernetes

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Run the Python health check script
python3 "$SCRIPT_DIR/health_check.py"
