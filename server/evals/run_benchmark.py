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
import csv
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
from app.llm.base import ModelType
from app.llm.operations import operations
from app.llm.provider import LLMProvider, TextContent
from app.schemas.responses import FileContent
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
    """Return row_ids that already have valid judge scores.

    Rows whose judge run errored out (justification == "Judge error") are
    excluded so they get re-graded on the next run.
    """
    return {
        r["row_id"]
        for r in results["rows"]
        if "factual_accuracy" in r and r.get("justification") != "Judge error"
    }


# ---------------------------------------------------------------------------
# Phase 2: Run — execute chat queries
# ---------------------------------------------------------------------------


async def run_single_question(
    db,
    current_user: CurrentUser,
    paper_id: str,
    question: str,
    provider: Optional[LLMProvider] = None,
    model_type: ModelType = ModelType.DEFAULT,
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
        model_type=model_type,
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


BASELINE_SYSTEM_PROMPT = """\
You are a helpful research assistant. You will be given a research paper as a PDF \
and a question about it. Answer the question accurately and completely based only \
on the content of the paper. Be specific and cite relevant details from the paper \
in your answer."""


def run_single_question_baseline(
    db,
    paper_id: str,
    question: str,
    provider: Optional[LLMProvider] = None,
    model_type: ModelType = ModelType.DEFAULT,
) -> dict:
    """Run a single question directly against the LLM with the PDF, no harness."""
    import httpx

    paper = paper_crud.get(db, id=paper_id)
    if not paper:
        raise ValueError(f"Paper with ID {paper_id} not found.")

    # Download the PDF
    url = paper.cached_presigned_url
    if not url:
        raise ValueError(f"No cached presigned URL for paper {paper_id}")
    pdf_bytes = httpx.get(str(url)).content

    message_content = [
        FileContent(
            data=pdf_bytes,
            mime_type="application/pdf",
            filename=f"{paper.title or 'paper'}.pdf",
            text_fallback=str(paper.raw_content) if paper.raw_content else None,
        ),
        TextContent(text=question),
    ]

    response = operations.generate_content(
        contents=message_content,
        system_prompt=BASELINE_SYSTEM_PROMPT,
        provider=provider,
        model_type=model_type,
    )

    answer_text = response.text.strip() if response and response.text else ""
    return {
        "answer_text": answer_text,
        "citations": [],
    }


async def _run_single_row(
    row: dict,
    row_index: int,
    total_rows: int,
    current_user: CurrentUser,
    paper_id: str,
    provider: Optional[LLMProvider],
    max_retries: int,
    baseline: bool,
    model_type: ModelType = ModelType.DEFAULT,
) -> dict:
    """Run a single eval row with retries, using its own DB session.

    Returns a result dict ready to be appended to results["rows"].
    """
    row_id = row["row_id"]
    logger.info(f"[{row_index}/{total_rows}] {row_id} ({row['question_type']})")

    last_error = None
    elapsed = 0.0

    for attempt in range(1, max_retries + 1):
        db = SessionLocal()
        start = time.time()
        try:
            if baseline:
                result = await asyncio.to_thread(
                    run_single_question_baseline,
                    db,
                    paper_id,
                    row["question"],
                    provider,
                    model_type,
                )
            else:
                result = await run_single_question(
                    db,
                    current_user,
                    paper_id,
                    row["question"],
                    provider,
                    model_type,
                )
            elapsed = time.time() - start

            logger.info(
                f"  [{row_id}] Answer: {result['answer_text'][:100]}... "
                f"({len(result['citations'])} citations, {elapsed:.1f}s)"
            )
            return {
                "row_id": row_id,
                "paper_id": row["paper_id"],
                "domain": row.get("domain", "unknown"),
                "question_type": row["question_type"],
                "question": row["question"],
                "expected_answer": row["expected_answer"],
                "expected_references": row["expected_references"],
                "expected_refusal": row.get("expected_refusal"),
                "required_sections": row.get("required_sections"),
                "reasoning_chain": row.get("reasoning_chain"),
                "false_premise": row.get("false_premise"),
                "judge_rubric": row.get("judge_rubric"),
                "actual_answer": result["answer_text"],
                "actual_citations": result["citations"],
                "latency_seconds": round(elapsed, 2),
            }
        except Exception as e:
            elapsed = time.time() - start
            last_error = e
            if attempt < max_retries:
                logger.warning(
                    f"  [{row_id}] Attempt {attempt}/{max_retries} failed: {e} ({elapsed:.1f}s), retrying..."
                )
            else:
                logger.error(
                    f"  [{row_id}] All {max_retries} attempts failed: {e} ({elapsed:.1f}s)"
                )
        finally:
            db.close()

    return {
        "row_id": row_id,
        "paper_id": row["paper_id"],
        "domain": row.get("domain", "unknown"),
        "question_type": row["question_type"],
        "question": row["question"],
        "expected_answer": row["expected_answer"],
        "expected_references": row["expected_references"],
        "expected_refusal": row.get("expected_refusal"),
        "required_sections": row.get("required_sections"),
        "reasoning_chain": row.get("reasoning_chain"),
        "false_premise": row.get("false_premise"),
        "judge_rubric": row.get("judge_rubric"),
        "actual_answer": "",
        "actual_citations": [],
        "latency_seconds": round(elapsed, 2),
        "error": str(last_error),
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
    baseline: bool = False,
    batch_size: int = 5,
    model_type: ModelType = ModelType.DEFAULT,
):
    """Run eval questions in parallel batches, writing results to disk after each batch.

    Skips rows that already succeeded. Retries errors up to max_retries times.
    When baseline=True, sends the question directly to the LLM with the PDF
    instead of going through the chat_with_paper pipeline.

    When limit is set, samples that many rows evenly spaced across the dataset
    (every len(rows)/limit items) rather than taking the first N.
    """
    all_rows = dataset["rows"]
    if limit is not None and limit < len(all_rows):
        step = len(all_rows) / limit
        rows = [all_rows[int(i * step)] for i in range(limit)]
    else:
        rows = all_rows

    completed = get_completed_row_ids(results)

    # Remove previous error rows so they can be retried
    error_row_ids = {r["row_id"] for r in results["rows"] if r.get("error")}
    if error_row_ids:
        results["rows"] = [r for r in results["rows"] if not r.get("error")]
        logger.info(f"{len(error_row_ids)} previously errored rows will be retried")

    logger.info(f"{len(completed)} rows already completed, skipping those")

    # Build list of pending rows
    pending = []
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

        pending.append((i + 1, row, paper_id))

    logger.info(f"{len(pending)} rows to run (batch_size={batch_size})")

    # Process in batches
    for batch_start in range(0, len(pending), batch_size):
        batch = pending[batch_start : batch_start + batch_size]
        batch_num = batch_start // batch_size + 1
        total_batches = (len(pending) + batch_size - 1) // batch_size
        logger.info(
            f"Batch {batch_num}/{total_batches} — "
            f"{len(batch)} questions in parallel"
        )

        tasks = [
            _run_single_row(
                row=row,
                row_index=row_index,
                total_rows=len(rows),
                current_user=current_user,
                paper_id=paper_id,
                provider=provider,
                max_retries=max_retries,
                baseline=baseline,
                model_type=model_type,
            )
            for row_index, row, paper_id in batch
        ]

        batch_results = await asyncio.gather(*tasks)
        results["rows"].extend(batch_results)

        # Save after each batch for resumability
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
    """Compute citation precision, recall, accuracy, and (for adversarial) refusal_correctness."""
    actual_refs = [c.get("reference", "") for c in result.get("actual_citations", [])]
    expected_refs = result.get("expected_references", [])
    is_adversarial = result.get("question_type") == "adversarial" and result.get(
        "expected_refusal", True
    )

    if not expected_refs and not actual_refs:
        metrics = {
            "citation_precision": 1.0,
            "citation_recall": 1.0,
            "citation_accuracy": 1.0,
        }
        if is_adversarial:
            metrics["refusal_correctness"] = 1.0
        return metrics

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

    metrics = {
        "citation_precision": round(precision, 3),
        "citation_recall": round(recall, 3),
        "citation_accuracy": round(accuracy, 3),
    }

    # Refusal correctness (adversarial only): the model should NOT cite anything
    # outside the optional refutation set. No citations at all = perfect refusal.
    # Citing only from expected_refs = also correct (legitimately refuting).
    # Any citation that doesn't match expected_refs = fabrication.
    if is_adversarial:
        if not actual_refs:
            metrics["refusal_correctness"] = 1.0
        elif not expected_refs:
            metrics["refusal_correctness"] = 0.0
        else:
            all_match = all(
                any(
                    fuzzy_match(act, exp) >= SIMILARITY_THRESHOLD
                    for exp in expected_refs
                )
                for act in actual_refs
            )
            metrics["refusal_correctness"] = 1.0 if all_match else 0.0

    return metrics


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

Question-type-specific guidance:
- For 'adversarial' questions: the question contains a FALSE PREMISE or asks about \
something the paper does not address. The CORRECT response is to identify the false \
premise and refuse to fabricate. Score factual_accuracy = 5 if the model correctly \
flags the false premise; score 1 if the model confidently fabricates an answer. \
A confident, fluent answer to an unanswerable question is the WORST possible outcome — \
it must be scored 1 on factual_accuracy and 1 on groundedness regardless of how \
plausible the answer sounds.
- For 'multi_hop' questions: the answer requires synthesizing facts from MULTIPLE \
distinct sections of the paper. Score completeness = 5 ONLY when the model \
demonstrably integrates information from each required section listed in the prompt. \
Score completeness <= 2 if the model addresses only one section when multiple were required.

Return ONLY the JSON object, no other text."""


def build_judge_prompt(result: dict) -> str:
    """Build the user prompt for the LLM judge."""
    parts = [
        f"**Question:** {result['question']}",
        f"\n**Question Type:** {result['question_type']}",
    ]

    if result.get("false_premise"):
        parts.append(
            f"\n**False Premise (what's wrong with the question):** "
            f"{result['false_premise']}"
        )
        parts.append(
            "\n**Expected Behavior:** The model should identify the false premise "
            "and refuse to fabricate. A confident answer here is a failure."
        )

    if result.get("required_sections"):
        sections = ", ".join(result["required_sections"])
        parts.append(
            f"\n**Required Sections (answer must synthesize from all):** {sections}"
        )

    if result.get("reasoning_chain"):
        parts.append(f"\n**Expected Reasoning Chain:** {result['reasoning_chain']}")

    parts.append(f"\n**Expected Answer:** {result['expected_answer']}")
    parts.append(f"\n**Actual Answer:** {result['actual_answer']}")

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
        "justification": "Judge error",
    }


def grade_results(
    results: dict,
    results_path: str,
    provider: Optional[LLMProvider] = None,
    skip_judge: bool = False,
    baseline: bool = False,
):
    """Grade results in-place with citation metrics and optionally LLM judge.

    Skips rows that are already graded (for resumability).
    Skips citation metrics for baseline runs (no citation protocol).
    Writes to disk after each row.
    """
    already_graded = get_graded_row_ids(results)
    rows = results["rows"]

    for i, result in enumerate(rows):
        row_id = result.get("row_id", "?")

        if row_id in already_graded:
            continue

        logger.info(f"Grading [{i + 1}/{len(rows)}] {row_id}")

        # Citation metrics (skip for baseline — no citation protocol)
        if not baseline:
            citation_scores = compute_citation_metrics(result)
            result.update(citation_scores)

        # LLM judge (optional)
        if not skip_judge and not result.get("error"):
            judge_scores = judge_single_result(result, LLMProvider.GEMINI)
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


def _fmt_cell(d: dict, key: str, width: int = 10) -> str:
    """Format a metric value for table display. Renders '—' when absent."""
    v = d.get(key)
    if v is None:
        return f"{'—':>{width}}"
    return f"{v:>{width}.3f}"


def _csv_cell(d: dict, key: str):
    """Return a metric value or empty string for CSV output when absent."""
    v = d.get(key)
    return v if v is not None else ""


def compute_summary(graded_results: list[dict]) -> dict:
    """Compute aggregate metrics from graded results."""
    if not graded_results:
        return {}

    # Separate by question type and domain
    by_type: dict[str, list[dict]] = {}
    by_domain: dict[str, list[dict]] = {}
    for r in graded_results:
        qt = r.get("question_type", "unknown")
        by_type.setdefault(qt, []).append(r)
        domain = r.get("domain", "unknown")
        by_domain.setdefault(domain, []).append(r)

    def avg(items: list[dict], key: str) -> float:
        vals = [r[key] for r in items if key in r and r[key] is not None and r[key] > 0]
        return round(sum(vals) / len(vals), 3) if vals else 0.0

    def avg_binary(items: list[dict], key: str) -> Optional[float]:
        """Average that includes zeros — for binary 0/1 metrics where 0 is a real failure signal."""
        vals = [r[key] for r in items if key in r and r[key] is not None]
        return round(sum(vals) / len(vals), 3) if vals else None

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

    # refusal_correctness: only meaningful for adversarial rows; binary metric
    adv_rows = by_type.get("adversarial", [])
    if adv_rows:
        rc = avg_binary(adv_rows, "refusal_correctness")
        if rc is not None:
            overall["refusal_correctness"] = rc

    per_type = {}
    for qt, items in by_type.items():
        per_type[qt] = {key: avg(items, key) for key in metric_keys}
        per_type[qt]["count"] = len(items)
        per_type[qt]["avg_latency_seconds"] = avg(items, "latency_seconds")
        if qt == "adversarial":
            rc = avg_binary(items, "refusal_correctness")
            if rc is not None:
                per_type[qt]["refusal_correctness"] = rc

    per_domain = {}
    for domain, items in by_domain.items():
        per_domain[domain] = {key: avg(items, key) for key in metric_keys}
        per_domain[domain]["count"] = len(items)
        per_domain[domain]["avg_latency_seconds"] = avg(items, "latency_seconds")
        adv_in_domain = [r for r in items if r.get("question_type") == "adversarial"]
        if adv_in_domain:
            rc = avg_binary(adv_in_domain, "refusal_correctness")
            if rc is not None:
                per_domain[domain]["refusal_correctness"] = rc

    return {
        "overall": overall,
        "by_question_type": per_type,
        "by_domain": per_domain,
    }


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
        ("Refusal correctness", "refusal_correctness"),
        ("Factual accuracy", "factual_accuracy"),
        ("Completeness", "completeness"),
        ("Groundedness", "groundedness"),
    ]

    for label, key in metrics:
        line = f"{label:<25}{_fmt_cell(overall, key, 10)}"
        for qt in sorted(by_type.keys()):
            line += f" {_fmt_cell(by_type[qt], key, 15)}"
        logger.info(line)

    logger.info("=" * 60)


def get_results_path(
    output_dir: str, provider_name: str, baseline: bool = False, fast: bool = False
) -> str:
    """Return a stable results file path for this provider.

    Re-running with the same provider resumes into the same file.
    Use --output to start a fresh run in a different directory.
    """
    os.makedirs(output_dir, exist_ok=True)
    fast_suffix = "_fast" if fast else ""
    baseline_suffix = "_baseline" if baseline else ""
    return os.path.join(
        output_dir, f"eval_{provider_name}{fast_suffix}{baseline_suffix}.json"
    )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def backfill_domains(rows: list[dict], dataset_path: str) -> list[dict]:
    """Backfill missing 'domain' field on result rows from the eval dataset."""
    missing = [r for r in rows if not r.get("domain") or r["domain"] == "unknown"]
    if not missing:
        return rows

    if not os.path.exists(dataset_path):
        return rows

    with open(dataset_path) as f:
        dataset = json.load(f)

    domain_by_row_id = {
        r["row_id"]: r.get("domain", "unknown") for r in dataset["rows"]
    }

    for r in rows:
        if not r.get("domain") or r["domain"] == "unknown":
            r["domain"] = domain_by_row_id.get(r.get("row_id", ""), "unknown")

    return rows


def discover_provider_variants(output_dir: str) -> list[tuple[str, bool]]:
    """Scan the results directory and return (provider_name, fast) pairs.

    Each variant maps to its own column in the cross-provider comparison;
    `eval_gemini.json` and `eval_gemini_fast.json` are distinct.
    """
    import re

    seen: set[tuple[str, bool]] = set()
    if not os.path.isdir(output_dir):
        return []
    for fname in os.listdir(output_dir):
        m = re.match(r"eval_(.+?)(_fast)?(_baseline)?\.json$", fname)
        if m:
            seen.add((m.group(1), bool(m.group(2))))
    return sorted(seen)


def variant_label(provider_name: str, fast: bool) -> str:
    """Column label for a provider variant (e.g. 'gemini' or 'gemini_fast')."""
    return f"{provider_name}_fast" if fast else provider_name


COMPARE_METRICS = [
    ("Factual accuracy", "factual_accuracy"),
    ("Completeness", "completeness"),
    ("Groundedness", "groundedness"),
    ("Avg latency (s)", "avg_latency_seconds"),
]

CITATION_METRICS = [
    ("Citation precision", "citation_precision"),
    ("Citation recall", "citation_recall"),
    ("Citation accuracy", "citation_accuracy"),
    ("Refusal correctness", "refusal_correctness"),
]


def write_comparison_csv(
    csv_path: str,
    harness: dict,
    baseline: dict,
):
    """Write a single-provider harness vs baseline comparison to CSV.

    Long-format rows: scope, domain, metric, harness, baseline, delta.
    Citation metrics (harness only) leave baseline/delta blank.
    """
    h_overall = harness.get("summary", {}).get("overall", {})
    b_overall = baseline.get("summary", {}).get("overall", {})
    h_by_domain = harness.get("summary", {}).get("by_domain", {})
    b_by_domain = baseline.get("summary", {}).get("by_domain", {})

    with open(csv_path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["scope", "domain", "metric", "harness", "baseline", "delta"])

        for label, key in COMPARE_METRICS:
            h_val = h_overall.get(key, 0)
            b_val = b_overall.get(key, 0)
            writer.writerow(
                ["overall", "", label, h_val, b_val, round(h_val - b_val, 3)]
            )

        for label, key in CITATION_METRICS:
            writer.writerow(["overall", "", label, _csv_cell(h_overall, key), "", ""])

        all_domains = sorted(set(list(h_by_domain.keys()) + list(b_by_domain.keys())))
        for domain in all_domains:
            h_d = h_by_domain.get(domain, {})
            b_d = b_by_domain.get(domain, {})
            for label, key in COMPARE_METRICS:
                h_val = h_d.get(key, 0)
                b_val = b_d.get(key, 0)
                writer.writerow(
                    ["domain", domain, label, h_val, b_val, round(h_val - b_val, 3)]
                )
            for label, key in CITATION_METRICS:
                writer.writerow(["domain", domain, label, _csv_cell(h_d, key), "", ""])


def write_all_providers_csv(csv_path: str, all_results: dict):
    """Write a wide-format cross-provider CSV.

    Columns: scope, domain, metric, then one column per (provider, mode).
    Citation rows leave non-harness columns blank.
    """
    columns: list[tuple[str, str, str]] = []
    for provider_name in sorted(all_results.keys()):
        entry = all_results[provider_name]
        if "harness" in entry:
            columns.append((provider_name, provider_name, "harness"))
        if "baseline" in entry:
            columns.append((f"{provider_name}_base", provider_name, "baseline"))

    with open(csv_path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["scope", "domain", "metric"] + [c[0] for c in columns])

        for label, key in COMPARE_METRICS:
            row = ["overall", "", label]
            for _, provider_name, mode in columns:
                row.append(all_results[provider_name].get(mode, {}).get(key, 0))
            writer.writerow(row)

        for label, key in CITATION_METRICS:
            row = ["overall", "", label]
            for _, provider_name, mode in columns:
                if mode == "harness":
                    row.append(
                        _csv_cell(all_results[provider_name].get("harness", {}), key)
                    )
                else:
                    row.append("")
            writer.writerow(row)

        all_domains = set()
        for entry in all_results.values():
            for mode in ("harness", "baseline"):
                all_domains.update(entry.get(f"{mode}_by_domain", {}).keys())

        for domain in sorted(all_domains):
            for label, key in COMPARE_METRICS:
                row = ["domain", domain, label]
                for _, provider_name, mode in columns:
                    domain_data = (
                        all_results[provider_name]
                        .get(f"{mode}_by_domain", {})
                        .get(domain, {})
                    )
                    row.append(domain_data.get(key, 0))
                writer.writerow(row)
            for label, key in CITATION_METRICS:
                row = ["domain", domain, label]
                for _, provider_name, mode in columns:
                    if mode == "harness":
                        domain_data = (
                            all_results[provider_name]
                            .get("harness_by_domain", {})
                            .get(domain, {})
                        )
                        row.append(_csv_cell(domain_data, key))
                    else:
                        row.append("")
                writer.writerow(row)


def print_comparison(
    harness_path: str, baseline_path: str, csv_path: Optional[str] = None
):
    """Load harness and baseline results and print a side-by-side comparison for one provider."""
    if not os.path.exists(harness_path):
        logger.error(f"Harness results not found: {harness_path}")
        return
    if not os.path.exists(baseline_path):
        logger.error(f"Baseline results not found: {baseline_path}")
        return

    with open(harness_path) as f:
        harness = json.load(f)
    with open(baseline_path) as f:
        baseline = json.load(f)

    h_summary = harness.get("summary", {}).get("overall", {})
    b_summary = baseline.get("summary", {}).get("overall", {})

    if not h_summary or not b_summary:
        logger.error("One or both results are missing summary data. Run grading first.")
        return

    logger.info("\n" + "=" * 70)
    logger.info("COMPARISON: Harness vs Baseline")
    logger.info("=" * 70)

    logger.info(
        f"  Harness: {harness.get('llm_provider', '?')} — "
        f"{h_summary.get('total_rows', 0)} rows, "
        f"{h_summary.get('errors', 0)} errors"
    )
    logger.info(
        f"  Baseline: {baseline.get('llm_provider', '?')} — "
        f"{b_summary.get('total_rows', 0)} rows, "
        f"{b_summary.get('errors', 0)} errors"
    )
    logger.info("")

    header = f"{'Metric':<25} {'Harness':>10} {'Baseline':>10} {'Delta':>10}"
    logger.info(header)
    logger.info("-" * 55)

    metrics = [
        ("Factual accuracy", "factual_accuracy"),
        ("Completeness", "completeness"),
        ("Groundedness", "groundedness"),
        ("Avg latency (s)", "avg_latency_seconds"),
    ]

    def _print_metric_rows(h_data: dict, b_data: dict, metrics_list: list):
        for label, key in metrics_list:
            h_val = h_data.get(key, 0)
            b_val = b_data.get(key, 0)
            delta = h_val - b_val
            sign = "+" if delta > 0 else ""
            logger.info(
                f"{label:<25} {h_val:>10.3f} {b_val:>10.3f} {sign}{delta:>9.3f}"
            )

    _print_metric_rows(h_summary, b_summary, metrics)

    # Citation metrics only apply to harness
    logger.info("")
    logger.info("Citation metrics (harness only):")
    for label, key in CITATION_METRICS:
        logger.info(f"  {label:<23}{_fmt_cell(h_summary, key, 10)}")

    # Per-domain breakdown
    h_by_domain = harness.get("summary", {}).get("by_domain", {})
    b_by_domain = baseline.get("summary", {}).get("by_domain", {})
    all_domains = sorted(set(list(h_by_domain.keys()) + list(b_by_domain.keys())))

    if all_domains:
        logger.info("")
        logger.info("-" * 55)
        logger.info("BY DOMAIN")
        logger.info("-" * 55)

        for domain in all_domains:
            h_domain = h_by_domain.get(domain, {})
            b_domain = b_by_domain.get(domain, {})
            h_count = h_domain.get("count", 0)
            b_count = b_domain.get("count", 0)
            logger.info(f"\n  {domain} (harness: {h_count}, baseline: {b_count})")
            header = f"{'Metric':<25} {'Harness':>10} {'Baseline':>10} {'Delta':>10}"
            logger.info(header)
            _print_metric_rows(h_domain, b_domain, metrics)

    logger.info("=" * 70)

    if csv_path:
        write_comparison_csv(csv_path, harness, baseline)
        logger.info(f"Wrote comparison CSV: {csv_path}")


def print_all_providers_comparison(
    output_dir: str,
    dataset_path: str = "evals/eval_dataset.json",
    csv_path: Optional[str] = None,
):
    """Discover all provider variants in the results directory and print a cross-provider comparison.

    A variant is a (provider, fast) pair. Default and fast result files are
    treated as separate columns (e.g. `gemini` and `gemini_fast`).
    """
    variants = discover_provider_variants(output_dir)
    if not variants:
        logger.error(f"No result files found in {output_dir}")
        return

    # Load all available results, recomputing summaries from row data
    # to ensure consistent metrics even for older result files.
    # Keyed by variant label ("gemini", "gemini_fast", etc.).
    all_results: dict[str, dict] = {}
    for provider_name, fast in variants:
        label = variant_label(provider_name, fast)
        entry = {}
        for mode in ("harness", "baseline"):
            path = get_results_path(
                output_dir, provider_name, baseline=(mode == "baseline"), fast=fast
            )
            if os.path.exists(path):
                with open(path) as f:
                    data = json.load(f)
                rows = data.get("rows", [])
                if rows:
                    backfill_domains(rows, dataset_path)
                    summary = compute_summary(rows)
                    entry[mode] = summary.get("overall", {})
                    entry[f"{mode}_rows"] = summary.get("overall", {}).get(
                        "total_rows", 0
                    )
                    entry[f"{mode}_errors"] = summary.get("overall", {}).get(
                        "errors", 0
                    )
                    entry[f"{mode}_by_domain"] = summary.get("by_domain", {})
        if entry:
            all_results[label] = entry

    if not all_results:
        logger.error("No results with summary data found. Run grading first.")
        return

    # Build column list: each variant can have harness and/or baseline
    columns = []  # list of (column_label, variant_label, mode)
    for label in sorted(all_results.keys()):
        entry = all_results[label]
        if "harness" in entry:
            columns.append((label, label, "harness"))
        if "baseline" in entry:
            columns.append((f"{label}_base", label, "baseline"))

    col_width = max(len(c[0]) for c in columns) + 2
    col_width = max(col_width, 12)

    metrics = [
        ("Factual accuracy", "factual_accuracy"),
        ("Completeness", "completeness"),
        ("Groundedness", "groundedness"),
        ("Avg latency (s)", "avg_latency_seconds"),
    ]

    # Header
    logger.info("\n" + "=" * (25 + col_width * len(columns)))
    logger.info("CROSS-PROVIDER COMPARISON")
    logger.info("=" * (25 + col_width * len(columns)))

    # Row counts
    for col_label, provider_name, mode in columns:
        entry = all_results[provider_name]
        rows = entry.get(f"{mode}_rows", 0)
        errors = entry.get(f"{mode}_errors", 0)
        logger.info(f"  {col_label}: {rows} rows, {errors} errors")
    logger.info("")

    header = f"{'Metric':<25}" + "".join(f"{c[0]:>{col_width}}" for c in columns)
    logger.info(header)
    logger.info("-" * (25 + col_width * len(columns)))

    for label, key in metrics:
        line = f"{label:<25}"
        for _, provider_name, mode in columns:
            val = all_results[provider_name].get(mode, {}).get(key, 0)
            line += f"{val:>{col_width}.3f}"
        logger.info(line)

    logger.info("")
    logger.info("Citation metrics (harness only):")
    header = f"{'Metric':<25}" + "".join(
        f"{c[0]:>{col_width}}" for c in columns if c[2] == "harness"
    )
    logger.info(header)
    logger.info("-" * (25 + col_width * len([c for c in columns if c[2] == "harness"])))

    for label, key in CITATION_METRICS:
        line = f"{label:<25}"
        for col_label, provider_name, mode in columns:
            if mode != "harness":
                continue
            harness_data = all_results[provider_name].get("harness", {})
            line += _fmt_cell(harness_data, key, col_width)
        logger.info(line)

    # Per-domain breakdown
    all_domains = set()
    for entry in all_results.values():
        for mode in ("harness", "baseline"):
            all_domains.update(entry.get(f"{mode}_by_domain", {}).keys())
    all_domains = sorted(all_domains)

    if all_domains:
        logger.info("")
        logger.info("-" * (25 + col_width * len(columns)))
        logger.info("BY DOMAIN")
        logger.info("-" * (25 + col_width * len(columns)))

        for domain in all_domains:
            logger.info(f"\n  {domain}")
            header = f"{'Metric':<25}" + "".join(
                f"{c[0]:>{col_width}}" for c in columns
            )
            logger.info(header)

            for label, key in metrics:
                line = f"{label:<25}"
                for _, provider_name, mode in columns:
                    domain_data = (
                        all_results[provider_name]
                        .get(f"{mode}_by_domain", {})
                        .get(domain, {})
                    )
                    val = domain_data.get(key, 0)
                    line += f"{val:>{col_width}.3f}"
                logger.info(line)

    logger.info("=" * (25 + col_width * len(columns)))

    if csv_path:
        write_all_providers_csv(csv_path, all_results)
        logger.info(f"Wrote comparison CSV: {csv_path}")


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
        help="LLM provider: gemini, openai, cerebras, anthropic (default: gemini)",
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
        "--full",
        action="store_true",
        help="Run the entire dataset (default: sample 100 evenly-spaced rows)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Sample N evenly-spaced eval rows (default: 100, use --full for all)",
    )
    parser.add_argument(
        "--retries",
        type=int,
        default=3,
        help="Max retries per question on error (default: 3)",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=5,
        help="Number of questions to run in parallel per batch (default: 5)",
    )
    parser.add_argument(
        "--baseline",
        action="store_true",
        help="Run in baseline mode: send question + PDF directly to the LLM, "
        "bypassing the server's citation protocol and harness",
    )
    parser.add_argument(
        "--compare",
        action="store_true",
        help="Compare harness vs baseline results for the selected provider and exit",
    )
    parser.add_argument(
        "--output",
        default="evals/results",
        help="Output directory for results (default: evals/results)",
    )
    parser.add_argument(
        "--fast",
        action="store_true",
        help="Use the provider's fast model instead of its default model",
    )
    args = parser.parse_args()

    provider = parse_provider(args.provider) if args.provider else None
    provider_name = provider.value if provider else "gemini"
    model_type = ModelType.FAST if args.fast else ModelType.DEFAULT

    # Handle --compare: print comparison and exit
    if args.compare:
        os.makedirs(args.output, exist_ok=True)
        if args.provider:
            # Single provider: harness vs baseline
            harness_path = get_results_path(
                args.output, provider_name, baseline=False, fast=args.fast
            )
            baseline_path = get_results_path(
                args.output, provider_name, baseline=True, fast=args.fast
            )
            fast_suffix = "_fast" if args.fast else ""
            csv_path = os.path.join(
                args.output, f"comparison_{provider_name}{fast_suffix}.csv"
            )
            print_comparison(harness_path, baseline_path, csv_path=csv_path)
        else:
            # No provider specified: compare all available providers
            csv_path = os.path.join(args.output, "comparison_all.csv")
            print_all_providers_comparison(
                args.output, dataset_path=args.dataset, csv_path=csv_path
            )
        return

    # Resolve sample size: --full means no limit, --limit N overrides, default is 100
    if args.full:
        effective_limit = None
    elif args.limit is not None:
        effective_limit = args.limit
    else:
        effective_limit = 100

    mode_label = "BASELINE" if args.baseline else "HARNESS"
    if args.fast:
        mode_label += " (fast)"

    # Load dataset and manifest
    with open(args.dataset) as f:
        dataset = json.load(f)
    with open(args.manifest) as f:
        manifest = json.load(f)

    logger.info(
        f"[{mode_label}] Loaded dataset: {dataset['total_rows']} rows, "
        f"{dataset.get('total_papers_processed', '?')} papers"
    )

    # Load or create results file (stable path per provider for resumability)
    results_path = get_results_path(
        args.output, provider_name, baseline=args.baseline, fast=args.fast
    )
    results = load_results(results_path)
    results["llm_provider"] = provider_name
    results["model_type"] = model_type.value
    results["mode"] = "baseline" if args.baseline else "harness"
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

        if effective_limit == 0:
            logger.info("--limit 0: setup only, no questions to run.")
            return

        # Phase 2: Run eval questions (incremental, writes to disk per row)
        sample_label = (
            "all" if effective_limit is None else f"{effective_limit} sampled"
        )
        logger.info(
            f"Phase 2: Running eval questions ({mode_label}, {sample_label})..."
        )
        asyncio.run(
            run_eval_questions(
                db,
                current_user,
                dataset,
                url_to_paper_id,
                results,
                results_path,
                provider,
                effective_limit,
                max_retries=args.retries,
                baseline=args.baseline,
                batch_size=args.batch_size,
                model_type=model_type,
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
            baseline=args.baseline,
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
