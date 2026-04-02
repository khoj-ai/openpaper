"""
Benchmark runner for OpenPaper single-paper QA eval.

Scaffolds a test user, syncs benchmark papers into the local DB,
runs each eval question through the chat_with_paper pipeline,
grades responses with LLM-as-judge + citation metrics, and
writes detailed results to disk.

Usage:
    cd server
    uv run python -m evals.run_benchmark [OPTIONS]
"""

import argparse
import asyncio
import difflib
import json
import logging
import os
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from io import BytesIO
from typing import Optional

from dotenv import load_dotenv
from PyPDF2 import PdfReader

load_dotenv()

# Add server/ to path so we can import app modules
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database.crud.conversation_crud import ConversationCreate, conversation_crud
from app.database.crud.paper_crud import PaperCreate, PaperUpdate, paper_crud
from app.database.crud.subscription_crud import subscription_crud
from app.database.crud.user_crud import user as user_crud
from app.database.database import SessionLocal
from app.database.models import ConversableType, SubscriptionStatus
from app.llm.operations import operations
from app.llm.provider import LLMProvider, TextContent
from app.schemas.user import CurrentUser

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

EVAL_USER_EMAIL = "eval@openpaper.ai"
EVAL_USER_NAME = "Eval Benchmark"
SIMILARITY_THRESHOLD = 0.5  # for citation matching


def fix_s3_url(url: str) -> str:
    """Convert virtual-hosted S3 URLs to path-style to avoid SSL errors.

    Bucket names with dots (e.g. assets.openpaper.ai) break SSL cert validation
    when used as subdomains of s3.amazonaws.com.
    """
    # https://assets.openpaper.ai.s3.us-east-1.amazonaws.com/key
    # -> https://s3.us-east-1.amazonaws.com/assets.openpaper.ai/key
    import re

    m = re.match(r"https://(.+?)\.s3\.([^/]+)\.amazonaws\.com/(.+)", url)
    if m:
        bucket, region, key = m.groups()
        return f"https://s3.{region}.amazonaws.com/{bucket}/{key}"
    return url


# ---------------------------------------------------------------------------
# Phase 1: Setup — test user & paper sync
# ---------------------------------------------------------------------------


def ensure_eval_user(db) -> CurrentUser:
    """Create or retrieve the eval test user with an active subscription."""
    user_obj = user_crud.get_by_email(db, email=EVAL_USER_EMAIL)

    if not user_obj:
        logger.info(f"Creating eval user: {EVAL_USER_EMAIL}")
        user_obj = user_crud.create_email_user(
            db, email=EVAL_USER_EMAIL, name=EVAL_USER_NAME
        )
    else:
        logger.info(f"Found existing eval user: {user_obj.id}")

    current_user = CurrentUser(
        id=uuid.UUID(str(user_obj.id)),
        email=str(user_obj.email),
        name=str(user_obj.name) if user_obj.name else None,
        is_admin=False,
        is_email_verified=True,
        is_active=True,
    )

    # Ensure active subscription so all access checks pass
    user_id = uuid.UUID(str(user_obj.id))

    subscription_crud.create_or_update(
        db,
        user_id=user_id,
        subscription_data={
            "status": SubscriptionStatus.ACTIVE.value,
            "current_period_start": datetime.now(timezone.utc),
            "current_period_end": datetime.now(timezone.utc) + timedelta(days=365),
            "cancel_at_period_end": False,
        },
    )

    # Ensure a session token exists (useful for HTTP-based runs later)
    session = user_crud.create_session(db, user_id=user_id, expires_in_days=365)
    logger.info(f"Session token: {session.token[:16]}...")

    return current_user


def extract_text_from_pdf(pdf_bytes: bytes) -> str:
    """Extract text from PDF bytes using PyPDF2."""
    reader = PdfReader(BytesIO(pdf_bytes))
    pages = []
    for page in reader.pages:
        text = page.extract_text()
        if text:
            pages.append(text)
    return "\n".join(pages)


