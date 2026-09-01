"""Build the dev fixture database from the committed seed PDFs.

Run once, by hand. The result is frozen into docker/seed/fixture.dump and
restored by `scripts/dev seed` on every environment initialization, so nobody
else pays the ingestion cost and nobody needs a copy of anyone's real database.

Papers go through the REAL upload pipeline over HTTP:

    POST /api/paper/upload/  ->  Celery (jobs worker)  ->  webhook  ->  paper

so the fixture carries what the pipeline actually produces — passages, images,
extracted metadata, summaries, tags — rather than the bare paper rows a direct
CRUD insert would give. That costs LLM calls and several minutes, which is
exactly why the output is frozen rather than rebuilt per reset.

Lives under server/dev/ on purpose. Nothing in that directory reaches the
production image: server/Dockerfile copies an explicit allowlist (app/,
migrations/, and a few root files), and server/.dockerignore excludes dev/
outright so the exclusion survives anyone later switching to a broad COPY.

Requires the full stack running (server, RabbitMQ, jobs worker, S3 creds).

Usage, from the repo root:
    scripts/dev build-fixture
"""

import argparse
import logging
import os
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone

import requests
from sqlalchemy import text

DEV_DIR = os.path.dirname(os.path.abspath(__file__))
SERVER_DIR = os.path.dirname(DEV_DIR)

# Import app modules the way the server itself does.
sys.path.insert(0, SERVER_DIR)

from app.database.database import SessionLocal
from app.database.models import SubscriptionPlan, SubscriptionStatus, User

logger = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s"
)

# Fixed so the fixture is reproducible and other tooling can hardcode it:
# `scripts/dev session` mints a cookie for this user by default.
FIXTURE_USER_ID = uuid.UUID("11111111-1111-4111-8111-111111111111")
FIXTURE_USER_EMAIL = "fixture@example.com"
FIXTURE_USER_NAME = "Dev Fixture"

# The corpus stays in evals/ — run_data_table_eval.py reads the same PDFs.
SEED_DATA_DIR = os.path.join(SERVER_DIR, "evals", "seed_data")

# Grouped so the fixture has realistic multi-paper projects to render, rather
# than one project per paper. Every PDF in seed_data/ is placed.
PROJECTS = [
    {
        "title": "Chain of Thought Reasoning",
        "description": "How reasoning traces work, where they break down, and whether they can be monitored.",
        "papers": [
            "chain_of_thought.pdf",
            "chain_of_thought_for_reasoning.pdf",
            "illusion_of_thinking.pdf",
            "alignment_faking.pdf",
            "scaling_gen_verifiers.pdf",
        ],
    },
    {
        "title": "LLM Safety and Behavior",
        "description": "Refusal, sycophancy, deception, and hallucination in deployed language models.",
        "papers": [
            "refusal-in-language-models-is-mediated-by-a-single-direction-Paper-Conference.pdf",
            "sycophancy_undersatnding.pdf",
            "mafia_llms_deception.pdf",
            "llm_accuracy_inventivizes_hallucinations.pdf",
            "publicusegeneralhealthchatbots.pdf",
            "web_coach.pdf",
        ],
    },
]

POLL_INTERVAL_SECONDS = 5
JOB_TIMEOUT_SECONDS = 15 * 60


def ensure_user(db) -> None:
    """Create the fixture user and give it a RESEARCHER subscription.

    Written directly rather than through user_crud so the id stays fixed across
    rebuilds — a generated id would invalidate every reference to it.
    """
    existing = db.query(User).filter(User.id == FIXTURE_USER_ID).first()
    if existing:
        # Correct the row in place rather than skipping: a rebuild after these
        # constants change should converge, not leave the old values behind.
        existing.email = FIXTURE_USER_EMAIL
        existing.name = FIXTURE_USER_NAME
        db.commit()
        logger.info("fixture user already present: %s", FIXTURE_USER_ID)
    else:
        db.add(
            User(
                id=FIXTURE_USER_ID,
                email=FIXTURE_USER_EMAIL,
                name=FIXTURE_USER_NAME,
                auth_provider="google",
                provider_user_id=f"fixture-{FIXTURE_USER_ID}",
                is_active=True,
                is_admin=False,
                is_email_verified=True,
                is_blocked=False,
            )
        )
        db.commit()
        logger.info("created fixture user %s (%s)", FIXTURE_USER_ID, FIXTURE_USER_EMAIL)

    # RESEARCHER, not BASIC: the basic plan caps paper uploads well below the
    # 11 this fixture ingests.
    now = datetime.now(timezone.utc)
    db.execute(
        text(
            """
            INSERT INTO subscriptions (id, user_id, plan, status,
                                       current_period_start, current_period_end)
            VALUES (gen_random_uuid(), :uid, :plan, :status, :start, :end)
            ON CONFLICT (user_id) DO UPDATE
              SET plan = :plan, status = :status, current_period_end = :end
            """
        ),
        {
            "uid": str(FIXTURE_USER_ID),
            "plan": SubscriptionPlan.RESEARCHER.value,
            "status": SubscriptionStatus.ACTIVE.value,
            "start": now,
            "end": now + timedelta(days=3650),
        },
    )
    db.commit()


