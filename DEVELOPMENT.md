# Development Setup

Three services run locally: **server** (API), **client** (Next.js), and **jobs** (Celery). More detail: [server/README.md](./server/README.md), [client/README.md](./client/README.md), [jobs/README.md](./jobs/README.md).

## Prerequisites

Python 3.12+ with [uv](https://docs.astral.sh/uv/), Node.js + Yarn, PostgreSQL, and Docker (RabbitMQ + Redis for jobs).

## Ports

| Service           | Port        | Start                            |
| ----------------- | ----------- | -------------------------------- |
| Client            | 3000        | `yarn dev` in `client/`          |
| Server            | 8000        | `uv run start` in `server/`      |
| Jobs API          | 8001        | `uv run start` in `jobs/`        |
| RabbitMQ / Redis  | 5672 / 6379 | Docker via `jobs` `uv run start` |
| Flower (optional) | 5555        | `jobs/./scripts/start_flower.sh` |

## Environment files

| File                | Notes                                             |
| ------------------- | ------------------------------------------------- |
| `server/.env`       | Copy [server/.env.example](./server/.env.example) |
| `jobs/.env`         | Same broker, S3, and LLM keys as server           |
| `client/.env.local` | `NEXT_PUBLIC_API_URL=http://localhost:8000`       |

**Must match across server and jobs:** `CELERY_BROKER_URL`, S3/AWS bucket vars, `JOBS_INTERNAL_SECRET` (Zotero auto-sync). Server needs `CELERY_API_URL=http://localhost:8001`; jobs needs `WEBHOOK_BASE_URL=http://localhost:8000`.

### Required for a minimal local stack

| Variable                                                                                 | Where                                                     |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `DATABASE_URL`                                                                           | server                                                    |
| `GEMINI_API_KEY`                                                                         | server + jobs                                             |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET_NAME`, `CLOUDFLARE_BUCKET_NAME` | server + jobs                                             |
| `CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND`                                             | server + jobs                                             |
| `CELERY_API_URL`                                                                         | server                                                    |
| `WEBHOOK_BASE_URL`                                                                       | jobs                                                      |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`                        | server                                                    |
| `CLIENT_DOMAIN`, `API_DOMAIN`                                                            | server (`http://localhost:3000`, `http://localhost:8000`) |
| `NEXT_PUBLIC_API_URL`                                                                    | client                                                    |

Optional (Zotero, Stripe, Discover, audio, email, PostHog, admin, etc.) are documented in `server/.env.example`.

**Jobs tip:** set `ZOTERO_SYNC_INTERVAL_SECONDS=60` in `jobs/.env` when testing Celery Beat locally.

## First-time setup

```bash
git clone git@github.com:khoj-ai/openpaper.git && cd openpaper

# Server
cd server && uv sync && cp .env.example .env
# fill .env, then:
python3 app/scripts/run_migrations.py

# Jobs
cd ../jobs && uv sync

# Client
cd ../client && yarn
```

## Start locally (daily)

Use separate terminals, in this order:

| #   | Directory | Command                                                                                  |
| --- | --------- | ---------------------------------------------------------------------------------------- |
| 1   | `jobs/`   | `uv run start` — Docker RabbitMQ/Redis, Celery worker, Celery Beat (Zotero sync), jobs API |
| 2   | `server/` | `uv run start` — migrations + API                                                        |
| 3   | `client/` | `yarn dev`                                                                               |

Check: [localhost:8000/docs](http://localhost:8000/docs), [localhost:3000](http://localhost:3000), worker log shows `celery@... ready`.