def sync_papers(db, current_user: CurrentUser, manifest: dict, dataset: dict):
    """Sync benchmark papers into the DB for the eval user. Only creates missing ones."""
    import requests

    # Collect unique papers from the dataset
    paper_s3_urls = {}
    for row in dataset["rows"]:
        s3_url = row["paper_s3_url"]
        if s3_url not in paper_s3_urls:
            paper_s3_urls[s3_url] = row

    # Find matching manifest entries for metadata
    manifest_by_s3_url = {}
    for p in manifest.get("papers", []):
        manifest_by_s3_url[p["s3_url"]] = p

    # Check which papers already exist for this user (keyed by s3_object_key)
    existing_papers = paper_crud.get_multi_uploads_completed(
        db, user=current_user, limit=1000
    )
    existing_by_s3_key = {
        p.s3_object_key: p for p in existing_papers if p.s3_object_key
    }

    created = 0
    skipped = 0

    for s3_url, sample_row in paper_s3_urls.items():
        manifest_entry = manifest_by_s3_url.get(s3_url, {})
        s3_key = manifest_entry.get("s3_object_key", "")
        download_url = fix_s3_url(s3_url)

        # If paper already exists, just ensure the cached presigned URL is set
        if s3_key and s3_key in existing_by_s3_key:
            paper = existing_by_s3_key[s3_key]
            paper_crud.update(
                db=db,
                db_obj=paper,
                obj_in=PaperUpdate(
                    cached_presigned_url=download_url,
                    presigned_url_expires_at=datetime.now(timezone.utc)
                    + timedelta(days=365),
                ),
                user=current_user,
            )
            skipped += 1
            continue

        title = manifest_entry.get("title", sample_row.get("paper_doi", "Unknown"))
        logger.info(f"  Syncing paper: {title[:70]}...")

        # Download PDF from the public S3 URL
        try:
            resp = requests.get(download_url, timeout=60)
            resp.raise_for_status()
            pdf_bytes = resp.content
        except Exception as e:
            logger.error(f"  Failed to download {s3_url}: {e}")
            continue

        # Extract text for raw_content + passage indexing
        try:
            raw_content = extract_text_from_pdf(pdf_bytes)
        except Exception as e:
            logger.error(f"  Failed to extract text from {title[:50]}: {e}")
            continue

        # Create paper record
        paper_data = PaperCreate(
            file_url=s3_url,
            s3_object_key=s3_key or None,
            raw_content=raw_content,
            title=manifest_entry.get("title"),
            abstract=manifest_entry.get("abstract"),
            authors=manifest_entry.get("authors"),
        )

        paper = paper_crud.create(db=db, obj_in=paper_data, user=current_user)
        if not paper:
            logger.error(f"  Failed to create paper record for: {title[:50]}")
            continue

        # Cache the public S3 URL as the presigned URL so chat_with_paper
        # can download the PDF without going through the app's S3 bucket.
        paper_crud.update(
            db=db,
            db_obj=paper,
            obj_in=PaperUpdate(
                cached_presigned_url=download_url,
                presigned_url_expires_at=datetime.now(timezone.utc)
                + timedelta(days=365),
            ),
            user=current_user,
        )

        # Index passages for full-text search
        if raw_content:
            try:
                paper_crud.index_paper_passages(
                    db,
                    paper_id=uuid.UUID(str(paper.id)),
                    raw_content=raw_content,
                )
            except Exception as e:
                logger.error(f"  Failed to index passages for {title[:50]}: {e}")

        created += 1
        logger.info(f"  Created paper {paper.id} ({created} new)")

    logger.info(f"Paper sync complete: {created} created, {skipped} already existed")