def mint_session(db) -> str:
    """Mint a short-lived session just for this build.

    Random and disposable rather than a fixed long-lived token: whatever is in
    the database when it is dumped ships in git, and a committed credential is
    a credential — harmless on a laptop, a real one the moment the fixture runs
    somewhere reachable. drop_sessions() clears it before the dump, and
    `scripts/dev login` mints a fresh one on demand.
    """
    token = f"build-{uuid.uuid4().hex}"
    db.execute(
        text(
            """INSERT INTO sessions (id, user_id, token, expires_at)
               VALUES (gen_random_uuid(), :uid, :token, :expires)"""
        ),
        {
            "uid": str(FIXTURE_USER_ID),
            "token": token,
            "expires": datetime.now(timezone.utc) + timedelta(days=1),
        },
    )
    db.commit()
    return token


def drop_sessions(db) -> None:
    """Leave no session behind — the fixture must ship without credentials."""
    db.execute(text("DELETE FROM sessions"))
    db.commit()


def create_project(http: requests.Session, base_url: str, cfg: dict) -> str:
    resp = http.post(
        f"{base_url}/api/projects",
        json={"title": cfg["title"], "description": cfg["description"]},
        timeout=60,
    )
    resp.raise_for_status()
    project_id = resp.json()["id"]
    logger.info("project %s -> %s", cfg["title"], project_id)
    return project_id


def upload_paper(
    http: requests.Session, base_url: str, pdf_path: str, project_id: str
) -> str:
    filename = os.path.basename(pdf_path)
    with open(pdf_path, "rb") as f:
        resp = http.post(
            f"{base_url}/api/paper/upload/",
            params={"project_id": project_id},
            files={"file": (filename, f, "application/pdf")},
            timeout=300,
        )
    if resp.status_code >= 400:
        raise RuntimeError(
            f"upload failed for {filename}: {resp.status_code} {resp.text[:300]}"
        )
    return resp.json()["job_id"]


def wait_for_job(http: requests.Session, base_url: str, job_id: str, label: str) -> str:
    deadline = time.time() + JOB_TIMEOUT_SECONDS
    while time.time() < deadline:
        try:
            resp = http.get(f"{base_url}/api/paper/upload/status/{job_id}", timeout=60)
            resp.raise_for_status()
        except requests.exceptions.ConnectionError:
            # The poll interval sits on uvicorn's keep-alive timeout, so the
            # server sometimes closes the pooled connection just as the next
            # poll reuses it. Harmless for a GET — wait and poll again. Only
            # the polling retries; re-sending the upload POST would enqueue
            # the same paper twice.
            time.sleep(POLL_INTERVAL_SECONDS)
            continue
        body = resp.json()
        status = str(body.get("status", "")).lower()
        if status == "completed":
            logger.info(
                "  %s done (metadata=%s) paper=%s",
                label,
                body.get("has_metadata"),
                body.get("paper_id"),
            )
            return body["paper_id"]
        if status == "failed":
            raise RuntimeError(
                f"{label}: ingestion failed — {body.get('celery_error')}"
            )
        time.sleep(POLL_INTERVAL_SECONDS)
    raise TimeoutError(f"{label}: not finished within {JOB_TIMEOUT_SECONDS}s")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--base-url",
        default=os.getenv("FIXTURE_BASE_URL", "http://localhost:8000"),
        help="Server base URL as seen from wherever this runs.",
    )
    args = parser.parse_args()

    db = SessionLocal()
    try:
        ensure_user(db)
        token = mint_session(db)

        http = requests.Session()
        http.cookies.set("session_token", token)

        total = sum(len(p["papers"]) for p in PROJECTS)
        done = 0
        for cfg in PROJECTS:
            project_id = create_project(http, args.base_url, cfg)
            for filename in cfg["papers"]:
                pdf_path = os.path.join(SEED_DATA_DIR, filename)
                if not os.path.exists(pdf_path):
                    raise FileNotFoundError(f"seed PDF missing: {pdf_path}")
                done += 1
                label = f"[{done}/{total}] {filename}"
                logger.info("%s uploading", label)
                job_id = upload_paper(http, args.base_url, pdf_path, project_id)
                wait_for_job(http, args.base_url, job_id, label)
    finally:
        # Runs even if ingestion blew up part-way, so a half-built database is
        # never left holding a live token.
        drop_sessions(db)
        db.close()

    logger.info("fixture built: %d papers across %d projects", total, len(PROJECTS))
    logger.info("fixture user: %s (%s)", FIXTURE_USER_ID, FIXTURE_USER_EMAIL)
    logger.info("sessions cleared — sign in with: scripts/dev login")
    return 0


if __name__ == "__main__":
    sys.exit(main())
