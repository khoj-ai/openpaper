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


class MultiHopQuestion(BaseModel):
    question: str = Field(
        description=(
            "A question that REQUIRES synthesizing information from >=2 distant sections "
            "of the paper. The answer must NOT be obtainable from any single passage. "
            "Examples: comparing a result to a stated baseline; checking whether a "
            "discussion caveat invalidates a headline claim; computing a derived "
            "quantity from numbers spread across methods + results + tables."
        )
    )
    expected_answer: str = Field(
        description="Reasoned answer that explicitly combines facts from each required section."
    )
    expected_references: list[str] = Field(
        description=(
            "Verbatim quotes (50-200 words each) drawn from the required sections. "
            "Provide one quote per required section, in the same order. Each quote "
            "must contribute a necessary piece of the answer."
        )
    )
    required_sections: list[str] = Field(
        description=(
            "Section labels the answer must draw on, e.g. ['Methods', 'Results', "
            "'Discussion']. Length MUST be >=2 and align 1:1 with expected_references."
        )
    )
    reasoning_chain: str = Field(
        description=(
            "One-sentence description of how the hops connect, e.g. 'Methods reports "
            "n=240; Table 3 reports effect=0.4; Discussion notes uncontrolled "
            "confounder X — combine to assess effective power.'"
        )
    )
    judge_rubric: str = Field(
        description=(
            "3-5 evaluation criteria for an LLM judge (1-5 scale). MUST include an "
            "explicit criterion: 'answer integrates information from each required "
            "section.'"
        )
    )