def resolve_paper_ids(db, current_user: CurrentUser, dataset: dict) -> dict:
    """Build a mapping from paper_s3_url -> DB paper UUID."""
    existing_papers = paper_crud.get_multi_uploads_completed(
        db, user=current_user, limit=1000
    )

    # Map by s3_object_key and file_url
    by_s3_key = {}
    by_file_url = {}
    for p in existing_papers:
        if p.s3_object_key:
            by_s3_key[p.s3_object_key] = str(p.id)
        if p.file_url:
            by_file_url[p.file_url] = str(p.id)

    # Build the final mapping
    url_to_paper_id = {}
    for row in dataset["rows"]:
        s3_url = row["paper_s3_url"]
        if s3_url in url_to_paper_id:
            continue

        # Try matching by file_url (we set file_url = s3_url during sync)
        if s3_url in by_file_url:
            url_to_paper_id[s3_url] = by_file_url[s3_url]
            continue

        # Try matching by s3_object_key extracted from URL
        # URL format: https://bucket.s3.region.amazonaws.com/key
        for key, paper_id in by_s3_key.items():
            if s3_url.endswith(key):
                url_to_paper_id[s3_url] = paper_id
                break

    return url_to_paper_id


# ---------------------------------------------------------------------------
# Results file I/O (incremental, resumable)
# ---------------------------------------------------------------------------


def load_results(path: str) -> dict:
    """Load existing results file or create a fresh one."""
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return {
        "run_id": str(uuid.uuid4()),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "llm_provider": None,
        "summary": {},
        "rows": [],
    }


def save_results_file(results: dict, path: str):
    """Atomically save results to disk."""
    tmp_path = path + ".tmp"
    with open(tmp_path, "w") as f:
        json.dump(results, f, indent=2)
    os.replace(tmp_path, path)


def get_completed_row_ids(results: dict) -> set[str]:
    """Return row_ids that completed successfully (no error)."""
    return {
        r["row_id"]
        for r in results["rows"]
        if r.get("actual_answer") is not None and not r.get("error")
    }


def get_graded_row_ids(results: dict) -> set[str]:
    """Return row_ids that already have judge scores."""
    return {r["row_id"] for r in results["rows"] if "factual_accuracy" in r}


# ---------------------------------------------------------------------------
# Phase 2: Run — execute chat queries
# ---------------------------------------------------------------------------


async def run_single_question(
    db,
    current_user: CurrentUser,
    paper_id: str,
    question: str,
    provider: Optional[LLMProvider] = None,
) -> dict:
    """Run a single question through chat_with_paper and return the result."""
    # Create a fresh conversation for isolation
    conversation = conversation_crud.create(
        db,
        obj_in=ConversationCreate(
            conversable_type=ConversableType.PAPER,
            conversable_id=uuid.UUID(paper_id),
        ),
        user=current_user,
    )

    if not conversation:
        raise ValueError("Failed to create conversation for paper_id: " + paper_id)

    answer_parts = []
    citations = []

    async for chunk in operations.chat_with_paper(
        paper_id=paper_id,
        conversation_id=str(conversation.id),
        question=question,
        current_user=current_user,
        llm_provider=provider,
        response_style="normal",
        db=db,
    ):
        if isinstance(chunk, dict):
            if chunk.get("type") == "content":
                answer_parts.append(chunk["content"])
            elif chunk.get("type") == "references":
                citations = chunk.get("content", {}).get("citations", [])

    return {
        "answer_text": "".join(answer_parts).strip(),
        "citations": citations,
    }


