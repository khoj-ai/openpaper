# FastAPI Application

This is a basic FastAPI application with a health checkpoint endpoint.

## Setup

1. Create a virtual environment (optional but recommended):
```bash
uv venv --python 3.12
source .venv/bin/activate  # On Windows, use `venv\Scripts\activate`
```

2. Install dependencies:
```bash
uv pip install -r pyproject.toml
```

## Running the Application

To run the application:

```bash
uvicorn api:app --reload

# or

python3 -m app.main
```

The application will start on `http://localhost:8000`

## Available Endpoints

- Health Check: `GET /health`
  - Returns the health status of the application

## API Documentation

FastAPI automatically generates API documentation. Once the application is running, you can access:

- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

# Database

We're using a PostgreSQL database with SQLAlchemy ORM.
Make sure to set the `DATABASE_URL` environment variable to your PostgreSQL connection string.

# Migrations

This project uses Alembic for database migrations. To create a new migration, run:

```bash
alembic revision --autogenerate -m "migration message"
```
To apply the migration, run:

```bash
alembic upgrade head
```
To downgrade the migration, run:

```bash
alembic downgrade -1
```
