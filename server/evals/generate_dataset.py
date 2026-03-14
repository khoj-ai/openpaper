"""
Eval dataset generation script for OpenPaper QA benchmark.

Reads the benchmark manifest (from collect_papers.py), downloads each paper's
PDF from S3, sends it to an LLM, and generates eval dataset rows with questions,
expected answers, and citation references.

Usage:
    cd server
    uv run python -m evals.generate_dataset [OPTIONS]
"""

import argparse
import json
import logging
import os
import sys
import time
from datetime import datetime, timezone
from typing import Optional

import boto3
from botocore.exceptions import ClientError
from dotenv import load_dotenv
from pydantic import BaseModel, Field

load_dotenv()

# Add server/ to path so we can import app modules
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.llm.base import BaseLLMClient
from app.llm.json_parser import JSONParser
from app.llm.provider import FileContent, TextContent

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

RATE_LIMIT_BETWEEN_PAPERS = 2.0  # seconds between LLM calls

# ---------------------------------------------------------------------------
# Pydantic schemas for structured LLM output
# ---------------------------------------------------------------------------


class LookupQuestion(BaseModel):
    question: str = Field(
        description="A factual question answerable by finding an exact passage in the paper"
    )
    expected_answer: str = Field(
        description="The correct answer, based on the paper's content"
    )
    expected_references: list[str] = Field(
        description="Exact verbatim quotes from the paper that answer the question"
    )


class ComprehensionQuestion(BaseModel):
    question: str = Field(
        description="An abstractive question about themes, methodology, implications, or critique"
    )
    expected_answer: str = Field(
        description="A well-reasoned answer drawing on the paper's content"
    )
    expected_references: list[str] = Field(
        description="Exact verbatim quotes from the paper supporting the answer"
    )
    judge_rubric: str = Field(
        description="3-5 evaluation criteria for an LLM judge to score answers on a 1-5 scale"
    )


class PaperChunk(BaseModel):
    section: str = Field(
        description="Paper section this chunk comes from, e.g. 'Results', 'Methods', 'Discussion'"
    )
    page_hint: Optional[int] = Field(
        default=None, description="Approximate page number where the chunk appears"
    )
    description: str = Field(description="Brief description of what this chunk covers")
    source_text: str = Field(description="50-300 word excerpt from the paper")
    lookup_question: LookupQuestion
    comprehension_question: ComprehensionQuestion


class PaperEvalGeneration(BaseModel):
    paper_id: str = Field(description="The OpenAlex ID of the paper")
    chunks: list[PaperChunk] = Field(
        description="3-5 interesting chunks from different sections of the paper"
    )


# ---------------------------------------------------------------------------
# Prompt constants
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """\
You are a meticulous research evaluation dataset generator. Your job is to read \
academic papers and produce high-quality question-answer pairs for evaluating a \
research paper QA system.

Your output must be valid JSON matching the provided schema. Every reference quote \
must be EXACTLY verbatim from the paper — do not paraphrase or alter quotes."""

USER_PROMPT_TEMPLATE = """\
Analyze this research paper and generate evaluation data.

Paper ID: {paper_id}

Instructions:
1. Identify 3-5 interesting chunks from DIFFERENT sections of the paper (e.g., \
abstract, introduction, methods, results, discussion, tables, figures).
2. Prefer chunks that contain specific data: statistics, numerical results, table \
entries, methodological details, or concrete findings.
3. For each chunk, generate:
   a) A **lookup question**: factual, specific, verifiable by finding the exact \
passage. The answer should be a concrete fact, number, or detail.
   b) A **comprehension question**: requires synthesis, critique, or understanding \
of implications. Think: "What does this mean?", "Why did they choose this?", \
"How does this compare?".
4. For BOTH question types, provide **expected_references** that are EXACT verbatim \
quotes (50-200 words each) from the paper. Copy the text character-for-character.
5. For comprehension questions, provide a **judge_rubric** with 3-5 criteria an \
LLM judge should use to evaluate answer quality on a 1-5 scale.

Return your response as JSON matching the schema."""

# ---------------------------------------------------------------------------
# S3 client
# ---------------------------------------------------------------------------