async def run_eval_questions(
    db,
    current_user: CurrentUser,
    dataset: dict,
    url_to_paper_id: dict,
    results: dict,
    results_path: str,
    provider: Optional[LLMProvider] = None,
    limit: Optional[int] = None,
    max_retries: int = 3,
):
    """Run eval questions, writing each result to disk incrementally.

    Skips rows that already succeeded. Retries errors up to max_retries times.
    """
    rows = dataset["rows"]
    if limit is not None:
        rows = rows[:limit]

    completed = get_completed_row_ids(results)

    # Remove previous error rows so they can be retried
    error_row_ids = {r["row_id"] for r in results["rows"] if r.get("error")}
    if error_row_ids:
        results["rows"] = [r for r in results["rows"] if not r.get("error")]
        logger.info(f"{len(error_row_ids)} previously errored rows will be retried")

    logger.info(f"{len(completed)} rows already completed, skipping those")

    for i, row in enumerate(rows):
        row_id = row["row_id"]

        if row_id in completed:
            continue

        s3_url = row["paper_s3_url"]
        paper_id = url_to_paper_id.get(s3_url)
        if not paper_id:
            logger.warning(
                f"[{i + 1}/{len(rows)}] No paper found for {s3_url}, skipping"
            )
            continue

        logger.info(f"[{i + 1}/{len(rows)}] {row_id} ({row['question_type']})")

        last_error = None
        elapsed = 0.0
        for attempt in range(1, max_retries + 1):
            start = time.time()
            try:
                result = await run_single_question(
                    db, current_user, paper_id, row["question"], provider
                )
                elapsed = time.time() - start

                results["rows"].append(
                    {
                        "row_id": row_id,
                        "paper_id": row["paper_id"],
                        "question_type": row["question_type"],
                        "question": row["question"],
                        "expected_answer": row["expected_answer"],
                        "expected_references": row["expected_references"],
                        "judge_rubric": row.get("judge_rubric"),
                        "actual_answer": result["answer_text"],
                        "actual_citations": result["citations"],
                        "latency_seconds": round(elapsed, 2),
                    }
                )

                logger.info(
                    f"  Answer: {result['answer_text'][:100]}... "
                    f"({len(result['citations'])} citations, {elapsed:.1f}s)"
                )
                last_error = None
                break
            except Exception as e:
                elapsed = time.time() - start
                last_error = e
                if attempt < max_retries:
                    logger.warning(
                        f"  Attempt {attempt}/{max_retries} failed: {e} ({elapsed:.1f}s), retrying..."
                    )
                else:
                    logger.error(
                        f"  All {max_retries} attempts failed: {e} ({elapsed:.1f}s)"
                    )

        if last_error is not None:
            results["rows"].append(
                {
                    "row_id": row_id,
                    "paper_id": row["paper_id"],
                    "question_type": row["question_type"],
                    "question": row["question"],
                    "expected_answer": row["expected_answer"],
                    "expected_references": row["expected_references"],
                    "judge_rubric": row.get("judge_rubric"),
                    "actual_answer": "",
                    "actual_citations": [],
                    "latency_seconds": round(elapsed, 2),
                    "error": str(last_error),
                }
            )

        # Save after each row for resumability
        save_results_file(results, results_path)


# ---------------------------------------------------------------------------
# Phase 3: Grade — citation metrics + LLM judge
# ---------------------------------------------------------------------------


def fuzzy_match(text_a: str, text_b: str) -> float:
    """Return similarity ratio between two strings."""
    return difflib.SequenceMatcher(None, text_a.lower(), text_b.lower()).ratio()


def compute_citation_metrics(
    result: dict, paper_raw_content: Optional[str] = None
) -> dict:
    """Compute citation precision, recall, and accuracy for a single result."""
    actual_refs = [c.get("reference", "") for c in result.get("actual_citations", [])]
    expected_refs = result.get("expected_references", [])

    if not expected_refs and not actual_refs:
        return {
            "citation_precision": 1.0,
            "citation_recall": 1.0,
            "citation_accuracy": 1.0,
        }

    # Citation recall: fraction of expected refs matched by at least one actual citation
    matched_expected = 0
    for exp in expected_refs:
        for act in actual_refs:
            if fuzzy_match(exp, act) >= SIMILARITY_THRESHOLD:
                matched_expected += 1
                break
    recall = matched_expected / len(expected_refs) if expected_refs else 1.0

    # Citation precision: fraction of actual citations that match any expected ref
    matched_actual = 0
    for act in actual_refs:
        for exp in expected_refs:
            if fuzzy_match(exp, act) >= SIMILARITY_THRESHOLD:
                matched_actual += 1
                break
    precision = matched_actual / len(actual_refs) if actual_refs else 1.0

    # Citation accuracy: does the cited text appear in the paper's raw content?
    accuracy = 1.0
    if paper_raw_content and actual_refs:
        found = 0
        raw_lower = paper_raw_content.lower()
        for ref in actual_refs:
            # Check if a substantial portion of the citation appears in the paper
            ref_words = ref.lower().split()
            if len(ref_words) > 5:
                # Check a window of words for containment
                snippet = " ".join(ref_words[:10])
                if snippet in raw_lower:
                    found += 1
                    continue
            # Fallback: fuzzy match against raw content windows
            if ref.lower() in raw_lower:
                found += 1
        accuracy = found / len(actual_refs)

    return {
        "citation_precision": round(precision, 3),
        "citation_recall": round(recall, 3),
        "citation_accuracy": round(accuracy, 3),
    }


