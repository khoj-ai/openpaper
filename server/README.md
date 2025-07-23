# Server

This server manages the backend for the Open Paper project, which allows users to upload, chat with, annotate, and manage research papers in one place.

## Prerequisites
- Python 3.12 or higher
- PostgreSQL database

## Setup

1. Create a virtual environment (optional but recommended). I'm using [uv](https://docs.astral.sh/uv/getting-started/installation/), but you can use any virtual environment tool you prefer:
```bash
uv venv --python 3.12
source .venv/bin/activate
```

2. Install dependencies:
```bash
uv pip install -r pyproject.toml
```

3. Get an API key from [Google AI Studio](https://aistudio.google.com/apikey)

4. Set up environment variables:
```bash
touch .env
```

Add the following environment variables to your `.env` file:
```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/annotated-paper
GEMINI_API_KEY="your_gemini_api_key" # Replace with your actual API key from step 3
```

## Running the Application

To run the application:

1. Setup the DB:

```bash
python3 app/scripts/run_migrations.py
```

2. Start the server:

```bash
python3 -m app.main
```

## API Documentation

FastAPI automatically generates API documentation. Once the application is running, you can access:

- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

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

## Chat with Knowledge Base

We have an `Ask` page, which allows you to ask questions across your entire knowledge base. AI-generated responses come with inline citations which will link to the original papers and show the text citation. Deep-linking is not yet available, but is planned.

The response agent works by sending off an agent with access to a series of research tools:
- `read_file`
- `search_file`
- `view_file`
- `read_abstract`
- `search_all_files`

![knowledge base research diagram](./lr_research_diagram.png)