class BenchmarkS3:
    """Minimal S3 client for downloading benchmark PDFs."""

    def __init__(self, bucket_name: str):
        self.bucket_name = bucket_name
        self.client = boto3.client(
            "s3",
            aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID"),
            aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY"),
            region_name=os.environ.get("AWS_REGION", "us-east-1"),
        )

    def download(self, key: str) -> bytes:
        """Download an object from S3 and return its bytes."""
        response = self.client.get_object(Bucket=self.bucket_name, Key=key)
        return response["Body"].read()


# ---------------------------------------------------------------------------
# Dataset I/O helpers
# ---------------------------------------------------------------------------


def load_dataset(path: str) -> dict:
    """Load existing dataset or create a fresh one."""
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return {
        "version": "1.0",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "source_manifest": None,
        "total_rows": 0,
        "total_papers_processed": 0,
        "rows": [],
        "errors": [],
    }


def save_dataset(dataset: dict, path: str):
    """Atomically save dataset to disk."""
    dataset["total_rows"] = len(dataset["rows"])
    dataset["total_papers_processed"] = len(get_processed_paper_ids(dataset))

    tmp_path = path + ".tmp"
    with open(tmp_path, "w") as f:
        json.dump(dataset, f, indent=2)
    os.replace(tmp_path, path)


def get_processed_paper_ids(dataset: dict) -> set[str]:
    """Return set of paper IDs already processed (have rows in dataset)."""
    return {row["paper_id"] for row in dataset["rows"]}


# ---------------------------------------------------------------------------
# Paper processing
# ---------------------------------------------------------------------------


def process_paper(paper: dict, s3: BenchmarkS3, llm: BaseLLMClient) -> list[dict]:
    """
    Download a paper's PDF from S3, send to LLM, and return dataset rows.

    Returns a list of row dicts (lookup + comprehension per chunk).
    Raises on failure.
    """
    # Download PDF from S3
    pdf_bytes = s3.download(paper["s3_object_key"])

    # Build LLM request
    user_prompt = USER_PROMPT_TEMPLATE.format(paper_id=paper["openalex_id"])

    message_content = [
        FileContent(data=pdf_bytes, mime_type="application/pdf", filename="paper.pdf"),
        TextContent(text=user_prompt),
    ]

    schema = PaperEvalGeneration.model_json_schema()

    response = llm.generate_content(
        contents=message_content,
        system_prompt=SYSTEM_PROMPT,
        schema=schema,
        enable_thinking=False,
    )

    if not response or not response.text:
        raise ValueError("Empty response from LLM")

    # Parse response
    response_json = JSONParser.validate_and_extract_json(response.text)
    generation = PaperEvalGeneration.model_validate(response_json)

    # Convert to dataset rows
    rows = []
    oa_id_suffix = paper["openalex_id"].split("/")[-1]  # e.g. "W1234567890"

    for i, chunk in enumerate(generation.chunks):
        base = {
            "paper_id": paper["openalex_id"],
            "paper_doi": paper.get("doi"),
            "paper_s3_url": paper.get("s3_url"),
            "domain": paper.get("domain"),
            "metadata": {
                "page_hint": chunk.page_hint,
                "section": chunk.section,
                "chunk_description": chunk.description,
                "source_text": chunk.source_text,
            },
        }

        # Lookup row
        rows.append(
            {
                **base,
                "row_id": f"{oa_id_suffix}_chunk{i}_lookup",
                "question_type": "lookup",
                "question": chunk.lookup_question.question,
                "expected_answer": chunk.lookup_question.expected_answer,
                "expected_references": chunk.lookup_question.expected_references,
                "judge_rubric": None,
            }
        )

        # Comprehension row
        rows.append(
            {
                **base,
                "row_id": f"{oa_id_suffix}_chunk{i}_comprehension",
                "question_type": "comprehension",
                "question": chunk.comprehension_question.question,
                "expected_answer": chunk.comprehension_question.expected_answer,
                "expected_references": chunk.comprehension_question.expected_references,
                "judge_rubric": chunk.comprehension_question.judge_rubric,
            }
        )

    return rows


# ---------------------------------------------------------------------------
# Main generation loop
# ---------------------------------------------------------------------------