# ---------------------------------------------------------------------------
# LLM-as-Judge
# ---------------------------------------------------------------------------

JUDGE_SYSTEM_PROMPT = """\
You are an expert evaluator for a research paper QA system. You will be given \
a question about a research paper, the expected answer, and the system's actual answer. \
Score the actual answer on three dimensions.

Return your evaluation as valid JSON with this exact structure:
{
    "factual_accuracy": <1-5>,
    "completeness": <1-5>,
    "groundedness": <1-5>,
    "justification": "<brief explanation of scores>"
}

Scoring guide:
- factual_accuracy (1-5): Are the facts in the answer correct? 5 = all correct, 1 = major errors
- completeness (1-5): Does the answer cover all key points from the expected answer? 5 = fully complete, 1 = missing most points
- groundedness (1-5): Is the answer grounded in paper content (not hallucinated)? 5 = fully grounded, 1 = mostly hallucinated

Return ONLY the JSON object, no other text."""


def build_judge_prompt(result: dict) -> str:
    """Build the user prompt for the LLM judge."""
    parts = [
        f"**Question:** {result['question']}",
        f"\n**Question Type:** {result['question_type']}",
        f"\n**Expected Answer:** {result['expected_answer']}",
        f"\n**Actual Answer:** {result['actual_answer']}",
    ]

    if result.get("judge_rubric"):
        parts.append(f"\n**Rubric:** {result['judge_rubric']}")

    expected_refs = result.get("expected_references", [])
    if expected_refs:
        refs_text = "\n".join(f"  - {r}" for r in expected_refs)
        parts.append(f"\n**Expected Citations:**\n{refs_text}")

    actual_cites = result.get("actual_citations", [])
    if actual_cites:
        cites_text = "\n".join(
            f"  [{c.get('key', '?')}] {c.get('reference', '')}" for c in actual_cites
        )
        parts.append(f"\n**Actual Citations:**\n{cites_text}")

    return "\n".join(parts)


def judge_single_result(result: dict, provider: Optional[LLMProvider] = None) -> dict:
    """Use LLM-as-judge to score a single result. Returns scores dict."""
    if not result.get("actual_answer"):
        return {
            "factual_accuracy": 0,
            "completeness": 0,
            "groundedness": 0,
            "justification": "No answer produced (error during generation)",
        }

    prompt = build_judge_prompt(result)

    try:
        from app.llm.json_parser import JSONParser

        response = operations.generate_content(
            contents=[TextContent(text=prompt)],
            system_prompt=JUDGE_SYSTEM_PROMPT,
            provider=provider,
            enable_thinking=False,
        )

        if response and response.text:
            scores = JSONParser.validate_and_extract_json(response.text)
            return {
                "factual_accuracy": int(scores.get("factual_accuracy", 0)),
                "completeness": int(scores.get("completeness", 0)),
                "groundedness": int(scores.get("groundedness", 0)),
                "justification": scores.get("justification", ""),
            }
    except Exception as e:
        logger.error(f"  Judge failed for {result['row_id']}: {e}")

    return {
        "factual_accuracy": 0,
        "completeness": 0,
        "groundedness": 0,
        "justification": f"Judge error",
    }


