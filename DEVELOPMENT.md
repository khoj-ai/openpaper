# Development Setup

This project consists of three main components: a `server`, a `client`, and a `jobs` service. Each has its own setup instructions.

## Docker Compose

For local development, you can now run the full stack with Docker Compose:

```bash
docker compose up --build
```

This starts:

- `client` on `http://localhost:3000`
- `server` on `http://localhost:8000`
- `jobs-api` on `http://localhost:8001`
- `postgres`, `redis`, and `rabbitmq`

Set provider credentials in your shell or a local `.env` before starting Compose. Use `LLM_DEFAULT_PROVIDER` to choose the active provider for the jobs service and the server default fallback.
Built-in providers remain manually selectable in chat. Custom OpenAI-compatible providers defined in `config/llm.yaml` are available for backend routing and defaults, but are not exposed in the current chat model picker.

## 1. Clone the Repository

First, clone the project repository:

```bash
git clone git@github.com:sabaimran/openpaper.git
cd openpaper
```

## 2. Set Up the Backend Server

The backend server is a Python application that manages data and communicates with the other services.

Detailed instructions can be found in the [server/README.md](./server/README.md).

**Quick Start:**
1.  Navigate to the `server` directory: `cd server`
2.  Create and activate virtual environment:
    ```bash
    uv venv
    source .venv/bin/activate
    ```
3.  Install dependencies: `uv pip install -r pyproject.toml`
3.  Set up your `.env` file with database and API keys.
4.  Run database migrations: `python3 app/scripts/run_migrations.py`
5.  Start the server: `python3 -m app.main`

## 3. Set Up the Frontend Client

The frontend is a Next.js web application.

Detailed instructions can be found in the [client/README.md](./client/README.md).

**Quick Start:**
1.  Navigate to the `client` directory: `cd client`
2.  Install dependencies: `yarn`
3.  Run the development server: `yarn dev`

## 4. Set Up the Asynchronous Jobs Service

The jobs service handles long-running tasks like PDF processing.

Detailed instructions can be found in the [jobs/README.md](./jobs/README.md).

**Quick Start:**
1.  Navigate to the `jobs` directory: `cd jobs`
2.  Create and activate virtual environment:
    ```bash
    uv venv
    source .venv/bin/activate
    ```
3.  Install dependencies: `uv install`
3.  Start RabbitMQ and Redis (e.g., using Docker).
4.  Start the Celery worker: `./scripts/start_worker.sh`