def generate_dataset(
    manifest_path: str,
    output_path: str,
    max_papers: Optional[int],
    domains: Optional[list[str]],
):
    """Main loop: iterate manifest papers, generate eval rows, save incrementally."""
    # Load manifest
    with open(manifest_path) as f:
        manifest = json.load(f)

    papers = manifest.get("papers", [])
    logger.info(f"Loaded manifest with {len(papers)} papers from {manifest_path}")

    # Filter by domain if specified
    if domains:
        papers = [p for p in papers if p.get("domain") in domains]
        logger.info(f"Filtered to {len(papers)} papers in domains: {domains}")

    # Load existing dataset for resumability
    dataset = load_dataset(output_path)
    dataset["source_manifest"] = manifest_path
    processed_ids = get_processed_paper_ids(dataset)
    errored_ids = {e["paper_id"] for e in dataset.get("errors", [])}

    # Filter out already-processed papers
    pending = [
        p
        for p in papers
        if p["openalex_id"] not in processed_ids and p["openalex_id"] not in errored_ids
    ]
    logger.info(
        f"{len(processed_ids)} papers already processed, "
        f"{len(errored_ids)} previously errored, "
        f"{len(pending)} papers remaining"
    )

    if max_papers is not None:
        pending = pending[:max_papers]
        logger.info(f"Limited to {len(pending)} papers (--max-papers {max_papers})")

    if not pending:
        logger.info("No papers to process. Done.")
        save_dataset(dataset, output_path)
        return

    # Initialize S3 and LLM
    bucket = os.environ.get("BENCHMARK_S3_BUCKET_NAME")
    if not bucket:
        logger.error("BENCHMARK_S3_BUCKET_NAME env var is required")
        sys.exit(1)

    s3 = BenchmarkS3(bucket)
    llm = BaseLLMClient()

    total_new_rows = 0

    for idx, paper in enumerate(pending):
        paper_id = paper["openalex_id"]
        title = paper.get("title", "Unknown")[:80]
        logger.info(f"[{idx + 1}/{len(pending)}] Processing: {title}")

        try:
            rows = process_paper(paper, s3, llm)
            dataset["rows"].extend(rows)
            total_new_rows += len(rows)
            logger.info(f"  Generated {len(rows)} rows ({len(rows) // 2} chunks)")
        except ClientError as e:
            error_msg = f"S3 download failed: {e}"
            logger.warning(f"  {error_msg}")
            dataset["errors"].append(
                {
                    "paper_id": paper_id,
                    "title": paper.get("title"),
                    "error": error_msg,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
            )
        except Exception as e:
            error_msg = str(e)
            logger.warning(f"  Failed: {error_msg}")
            dataset["errors"].append(
                {
                    "paper_id": paper_id,
                    "title": paper.get("title"),
                    "error": error_msg,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
            )

        # Save after each paper for resumability
        save_dataset(dataset, output_path)

        # Rate limit between papers
        if idx < len(pending) - 1:
            time.sleep(RATE_LIMIT_BETWEEN_PAPERS)

    logger.info(
        f"Generation complete. {total_new_rows} new rows from {len(pending)} papers. "
        f"Total rows: {dataset['total_rows']}. "
        f"Total papers: {dataset['total_papers_processed']}. "
        f"Errors: {len(dataset['errors'])}."
    )


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser(
        description="Generate eval dataset from benchmark papers",
    )
    parser.add_argument(
        "--manifest",
        default="evals/benchmark_manifest.json",
        help="Path to benchmark manifest JSON (default: evals/benchmark_manifest.json)",
    )
    parser.add_argument(
        "--output",
        default="evals/eval_dataset.json",
        help="Path to output dataset JSON (default: evals/eval_dataset.json)",
    )
    parser.add_argument(
        "--max-papers",
        type=int,
        default=None,
        help="Limit number of papers to process (for testing)",
    )
    parser.add_argument(
        "--domains",
        type=str,
        default=None,
        help="Comma-separated domain filter (e.g. machine_learning,biology)",
    )
    args = parser.parse_args()

    domain_list = None
    if args.domains:
        domain_list = [d.strip() for d in args.domains.split(",")]

    generate_dataset(
        manifest_path=args.manifest,
        output_path=args.output,
        max_papers=args.max_papers,
        domains=domain_list,
    )


if __name__ == "__main__":
    main()