class AdversarialQuestion(BaseModel):
    question: str = Field(
        description=(
            "A question with a FALSE PREMISE about the paper, or asking about something "
            "the paper does NOT address. The question must sound plausible — a careless "
            "reader would not notice the issue. Examples: ask about a placebo arm when "
            "the design is single-arm; ask why authors used Bayesian methods when they "
            "used frequentist; ask about a population the paper explicitly excludes; "
            "ask about a metric the paper did not report."
        )
    )
    false_premise: str = Field(
        description=(
            "One sentence stating exactly what is wrong with the question, e.g. 'The "
            "study has no placebo arm — it is single-arm with historical controls.'"
        )
    )
    expected_answer: str = Field(
        description=(
            "The correct response: identify the false premise and/or state that the "
            "paper does not address the topic. May briefly cite what the paper "
            "actually says if it directly refutes the premise."
        )
    )
    expected_refusal: bool = Field(
        description=(
            "True when the correct behavior is to refuse to fabricate / decline to "
            "answer. Set False only if the paper directly addresses the question in "
            "an unexpected way (rare). Always provide a value."
        ),
    )
    expected_references: list[str] = Field(
        description=(
            "Usually an empty list. If the paper has a passage that DIRECTLY refutes "
            "the false premise, include it as a verbatim quote — the model should "
            "cite it when refusing. Otherwise return []."
        ),
    )
    judge_rubric: str = Field(
        description=(
            "3-5 evaluation criteria. MUST include: 'answer correctly identifies the "
            "false premise / refuses to fabricate' and 'no fabricated facts about "
            "topics the paper does not address.'"
        )
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
        description=(
            "3-5 interesting chunks from different sections of the paper. Return [] "
            "if Section A was not requested in the prompt."
        ),
    )
    multi_hop_questions: list[MultiHopQuestion] = Field(
        description=(
            "2-3 multi-hop questions requiring synthesis across distinct, distant "
            "sections. Return [] if Section B was not requested in the prompt."
        ),
    )
    adversarial_questions: list[AdversarialQuestion] = Field(
        description=(
            "2-3 adversarial questions with false premises or asking about topics "
            "the paper does not address. Return [] if Section C was not requested "
            "in the prompt."
        ),
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

PROMPT_INTRO = """\
Analyze this research paper and generate evaluation data.

Paper ID: {paper_id}

The output schema has three top-level lists: `chunks`, `multi_hop_questions`, \
and `adversarial_questions`. Generate ONLY the section(s) listed below. For \
sections NOT listed in this prompt, set the corresponding list to [] (empty array). \
Do not skip the field — always include all three keys, using [] for the ones you \
were not asked to populate."""

PROMPT_SECTION_CHUNKS = """\
Section A — Chunk-based question pairs (lookup + comprehension)
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
5. For comprehension questions, provide a **judge_rubric** with 3-5 criteria.
Output: populate the **chunks** list."""

PROMPT_SECTION_MULTI_HOP = """\
Section B — Multi-hop questions (2-3 per paper)
Generate questions that REQUIRE combining information from >=2 distinct, distant \
sections of the paper. The answer must NOT be derivable from any single passage. \
A reader who has only skimmed one section should not be able to answer. Good seeds:
   - Numerical: "Given X reported in Methods and Y reported in Table N, what is Z?"
   - Consistency: "Does the limitation in Discussion invalidate the claim in Abstract?"
   - Comparison: "How does the result in Section 4 compare to the baseline cited \
in Related Work?"
For each multi-hop question:
   - List **required_sections** (>=2).
   - Provide one verbatim **expected_reference** per required section, in matching order.
   - Write a **reasoning_chain** that spells out how the hops combine.
   - Include a **judge_rubric** with an explicit "integrates information from each \
required section" criterion.
Output: populate the **multi_hop_questions** list."""

PROMPT_SECTION_ADVERSARIAL = """\
Section C — Adversarial questions (2-3 per paper)
Generate questions with a FALSE PREMISE or about topics the paper does NOT address. \
The question must sound plausible — a careless reader would not catch the issue. \
Good seeds:
   - False methodology: ask about a control/placebo arm that doesn't exist
   - Wrong attribution: ask why the authors used a method they didn't use
   - Out-of-scope generalization: ask about a population the paper explicitly excludes
   - Nonexistent results: ask about a metric the paper did not report
For each adversarial question:
   - State the **false_premise** explicitly (one sentence).
   - Write the **expected_answer** as a refusal that names what's wrong.
   - Set **expected_refusal=True** unless the paper directly refutes the premise.
   - Only populate **expected_references** if the paper has a passage that DIRECTLY \
refutes the false premise (in which case the model should cite it when refusing).
   - Include a **judge_rubric** that rewards identifying the false premise and \
penalizes confident fabrication.
Output: populate the **adversarial_questions** list."""

PROMPT_OUTRO = """\
Return your response as JSON matching the schema. Every reference quote must be \
EXACTLY verbatim from the paper — do not paraphrase or alter quotes."""

ALL_SECTIONS = ("chunks", "multi_hop", "adversarial")
QUESTION_TYPE_TO_SECTION = {
    "lookup": "chunks",
    "comprehension": "chunks",
    "multi_hop": "multi_hop",
    "adversarial": "adversarial",
}

SECTION_PROMPTS = {
    "chunks": PROMPT_SECTION_CHUNKS,
    "multi_hop": PROMPT_SECTION_MULTI_HOP,
    "adversarial": PROMPT_SECTION_ADVERSARIAL,
}


def build_user_prompt(paper_id: str, sections_needed: set[str]) -> str:
    """Assemble the user prompt with only the requested section instructions."""
    parts = [PROMPT_INTRO.format(paper_id=paper_id)]
    for section in ALL_SECTIONS:
        if section in sections_needed:
            parts.append(SECTION_PROMPTS[section])
    parts.append(PROMPT_OUTRO)
    return "\n\n".join(parts)


def _strip_schema_defaults(schema):
    """Recursively remove `default` keys from a JSON schema dict.

    Gemini's structured-output API rejects non-null defaults in the response
    schema. Pydantic emits `default` for any field with a Field(default=...) or
    default_factory, so strip them all before sending.
    """
    if isinstance(schema, dict):
        schema.pop("default", None)
        for v in schema.values():
            _strip_schema_defaults(v)
    elif isinstance(schema, list):
        for item in schema:
            _strip_schema_defaults(item)
    return schema


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
            data = json.load(f)
        data.setdefault("errors", [])
        return data
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
    """Return set of paper IDs that have at least one row in the dataset."""
    return {row["paper_id"] for row in dataset["rows"]}


def get_existing_sections_by_paper(dataset: dict) -> dict[str, set[str]]:
    """Map paper_id -> set of section labels (chunks/multi_hop/adversarial) already present."""
    out: dict[str, set[str]] = {}
    for row in dataset["rows"]:
        section = QUESTION_TYPE_TO_SECTION.get(row.get("question_type"))
        if section:
            out.setdefault(row["paper_id"], set()).add(section)
    return out


def sections_needed_for_paper(existing_sections: set[str]) -> set[str]:
    """Return which sections still need to be generated for a paper."""
    return set(ALL_SECTIONS) - existing_sections


# ---------------------------------------------------------------------------
# Paper processing
# ---------------------------------------------------------------------------


def process_paper(
    paper: dict,
    s3: BenchmarkS3,
    llm: BaseLLMClient,
    sections_needed: set[str],
) -> list[dict]:
    """
    Download a paper's PDF from S3, send to LLM, and return dataset rows.

    Only generates rows for the requested sections (chunks / multi_hop /
    adversarial). Raises on failure.
    """
    if not sections_needed:
        return []

    # Download PDF from S3
    pdf_bytes = s3.download(paper["s3_object_key"])

    # Build LLM request
    user_prompt = build_user_prompt(paper["openalex_id"], sections_needed)

    message_content = [
        FileContent(data=pdf_bytes, mime_type="application/pdf", filename="paper.pdf"),
        TextContent(text=user_prompt),
    ]

    schema = _strip_schema_defaults(PaperEvalGeneration.model_json_schema())

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

    if "chunks" in sections_needed:
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

    # Multi-hop rows (paper-level, not tied to a single chunk)
    if "multi_hop" in sections_needed:
        for j, mh in enumerate(generation.multi_hop_questions):
            rows.append(
                {
                    "paper_id": paper["openalex_id"],
                    "paper_doi": paper.get("doi"),
                    "paper_s3_url": paper.get("s3_url"),
                    "domain": paper.get("domain"),
                    "metadata": {
                        "required_sections": mh.required_sections,
                        "reasoning_chain": mh.reasoning_chain,
                    },
                    "row_id": f"{oa_id_suffix}_multihop{j}",
                    "question_type": "multi_hop",
                    "question": mh.question,
                    "expected_answer": mh.expected_answer,
                    "expected_references": mh.expected_references,
                    "required_sections": mh.required_sections,
                    "reasoning_chain": mh.reasoning_chain,
                    "judge_rubric": mh.judge_rubric,
                }
            )

    # Adversarial rows
    if "adversarial" in sections_needed:
        for j, adv in enumerate(generation.adversarial_questions):
            rows.append(
                {
                    "paper_id": paper["openalex_id"],
                    "paper_doi": paper.get("doi"),
                    "paper_s3_url": paper.get("s3_url"),
                    "domain": paper.get("domain"),
                    "metadata": {
                        "false_premise": adv.false_premise,
                    },
                    "row_id": f"{oa_id_suffix}_adversarial{j}",
                    "question_type": "adversarial",
                    "question": adv.question,
                    "expected_answer": adv.expected_answer,
                    "expected_references": adv.expected_references,
                    "expected_refusal": adv.expected_refusal,
                    "false_premise": adv.false_premise,
                    "judge_rubric": adv.judge_rubric,
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
    existing_sections_by_paper = get_existing_sections_by_paper(dataset)
    errored_ids = {e["paper_id"] for e in dataset.get("errors", [])}

    # Compute pending: papers missing any section, excluding errored ones.
    # Each pending entry is (paper, sections_needed) — backfills only request
    # the missing sections, full-fresh papers request all of them.
    pending: list[tuple[dict, set[str]]] = []
    fully_processed = 0
    backfill_count = 0
    for p in papers:
        if p["openalex_id"] in errored_ids:
            continue
        existing = existing_sections_by_paper.get(p["openalex_id"], set())
        needed = sections_needed_for_paper(existing)
        if not needed:
            fully_processed += 1
            continue
        if existing:
            backfill_count += 1
        pending.append((p, needed))

    logger.info(
        f"{fully_processed} papers fully processed, "
        f"{len(errored_ids)} previously errored, "
        f"{backfill_count} papers need backfill, "
        f"{len(pending) - backfill_count} papers fresh, "
        f"{len(pending)} total remaining"
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

    for idx, (paper, needed) in enumerate(pending):
        paper_id = paper["openalex_id"]
        title = paper.get("title", "Unknown")[:80]
        sections_label = ",".join(s for s in ALL_SECTIONS if s in needed)
        is_backfill = bool(existing_sections_by_paper.get(paper_id))
        action = "Backfilling" if is_backfill else "Processing"
        logger.info(f"[{idx + 1}/{len(pending)}] {action} [{sections_label}]: {title}")

        try:
            rows = process_paper(paper, s3, llm, needed)
            dataset["rows"].extend(rows)
            total_new_rows += len(rows)
            logger.info(f"  Generated {len(rows)} rows for sections [{sections_label}]")
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
