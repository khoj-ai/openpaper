#!/bin/bash
# Setup dependencies in a virtual environment.
uv sync
source .venv/bin/activate

# Start RabbitMQ and Redis services using Docker. Start existing containers or create new ones.
docker start op-rabbitmq 2>/dev/null || docker run -d --name op-rabbitmq -p 5672:5672 rabbitmq
docker start op-redis 2>/dev/null || docker run -d --name op-redis -p 6379:6379 redis

# Start Celery worker
./scripts/start_worker.sh &

# Start worker API
./scripts/start_api.sh
