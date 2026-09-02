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

**Must match across server and jobs:** `CELERY_BROKER_URL`, S3/AWS bucket vars, `JOBS_INTERNAL_SECRET` (Zotero auto-sync). Server needs `CELERY_API_URL=http://localhost:8001`. `WEBHOOK_BASE_URL=http://localhost:8000` is needed by **both**: the server builds the callback URL it hands to each Celery task, and jobs uses it for the periodic Zotero sync. Unset on the server, paper ingestion silently never completes — the worker finishes extraction, then fails the callback.

### Required for a minimal local stack

| Variable                                                                                 | Where                                                     |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `DATABASE_URL`                                                                           | server                                                    |
| `GEMINI_API_KEY`                                                                         | server + jobs                                             |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET_NAME`, `CLOUDFLARE_BUCKET_NAME` | server + jobs                                             |
| `CELERY_BROKER_URL`                                                                      | server + jobs                                             |
| `CELERY_RESULT_BACKEND`                                                                  | jobs only — the server has no `redis` package, and setting it there makes every task submission fail with `No module named 'redis'` |
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

## Containerized stack (for agents, and for a disposable environment)

`docker-compose.dev.yml` runs the whole stack in containers on ports offset from
the ones above **and on `127.0.0.1` rather than `localhost`**, so it can run
*alongside* the setup in this document rather than replacing it. The host split
matters: cookies ignore ports, so on a shared host the two stacks would share one
`session_token` — and since the server marks it httponly, the browser console
cannot replace it. Separate hosts, separate cookie jars. Use it when you want an environment you can freely migrate, wipe,
and reseed — an AI agent verifying a change, a risky migration, an eval run that
shouldn't touch your working data.

Drive it through `scripts/dev`, never raw `docker compose`: the port wiring lives
in that script and the compose defaults are only coherent when it sets them.

```bash
scripts/dev up         # build, start, and restore the fixture into an empty db
```

That is the whole first run. There is no snapshot step and no dependency on
anyone's local database.

| Service  | Containerized | Uncontainerized |
| -------- | ------------- | --------------- |
| Client   | 3100 (on `127.0.0.1`) | 3000 (on `localhost`) |
| Server   | 8100          | 8000            |
| Jobs API | 8101          | 8001            |
| Postgres | 5433          | 5432            |
| RabbitMQ | 5673 (UI 15673) | 5672          |
| Redis    | 6380          | 6379            |

`scripts/dev help` lists every subcommand. The ones that matter:

| Command | What it does |
| ------- | ------------ |
| `reset` | Destroy volumes, rebuild, restore the fixture — the full wipe |
| `session [user_id]` | Mint a session token, skipping OAuth |
| `sql "SELECT ..."` / `psql` | Query the containerized database |
| `login` | Sign in as the fixture user in a browser |
| `claim <google-email>` | Point the fixture user at your Google account |
| `seed` | Force-restore the fixture over a dirty database |
| `build-fixture` | Re-ingest the seed PDFs and refreeze the fixture (rare) |
| `migrate` | Run alembic migrations |
| `restart server` | Restart the API (it autoreloads on `server/app` edits, so this is only for env or dependency changes) |
| `rebuild <svc>` | After a `yarn.lock` or `uv.lock` change |

### The fixture

The stack ships with `docker/seed/fixture.dump`, committed to git. It is
**manufactured, not copied** — no real user data is involved:

```
server/evals/seed_data/*.pdf   11 papers, already in the repo
        │
        ├─ POST /api/paper/upload/  →  Celery  →  webhook     the real pipeline
        │  (passages, images, extracted metadata, summaries)
        │
        └─ pg_dump ──►  docker/seed/fixture.dump   committed
```

Because the papers go through the actual ingestion pipeline rather than a direct
CRUD insert, the fixture carries what the app really produces — so local search,
citations, and chart extraction have something to work with.

`scripts/dev up` restores it automatically whenever it finds an empty database,
which is what makes a fresh checkout immediately usable. Restoring is seconds
and costs nothing.

`scripts/dev build-fixture` regenerates it. That step *does* run the ingestion
pipeline for real — LLM calls, several minutes — which is exactly why the output
is frozen and committed instead of rebuilt on every reset. Run it when the seed
corpus changes or when the pipeline's output shape changes, and commit the
result.

The fixture contains two projects ("Chain of Thought Reasoning", "LLM Safety and
Behavior") and a fixture user with a fixed id, `11111111-1111-4111-8111-111111111111`
— the default for `scripts/dev session`.

One caveat: the PDFs themselves live in S3, uploaded during the build. The
fixture's paper rows reference those object keys, so opening a paper needs the
same S3 credentials in `server/.env` that the rest of the stack needs.

### Signing in

The fixture's papers and projects are all owned by one fixture user, so
authenticating as *anyone else* gets you a working login and an empty library.
Two ways in, neither of which puts anything in production code:

The fixture ships **no session rows** — a credential committed to git is still a
credential, harmless on a laptop but real the moment the fixture runs somewhere
reachable. `build-fixture` clears sessions immediately before freezing the dump,
so both ways in below mint their own.

**`scripts/dev login`** — prints a one-liner to paste into the browser console:

```js
document.cookie = "session_token=<minted>; path=/"; location.reload()
```

`httponly` only stops JavaScript from *reading* the cookie; one set this way is
still sent and accepted. Good for a quick look.

**`scripts/dev claim <your-google-email>`** — for actually working in the UI.
It moves only the email onto the fixture user. On your next Google sign-in the
provider-id lookup misses, `upsert_with_provider` falls back to matching on
email, and writes your real provider id onto the fixture user's existing row —
so the user id never changes and everything it owns stays owned. Because
browser OAuth needs the registered redirect URI, run on the standard ports:

```bash
CLIENT_PORT=3000 SERVER_PORT=8000 JOBS_PORT=8001 scripts/dev up
```

There is deliberately **no dev-login endpoint on the server**. An auth bypass
that ships in production code isn't worth saving a paste.

### Opening a PDF needs an allowlisted origin

The browser fetches paper PDFs directly from the storage bucket using a
presigned URL. That bucket's CORS rules list **exact origins including port** —
`https://openpaper.ai` and `http://localhost:3000`, nothing else. Any other
origin gets no `Access-Control-Allow-Origin` header, and the reader fails with
`Error loading PDF: NetworkError when attempting to fetch resource` while the
rest of the app works normally.

So on the default `127.0.0.1:3100` the reader does not work. Two ways out:

**Run on the allowlisted origin** (needs your own client on :3000 stopped):

```bash
DEV_HOST=localhost CLIENT_PORT=3000 scripts/dev up
```

**Or add a dev origin to the bucket CORS** — the durable fix, and an admin
action: the app's IAM user is correctly denied `s3:GetBucketCORS`.

```json
{
  "AllowedOrigins": ["http://127.0.0.1:3100"],
  "AllowedMethods": ["GET", "HEAD"],
  "AllowedHeaders": ["*"],
  "ExposeHeaders": ["Content-Length", "Content-Range", "Accept-Ranges"],
  "MaxAgeSeconds": 3000
}
```

`HEAD` and the range headers matter: PDF.js loads documents with range requests.

### What it shares, and what it doesn't

Secrets come from your existing `server/.env`, `jobs/.env`, and
`client/.env.local` — there is no second copy of the keys to keep in sync. Only
the values that must differ inside the container network are overridden
(database and broker hosts, `CELERY_API_URL`, `WEBHOOK_BASE_URL`, the
`CLIENT_DOMAIN`/`API_DOMAIN`/`NEXT_PUBLIC_API_URL` port trio, and
`LANGFUSE_TRACING_ENVIRONMENT=local-docker` so traces stay separable).

So the isolation is on **process, port, and database** — not on third-party
state. S3 uploads, LLM calls, and Stripe still hit the same buckets and accounts
your normal dev setup does.

Browser OAuth doesn't work on the offset ports, since the redirect URIs
registered with Google and Zotero point at `:8000`. Use `scripts/dev session` to
authenticate, or run on the standard ports with the uncontainerized stack
stopped:

```bash
CLIENT_PORT=3000 SERVER_PORT=8000 JOBS_PORT=8001 scripts/dev up
```

Service decomposition mirrors production (see the ECS task definitions in the
`open-paper-ci` repo): server, jobs API, jobs worker, and jobs beat are separate
containers, and migrations run once as a one-shot before the server starts
rather than on every server boot.
