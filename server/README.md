# Server

This server manages the backend for the Open Paper project, which allows users to upload, chat with, annotate, and manage research papers in one place.

## Prerequisites
- Python 3.12 or higher
- [Uv](https://docs.astral.sh/uv/getting-started/installation/)
- [PostgreSQL database](http://postgresql.org/download/) (Make sure it's running with a user postgres)

## Setup

1. Install dependencies
```bash
uv sync
source .venv/bin/activate
```

2. Get an API key from [Google AI Studio](https://aistudio.google.com/apikey)

3. Set up environment variables. Check `.env.example` for required and optional variables
```bash
touch .env
```

Add the following environment variables to your `.env` file:
```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/annotated-paper
GEMINI_API_KEY="your_gemini_api_key" # Replace with your actual API key from step 3
```

## Start the Application

Run the command below to install dependencies, run db migrations and start the app:
```bash
uv run start
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

Multi-paper chat workflow:

```
+----------------+      +-------------------------------------------------+    +-------------------+
|      User      |----->|             FastAPI Server                    |----->|        LLM        |
+----------------+      |       (multi_paper_operations.py)             |      +-------------------+
        ^             |                                                 |              ^
        |             |  1. gather_evidence(question)                   |              |
        |             |     - Iteratively calls LLM with tools:         |              |
        |             |       - search_all_files(query)                 |--------------+
        |             |       - read_file(paper_id, query)              |
        |             |       - ...                                     |
        |             |     - Compacts evidence if it gets too large    |
        |             |                                                 |
        |             |  2. chat_with_papers(question, evidence)        |
        |             |     - Sends evidence and question to LLM        |--------------+
        |             |     - Streams response back to user             |              |
        |             |     - Parses citations from response            |              |
        |             +-------------------------------------------------+              |
        |                           |                                                  |
        +---------------------------+--------------------------------------------------+
                              (Streamed response with citations)
```
