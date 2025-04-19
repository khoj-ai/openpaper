FROM python:3.12-slim-bookworm

WORKDIR /app

COPY pyproject.toml ./
COPY app ./app
COPY migrations .//migrations
COPY alembic.ini ./
COPY app/scripts/run_migrations.py ./app/scripts/run_migrations.py

RUN pip install uv
RUN uv pip install --system -r pyproject.toml

CMD ["gunicorn", "-c", "gunicorn.config.py", "app.main:app"]