def grade_results(
    results: dict,
    results_path: str,
    provider: Optional[LLMProvider] = None,
    skip_judge: bool = False,
):
    """Grade results in-place with citation metrics and optionally LLM judge.

    Skips rows that are already graded (for resumability).
    Writes to disk after each row.
    """
    already_graded = get_graded_row_ids(results)
    rows = results["rows"]

    for i, result in enumerate(rows):
        row_id = result.get("row_id", "?")

        if row_id in already_graded:
            continue

        logger.info(f"Grading [{i + 1}/{len(rows)}] {row_id}")

        # Citation metrics (always computed)
        citation_scores = compute_citation_metrics(result)
        result.update(citation_scores)

        # LLM judge (optional)
        if not skip_judge and not result.get("error"):
            judge_scores = judge_single_result(result, provider)
            result.update(judge_scores)
            logger.info(
                f"  Scores: accuracy={judge_scores.get('factual_accuracy')}, "
                f"completeness={judge_scores.get('completeness')}, "
                f"groundedness={judge_scores.get('groundedness')}"
            )

        save_results_file(results, results_path)


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------


def compute_summary(graded_results: list[dict]) -> dict:
    """Compute aggregate metrics from graded results."""
    if not graded_results:
        return {}

    # Separate by question type
    by_type: dict[str, list[dict]] = {}
    for r in graded_results:
        qt = r.get("question_type", "unknown")
        by_type.setdefault(qt, []).append(r)

    def avg(items: list[dict], key: str) -> float:
        vals = [r[key] for r in items if key in r and r[key] is not None and r[key] > 0]
        return round(sum(vals) / len(vals), 3) if vals else 0.0

    metric_keys = [
        "citation_precision",
        "citation_recall",
        "citation_accuracy",
        "factual_accuracy",
        "completeness",
        "groundedness",
    ]

    overall = {key: avg(graded_results, key) for key in metric_keys}
    overall["total_rows"] = len(graded_results)
    overall["errors"] = sum(1 for r in graded_results if r.get("error"))
    overall["avg_latency_seconds"] = avg(graded_results, "latency_seconds")

    per_type = {}
    for qt, items in by_type.items():
        per_type[qt] = {key: avg(items, key) for key in metric_keys}
        per_type[qt]["count"] = len(items)

    return {"overall": overall, "by_question_type": per_type}


def print_summary(summary: dict):
    """Print a readable summary table to stdout."""
    overall = summary.get("overall", {})
    by_type = summary.get("by_question_type", {})

    logger.info("\n" + "=" * 60)
    logger.info("BENCHMARK RESULTS")
    logger.info("=" * 60)

    logger.info(f"Total rows: {overall.get('total_rows', 0)}")
    logger.info(f"Errors: {overall.get('errors', 0)}")
    logger.info(f"Avg latency: {overall.get('avg_latency_seconds', 0):.1f}s")

    header = f"{'Metric':<25} {'Overall':>10}"
    for qt in sorted(by_type.keys()):
        header += f" {qt:>15}"
    logger.info(header)
    logger.info("-" * (35 + 15 * len(by_type)))

    metrics = [
        ("Citation precision", "citation_precision"),
        ("Citation recall", "citation_recall"),
        ("Citation accuracy", "citation_accuracy"),
        ("Factual accuracy", "factual_accuracy"),
        ("Completeness", "completeness"),
        ("Groundedness", "groundedness"),
    ]

    for label, key in metrics:
        val = overall.get(key, 0)
        line = f"{label:<25} {val:>10.3f}"
        for qt in sorted(by_type.keys()):
            qt_val = by_type[qt].get(key, 0)
            line += f" {qt_val:>15.3f}"
        logger.info(line)

    logger.info("=" * 60)


def get_results_path(output_dir: str, provider_name: str) -> str:
    """Return a stable results file path for this provider.

    Re-running with the same provider resumes into the same file.
    Use --output to start a fresh run in a different directory.
    """
    os.makedirs(output_dir, exist_ok=True)
    return os.path.join(output_dir, f"eval_{provider_name}.json")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def parse_provider(name: str) -> Optional[LLMProvider]:
    """Convert a provider string to LLMProvider enum."""
    if not name:
        return None
    try:
        return LLMProvider(name.lower())
    except ValueError:
        valid = [p.value for p in LLMProvider]
        raise argparse.ArgumentTypeError(
            f"Invalid provider '{name}'. Choose from: {valid}"
        )


