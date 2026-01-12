#!/bin/bash
# Install Dependencies in virtual environment
set -e
uv sync
source .venv/bin/activate

# Run Migration
python3 app/scripts/run_migrations.py

# Start the Application
python3 -m app.main
