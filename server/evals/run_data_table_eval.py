"""
End-to-end eval for the Data Table extraction flow.

Characterizes what the live extraction pipeline does with columns that
require arithmetic (derived columns). Seeds an eval user and
one project per manifest paper, then drives the REAL flow over HTTP:

    POST /api/projects/tables  ->  Celery (jobs worker)  ->  webhook  ->  result

Requires the full local stack running: server API, RabbitMQ, jobs worker,
and S3 credentials in server/.env (papers are uploaded to the app bucket so
the jobs worker can download them).

Usage:
    cd server
    uv run python -m evals.run_data_table_eval               # seed + 3 runs + grade
    uv run python -m evals.run_data_table_eval --runs 1
    uv run python -m evals.run_data_table_eval --seed-only   # just seed, no jobs
    uv run python -m evals.run_data_table_eval --grade-only  # re-grade saved results
"""

import argparse
import json
import logging
import os
import re
import sys
import time
import uuid
from typing import Any, Optional

import requests
from dotenv import load_dotenv

load_dotenv()

# Add server/ to path so we can import app modules
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database.crud.paper_crud import PaperCreate, paper_crud
from app.database.crud.projects.project_crud import ProjectCreate, project_crud
from app.database.crud.projects.project_paper_crud import (
    ProjectPaperCreate,
    project_paper_crud,
)
from app.database.crud.subscription_crud import subscription_crud
from app.database.crud.user_crud import user as user_crud
from app.database.database import SessionLocal
from app.database.models import SubscriptionPlan
from app.helpers.s3 import s3_service
from app.schemas.user import CurrentUser
from evals.run_benchmark import ensure_eval_user, extract_text_from_pdf

logger = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

EVALS_DIR = os.path.dirname(os.path.abspath(__file__))
SEED_DATA_DIR = os.path.join(EVALS_DIR, "seed_data")
MANIFEST_PATH = os.path.join(EVALS_DIR, "data_table_eval_manifest.json")
RESULTS_PATH = os.path.join(EVALS_DIR, "results", "eval_data_table.json")

SERVER_BASE_URL = os.getenv("EVAL_SERVER_BASE_URL", "http://localhost:8000")
POLL_INTERVAL_SECONDS = 10
JOB_TIMEOUT_SECONDS = 15 * 60

NA_VALUES = {"n/a", "na", "none", "not reported", ""}


# ---------------------------------------------------------------------------
# Manifest / results IO
# ---------------------------------------------------------------------------


def load_manifest() -> dict:
    with open(MANIFEST_PATH) as f:
        return json.load(f)


def load_results() -> dict:
    if os.path.exists(RESULTS_PATH):
        with open(RESULTS_PATH) as f:
            return json.load(f)
    return {"seed": {}, "runs": []}


def save_results(results: dict) -> None:
    os.makedirs(os.path.dirname(RESULTS_PATH), exist_ok=True)
    tmp_path = RESULTS_PATH + ".tmp"
    with open(tmp_path, "w") as f:
        json.dump(results, f, indent=2)
    os.replace(tmp_path, RESULTS_PATH)


# ---------------------------------------------------------------------------
# Phase 1: Seeding — eval user, papers into S3 + DB, one project per paper
# ---------------------------------------------------------------------------