def main():
    parser = argparse.ArgumentParser(
        description="Run OpenPaper single-paper QA benchmark",
    )
    parser.add_argument(
        "--dataset",
        default="evals/eval_dataset.json",
        help="Path to eval dataset JSON (default: evals/eval_dataset.json)",
    )
    parser.add_argument(
        "--manifest",
        default="evals/benchmark_manifest.json",
        help="Path to benchmark manifest JSON (default: evals/benchmark_manifest.json)",
    )
    parser.add_argument(
        "--provider",
        type=str,
        default=None,
        help="LLM provider: gemini, openai, groq, cerebras (default: gemini)",
    )
    parser.add_argument(
        "--skip-setup",
        action="store_true",
        help="Skip user/paper scaffolding (assume already set up)",
    )
    parser.add_argument(
        "--skip-grading",
        action="store_true",
        help="Skip LLM-as-judge grading, only compute citation metrics",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Only run first N eval rows (for quick iteration)",
    )
    parser.add_argument(
        "--retries",
        type=int,
        default=3,
        help="Max retries per question on error (default: 3)",
    )
    parser.add_argument(
        "--output",
        default="evals/results",
        help="Output directory for results (default: evals/results)",
    )
    args = parser.parse_args()

    provider = parse_provider(args.provider) if args.provider else None
    provider_name = provider.value if provider else "gemini"

    # Load dataset and manifest
    with open(args.dataset) as f:
        dataset = json.load(f)
    with open(args.manifest) as f:
        manifest = json.load(f)

    logger.info(
        f"Loaded dataset: {dataset['total_rows']} rows, "
        f"{dataset.get('total_papers_processed', '?')} papers"
    )

    # Load or create results file (stable path per provider for resumability)
    results_path = get_results_path(args.output, provider_name)
    results = load_results(results_path)
    results["llm_provider"] = provider_name
    logger.info(
        f"Results file: {results_path} "
        f"({len(results['rows'])} rows from previous run)"
    )

    db = SessionLocal()
    try:
        # Phase 1: Setup
        if not args.skip_setup:
            logger.info("Phase 1: Setting up eval user and syncing papers...")
            current_user = ensure_eval_user(db)
            sync_papers(db, current_user, manifest, dataset)
        else:
            logger.info("Phase 1: Skipping setup (--skip-setup)")
            user_obj = user_crud.get_by_email(db, email=EVAL_USER_EMAIL)
            if not user_obj:
                logger.error(
                    f"Eval user {EVAL_USER_EMAIL} not found. "
                    "Run without --skip-setup first."
                )
                sys.exit(1)
            current_user = CurrentUser(
                id=uuid.UUID(str(user_obj.id)),
                email=str(user_obj.email),
                name=str(user_obj.name) if user_obj.name else None,
                is_admin=False,
                is_email_verified=True,
                is_active=True,
            )

        # Resolve paper_s3_url -> DB paper UUIDs
        url_to_paper_id = resolve_paper_ids(db, current_user, dataset)
        logger.info(f"Resolved {len(url_to_paper_id)} papers in DB")

        if args.limit == 0:
            logger.info("--limit 0: setup only, no questions to run.")
            return

        # Phase 2: Run eval questions (incremental, writes to disk per row)
        logger.info("Phase 2: Running eval questions...")
        asyncio.run(
            run_eval_questions(
                db,
                current_user,
                dataset,
                url_to_paper_id,
                results,
                results_path,
                provider,
                args.limit,
                max_retries=args.retries,
            )
        )

        if not results["rows"]:
            logger.warning("No results produced. Check paper sync and dataset.")
            return

        # Phase 3: Grade (incremental, writes to disk per row)
        logger.info("Phase 3: Grading results...")
        grade_results(
            results,
            results_path,
            provider=provider,
            skip_judge=args.skip_grading,
        )

        # Final summary
        summary = compute_summary(results["rows"])
        results["summary"] = summary
        save_results_file(results, results_path)
        print_summary(summary)

        logger.info(f"Results saved to {results_path}")

    finally:
        db.close()


if __name__ == "__main__":
    main()