def seed(db, current_user: CurrentUser, manifest: dict, results: dict) -> dict:
    """Upload each manifest paper to S3, create paper + project records.

    Idempotent: seeded ids are recorded in the results file and verified
    against the DB before reuse.
    """
    seed_state = results.setdefault("seed", {})

    for paper_cfg in manifest["papers"]:
        key = paper_cfg["key"]
        state = seed_state.get(key, {})

        if state.get("paper_id") and state.get("project_id"):
            existing = paper_crud.get(
                db, id=uuid.UUID(state["paper_id"]), user=current_user
            )
            if existing:
                logger.info(f"[seed] {key}: already seeded, skipping")
                continue
            logger.info(f"[seed] {key}: stale seed state, re-seeding")

        pdf_path = os.path.join(SEED_DATA_DIR, paper_cfg["file"])
        if not os.path.exists(pdf_path):
            raise FileNotFoundError(f"Seed PDF missing: {pdf_path}")

        logger.info(f"[seed] {key}: uploading {paper_cfg['file']} to S3")
        object_key, file_url = s3_service.upload_any_file(
            pdf_path, paper_cfg["file"], "application/pdf"
        )

        with open(pdf_path, "rb") as f:
            raw_content = extract_text_from_pdf(f.read())

        paper = paper_crud.create(
            db=db,
            obj_in=PaperCreate(
                file_url=file_url,
                s3_object_key=object_key,
                raw_content=raw_content,
                title=paper_cfg["title"],
            ),
            user=current_user,
        )
        if not paper:
            raise RuntimeError(f"Failed to create paper record for {key}")

        project = project_crud.create(
            db=db,
            obj_in=ProjectCreate(
                title=f"DT Eval — {key}",
                description="Seeded by evals.run_data_table_eval",
            ),
            user=current_user,
        )
        if not project:
            raise RuntimeError(f"Failed to create project for {key}")

        linked = project_paper_crud.create(
            db=db,
            obj_in=ProjectPaperCreate(paper_id=uuid.UUID(str(paper.id))),
            user=current_user,
            project_id=uuid.UUID(str(project.id)),
        )
        if not linked:
            raise RuntimeError(f"Failed to link paper to project for {key}")

        seed_state[key] = {
            "paper_id": str(paper.id),
            "project_id": str(project.id),
            "s3_object_key": object_key,
        }
        logger.info(
            f"[seed] {key}: paper={paper.id} project={project.id} s3={object_key}"
        )

    return seed_state


# ---------------------------------------------------------------------------
# Phase 2: Drive the e2e flow over HTTP
# ---------------------------------------------------------------------------


def ensure_researcher_plan(db, current_user: CurrentUser) -> None:
    """The eval creates several data table jobs per cycle; the BASIC plan
    allows only 2/week. Bump the eval user to RESEARCHER (50/week)."""
    subscription_crud.create_or_update(
        db,
        user_id=current_user.id,
        subscription_data={"plan": SubscriptionPlan.RESEARCHER.value},
    )


def mint_session_token(db, current_user: CurrentUser) -> str:
    session = user_crud.create_session(db, user_id=current_user.id, expires_in_days=1)
    return str(session.token)


class ApiClient:
    def __init__(self, base_url: str, token: str):
        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()
        self.session.headers["Authorization"] = f"Bearer {token}"

    def create_job(
        self,
        project_id: str,
        columns: list[str],
        derived_columns: Optional[list[dict]] = None,
        list_columns: Optional[list[str]] = None,
    ) -> dict:
        resp = self.session.post(
            f"{self.base_url}/api/projects/tables",
            json={
                "project_id": project_id,
                "columns": columns,
                "derived_columns": derived_columns or [],
                "list_columns": list_columns or [],
            },
            timeout=60,
        )
        resp.raise_for_status()
        return resp.json()

    def job_status(self, job_id: str) -> dict:
        resp = self.session.get(
            f"{self.base_url}/api/projects/tables/{job_id}", timeout=60
        )
        resp.raise_for_status()
        return resp.json()

    def result_id_for_job(self, project_id: str, job_id: str) -> Optional[str]:
        # The job flips to "completed" slightly before the webhook persists the
        # result row, so retry the lookup briefly.
        for _ in range(6):
            resp = self.session.get(
                f"{self.base_url}/api/projects/tables/jobs/{project_id}",
                params={"all": "true"},
                timeout=60,
            )
            resp.raise_for_status()
            for job in resp.json().get("jobs", []):
                if job.get("id") == job_id and job.get("result_id"):
                    return job["result_id"]
            time.sleep(5)
        return None

    def fetch_result(self, result_id: str) -> dict:
        resp = self.session.get(
            f"{self.base_url}/api/projects/tables/results/{result_id}", timeout=60
        )
        resp.raise_for_status()
        return resp.json()["data"]


def run_extraction(
    api: ApiClient,
    project_id: str,
    columns: list[str],
    label: str,
    derived_columns: Optional[list[dict]] = None,
    list_columns: Optional[list[str]] = None,
) -> dict:
    """Create one data table job and wait for its result."""
    created = api.create_job(project_id, columns, derived_columns, list_columns)
    job_id = created["id"]
    logger.info(f"[run] {label}: job {job_id} submitted")

    deadline = time.time() + JOB_TIMEOUT_SECONDS
    while True:
        status = api.job_status(job_id)
        if status["status"] == "completed":
            break
        if status["status"] in ("failed", "cancelled"):
            raise RuntimeError(
                f"Job {job_id} {status['status']}: {status.get('error_message')}"
            )
        if time.time() > deadline:
            raise TimeoutError(f"Job {job_id} timed out")
        time.sleep(POLL_INTERVAL_SECONDS)

    result_id = api.result_id_for_job(project_id, job_id)
    if not result_id:
        raise RuntimeError(f"Job {job_id} completed but has no result_id")

    result = api.fetch_result(result_id)
    logger.info(f"[run] {label}: result {result_id} fetched")
    return {"job_id": job_id, "result_id": result_id, "result": result}


# ---------------------------------------------------------------------------
# Phase 3: Grading
# ---------------------------------------------------------------------------


def parse_numeric(value: str) -> Optional[float]:
    """Pull a float out of a cell value like '56.9', '56.9%', '17.9 pp'."""
    if value is None:
        return None
    cleaned = value.strip().replace(",", "")
    m = re.search(r"-?\d+(?:\.\d+)?", cleaned)
    if not m:
        return None
    try:
        return float(m.group(0))
    except ValueError:
        return None


def is_na(value: str) -> bool:
    return (value or "").strip().lower() in NA_VALUES


def normalize_text(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").lower()).strip()


def citation_in_paper(citation_text: str, paper_text_norm: str) -> bool:
    """Loose containment check: does the cited quote (or most of it) appear
    in the paper text? Figure/table references can't be checked this way."""
    cit = normalize_text(citation_text)
    if not cit:
        return False
    if re.fullmatch(r"(figure|table|fig\.?)\s*\S*", cit):
        return True  # "Figure X"/"Table Y" refs are allowed by the prompt
    if cit in paper_text_norm:
        return True
    # PDF text extraction mangles ligatures/hyphenation; accept if most
    # 5-word shingles of the citation appear verbatim.
    words = cit.split()
    if len(words) < 5:
        return False
    shingles = [" ".join(words[i : i + 5]) for i in range(len(words) - 4)]
    hits = sum(1 for s in shingles if s in paper_text_norm)
    return hits / len(shingles) >= 0.5


def grade_list_cell(col_cfg: dict, cell: dict, paper_text_norm: str) -> dict:
    """Grade a list-valued cell: extracted elements must match the expected
    multiset within tolerance (order-independent)."""
    entries = cell.get("entries") or []
    numerics = [
        n for n in (parse_numeric(e.get("value", "")) for e in entries) if n is not None
    ]
    expected = col_cfg.get("expected_elements") or []
    tolerance = col_cfg.get("tolerance", 0.05)

    matched = len(numerics) == len(expected) and all(
        abs(a - b) <= tolerance for a, b in zip(sorted(numerics), sorted(expected))
    )

    entry_citations = [c for e in entries for c in (e.get("citations") or [])]
    graded: dict[str, Any] = {
        "label": col_cfg["label"],
        "kind": "list",
        "value": cell.get("value", ""),
        "numeric": None,
        "elements": numerics,
        "expected": expected,
        "n_citations": len(entry_citations),
        "citations_found": sum(
            1
            for c in entry_citations
            if citation_in_paper(c.get("text", ""), paper_text_norm)
        ),
        "has_derivation": False,
        "derivation_warnings": [],
    }
    if not numerics:
        graded["outcome"] = "na"
    elif matched:
        graded["outcome"] = "correct_number"
    else:
        graded["outcome"] = "incorrect_number"
    return graded


def grade_cell(col_cfg: dict, cell: dict, paper_text_norm: str) -> dict:
    """Grade one extracted cell against its golden config."""
    if col_cfg["kind"] == "list":
        return grade_list_cell(col_cfg, cell, paper_text_norm)

    value = cell.get("value", "")
    citations = cell.get("citations", []) or []
    numeric = parse_numeric(value)
    expected = col_cfg.get("expected")
    tolerance = col_cfg.get("tolerance", 0.05)

    derivation = cell.get("derivation")
    graded: dict[str, Any] = {
        "label": col_cfg["label"],
        "kind": col_cfg["kind"],
        "value": value,
        "numeric": numeric,
        "expected": expected,
        "n_citations": len(citations),
        "citations_found": sum(
            1
            for c in citations
            if citation_in_paper(c.get("text", ""), paper_text_norm)
        ),
        "has_derivation": bool(derivation),
        "derivation_warnings": (derivation or {}).get("warnings", []),
    }

    if is_na(value):
        graded["outcome"] = "na"
    elif numeric is None:
        graded["outcome"] = "non_numeric"
    elif expected is not None and abs(numeric - float(expected)) <= tolerance:
        graded["outcome"] = "correct_number"
    else:
        graded["outcome"] = "incorrect_number"

    return graded


def grade_run(run_record: dict, manifest: dict, paper_texts: dict) -> dict:
    paper_cfg = next(
        p for p in manifest["papers"] if p["key"] == run_record["paper_key"]
    )
    rows = run_record["result"].get("rows", [])
    if not rows:
        return {"error": "no rows in result"}

    values = rows[0].get("values", {})
    paper_text_norm = paper_texts[paper_cfg["key"]]

    graded_cells = []
    for col_cfg in paper_cfg["columns"]:
        cell = values.get(col_cfg["label"], {})
        graded_cells.append(grade_cell(col_cfg, cell, paper_text_norm))

    return {"cells": graded_cells}


def summarize(results: dict, manifest: dict) -> dict:
    """Aggregate graded runs into 'three worlds' classification."""
    primitives: list[dict] = []
    derived: list[dict] = []
    derived_by_column: dict[str, list[str]] = {}

    for run_record in results["runs"]:
        grading = run_record.get("grading", {})
        for cell in grading.get("cells", []):
            # List cells are extraction outputs — grade them with primitives.
            if cell["kind"] != "derived":
                primitives.append(cell)
            else:
                derived.append(cell)
                col_key = f"{run_record['paper_key']}::{cell['label']}"
                derived_by_column.setdefault(col_key, []).append(cell["outcome"])

    def count(cells: list[dict], outcome: str) -> int:
        return sum(1 for c in cells if c["outcome"] == outcome)

    inconsistent_columns = [
        col for col, outcomes in derived_by_column.items() if len(set(outcomes)) > 1
    ]

    summary = {
        "n_runs": len(results["runs"]),
        "primitives": {
            "total": len(primitives),
            "correct": count(primitives, "correct_number"),
            "incorrect": count(primitives, "incorrect_number"),
            "na": count(primitives, "na"),
            "citation_rate": (
                sum(1 for c in primitives if c["citations_found"] > 0) / len(primitives)
                if primitives
                else None
            ),
        },
        "derived": {
            "total": len(derived),
            "na": count(derived, "na"),
            "computed_correct": count(derived, "correct_number"),
            "computed_incorrect": count(derived, "incorrect_number"),
            "non_numeric": count(derived, "non_numeric"),
            "with_derivation": sum(1 for c in derived if c.get("has_derivation")),
            "inconsistent_columns": inconsistent_columns,
        },
    }

    d = summary["derived"]
    if d["total"] == 0:
        world = "no data"
    elif d["with_derivation"] == d["total"]:
        if d["computed_correct"] == d["total"]:
            world = (
                "Calculator: every derived cell was computed by the calculator "
                "with a derivation block, and every value matches golden."
            )
        else:
            world = (
                "Calculator (with issues): all derived cells carry derivations "
                f"but only {d['computed_correct']}/{d['total']} match golden — "
                "inspect derivation warnings."
            )
    elif inconsistent_columns:
        world = (
            "World 3: INCONSISTENT — same column, different outcomes across runs. "
            "Strongest case for a deterministic calculator."
        )
    elif d["na"] == d["total"]:
        world = "World 1: model refuses (N/A) — feature gap real, no bad data shipped."
    else:
        world = (
            "World 2: model computes derived values in-head — unflagged derived "
            "numbers are shipping in customer tables."
        )
    summary["world"] = world
    return summary


def print_summary(summary: dict) -> None:
    print("\n" + "=" * 70)
    print("DATA TABLE EXTRACTION EVAL — SUMMARY")
    print("=" * 70)
    p, d = summary["primitives"], summary["derived"]
    print(f"Runs graded: {summary['n_runs']}")
    print(
        f"Primitive cells: {p['total']} | correct {p['correct']} | "
        f"incorrect {p['incorrect']} | N/A {p['na']} | "
        f"citation rate {p['citation_rate']:.0%}"
        if p["total"]
        else "Primitive cells: none"
    )
    print(
        f"Derived cells:   {d['total']} | N/A {d['na']} | "
        f"computed-correct {d['computed_correct']} | "
        f"computed-incorrect {d['computed_incorrect']} | "
        f"non-numeric {d['non_numeric']} | "
        f"with-derivation {d['with_derivation']}"
    )
    if d["inconsistent_columns"]:
        print(f"Inconsistent derived columns: {', '.join(d['inconsistent_columns'])}")
    print(f"\n>>> {summary['world']}")
    print("=" * 70)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runs", type=int, default=3, help="Runs per paper")
    parser.add_argument("--seed-only", action="store_true")
    parser.add_argument("--skip-seed", action="store_true")
    parser.add_argument("--grade-only", action="store_true")
    args = parser.parse_args()

    manifest = load_manifest()
    results = load_results()

    paper_texts = {}
    for paper_cfg in manifest["papers"]:
        pdf_path = os.path.join(SEED_DATA_DIR, paper_cfg["file"])
        with open(pdf_path, "rb") as f:
            paper_texts[paper_cfg["key"]] = normalize_text(
                extract_text_from_pdf(f.read())
            )

    if not args.grade_only:
        db = SessionLocal()
        try:
            current_user = ensure_eval_user(db)
            ensure_researcher_plan(db, current_user)

            if not args.skip_seed:
                seed(db, current_user, manifest, results)
                save_results(results)
                if args.seed_only:
                    logger.info("Seed complete (--seed-only), exiting.")
                    return

            token = mint_session_token(db, current_user)
        finally:
            db.close()

        api = ApiClient(SERVER_BASE_URL, token)

        completed = {
            (r["paper_key"], r["run_idx"]) for r in results["runs"] if "result" in r
        }
        for run_idx in range(args.runs):
            for paper_cfg in manifest["papers"]:
                key = paper_cfg["key"]
                if (key, run_idx) in completed:
                    logger.info(f"[run] {key} run {run_idx}: already done, skipping")
                    continue
                columns = [c["label"] for c in paper_cfg["columns"]]
                # Derived columns with an expression run through the calculator;
                # without one (the pre-existing manifest) they go to extraction,
                # which is itself the measurement.
                derived_columns = [
                    {
                        "label": c["label"],
                        "expression": c["expression"],
                        "inputs": c["inputs"],
                    }
                    for c in paper_cfg["columns"]
                    if c["kind"] == "derived" and c.get("expression")
                ]
                list_columns = [
                    c["label"] for c in paper_cfg["columns"] if c["kind"] == "list"
                ]
                project_id = results["seed"][key]["project_id"]
                try:
                    outcome = run_extraction(
                        api,
                        project_id,
                        columns,
                        f"{key} run {run_idx}",
                        derived_columns,
                        list_columns,
                    )
                except Exception as e:
                    logger.error(f"[run] {key} run {run_idx} failed: {e}")
                    continue
                results["runs"].append(
                    {"paper_key": key, "run_idx": run_idx, **outcome}
                )
                save_results(results)

    # Grade everything that has a result
    for run_record in results["runs"]:
        if "result" in run_record:
            run_record["grading"] = grade_run(run_record, manifest, paper_texts)
    summary = summarize(results, manifest)
    results["summary"] = summary
    save_results(results)

    print_summary(summary)
    logger.info(f"Results written to {RESULTS_PATH}")


if __name__ == "__main__":
    main()
