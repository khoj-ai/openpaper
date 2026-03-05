"""
Benchmark paper collection script for OpenPaper QA eval.

Queries OpenAlex for open-access papers across diverse disciplines,
downloads PDFs, validates them, uploads to a dedicated S3 bucket,
and outputs a manifest JSON for downstream use.

Usage:
    cd server
    uv run python -m evals.collect_papers [OPTIONS]
"""

import argparse
import asyncio
import hashlib
import json
import logging
import os
import sys
import tempfile
import time
from datetime import datetime, timezone
from io import BytesIO
from typing import Optional

import boto3
import requests
from botocore.exceptions import ClientError
from dotenv import load_dotenv
from PyPDF2 import PdfReader

load_dotenv()

# Add server/ to path so we can import app modules
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.helpers.paper_search import (
    OpenAlexFilter,
    OpenAlexWork,
    extract_doi_from_url,
    search_open_alex,
)
from app.helpers.parser import validate_pdf_content

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Domain queries
# ---------------------------------------------------------------------------

DOMAIN_QUERIES: dict[str, list[str]] = {
    "machine_learning": [
        "deep learning transformer architecture",
        "reinforcement learning policy optimization",
        "large language model evaluation benchmark",
    ],
    "biology": [
        "CRISPR gene editing therapeutic applications",
        "single cell RNA sequencing analysis",
        "protein structure prediction machine learning",
    ],
    "economics": [
        "causal inference policy evaluation",
        "school choice economic outcomes",
        "income inequality economic mobility",
    ],
    "psychology": [
        "cognitive behavioral therapy effectiveness",
        "social media mental health adolescents",
        "implicit bias measurement intervention",
    ],
    "education": [
        "online learning outcomes effectiveness",
        "STEM education gender equity",
        "formative assessment student achievement",
    ],
    "environmental_science": [
        "climate change biodiversity loss",
        "microplastics environmental contamination",
        "renewable energy grid integration",
    ],
    "public_health": [
        "vaccine hesitancy public trust",
        "air pollution respiratory disease",
        "health disparities social determinants",
    ],
    "social_science": [
        "misinformation spread social networks",
        "immigration policy public opinion",
        "urban segregation neighborhood effects",
    ],
    "mathematics": [
        "graph neural network combinatorial optimization",
        "topological data analysis applications",
        "differential equations numerical methods",
    ],
    "history_humanities": [
        "digital humanities text mining",
        "colonial archives postcolonial critique",
        "cultural heritage preservation technology",
    ],
}

# ---------------------------------------------------------------------------
# PDF download helpers
# ---------------------------------------------------------------------------

PDF_DOWNLOAD_HEADERS = {
    "User-Agent": (
        "OpenPaper-BenchmarkCollector/1.0 "
        "(https://openpaper.ai; mailto:saba@openpaper.ai) "
        "research-benchmark-collection"
    ),
    "Accept": "application/pdf,*/*",
}

RATE_LIMIT_BETWEEN_DOWNLOADS = 1.0  # seconds between PDF download attempts
RATE_LIMIT_BETWEEN_QUERIES = 0.5  # seconds between OpenAlex queries


def _is_pdf_bytes(data: bytes) -> bool:
    """Check if data starts with PDF magic bytes."""
    return data[:5] == b"%PDF-"


def _download_pdf_from_url(url: str, timeout: int = 30) -> Optional[bytes]:
    """Download PDF from a URL, returning bytes if valid PDF, else None."""
    try:
        resp = requests.get(
            url, headers=PDF_DOWNLOAD_HEADERS, timeout=timeout, allow_redirects=True
        )
        resp.raise_for_status()
        if _is_pdf_bytes(resp.content):
            return resp.content
        logger.debug(
            f"Response from {url} is not a PDF (first bytes: {resp.content[:20]})"
        )
        return None
    except requests.RequestException as e:
        logger.debug(f"Failed to download from {url}: {e}")
        return None


def download_pdf(work: OpenAlexWork) -> tuple[Optional[bytes], str]:
    """
    Try to download PDF for an OpenAlex work using fallback chain:
    1. primary_location.pdf_url
    2. open_access.oa_url
    3. Unpaywall API

    Returns (pdf_bytes, source_type) or (None, "") on failure.
    """
    # Strategy 1: Direct PDF URL
    if work.primary_location and work.primary_location.pdf_url:
        url = work.primary_location.pdf_url
        pdf_bytes = _download_pdf_from_url(url)
        if pdf_bytes:
            return pdf_bytes, "pdf_url"
        logger.debug(f"pdf_url failed for {work.id}: {url}")

    # Strategy 2: OA URL (may be landing page, but sometimes direct PDF)
    if work.open_access and work.open_access.oa_url:
        url = work.open_access.oa_url
        pdf_bytes = _download_pdf_from_url(url)
        if pdf_bytes:
            return pdf_bytes, "oa_url"
        logger.debug(f"oa_url failed for {work.id}: {url}")

    # Strategy 3: Unpaywall API
    doi = None
    if work.doi:
        doi = extract_doi_from_url(work.doi)
    if doi:
        try:
            unpaywall_url = (
                f"https://api.unpaywall.org/v2/{doi}?email=saba@openpaper.ai"
            )
            resp = requests.get(unpaywall_url, timeout=15, headers=PDF_DOWNLOAD_HEADERS)
            if resp.status_code == 200:
                data = resp.json()
                best = data.get("best_oa_location") or {}
                pdf_link = best.get("url_for_pdf")
                if pdf_link:
                    pdf_bytes = _download_pdf_from_url(pdf_link)
                    if pdf_bytes:
                        return pdf_bytes, "unpaywall"
        except Exception as e:
            logger.debug(f"Unpaywall fallback failed for {work.id}: {e}")

    return None, ""


# ---------------------------------------------------------------------------
# Benchmark S3 client
# ---------------------------------------------------------------------------


class BenchmarkS3:
    """Minimal S3 client for uploading benchmark PDFs to a dedicated bucket."""

    def __init__(self, bucket_name: str):
        self.bucket_name = bucket_name
        self.client = boto3.client(
            "s3",
            aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID"),
            aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY"),
            region_name=os.environ.get("AWS_REGION", "us-east-1"),
        )

    def upload(self, key: str, data: bytes) -> str:
        """Upload bytes to S3 and return the object URL."""
        self.client.put_object(
            Bucket=self.bucket_name,
            Key=key,
            Body=data,
            ContentType="application/pdf",
        )
        region = os.environ.get("AWS_REGION", "us-east-1")
        return f"https://{self.bucket_name}.s3.{region}.amazonaws.com/{key}"


# ---------------------------------------------------------------------------
# Manifest helpers
# ---------------------------------------------------------------------------


def load_manifest(path: str) -> dict:
    """Load existing manifest or create a fresh one."""
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return {
        "version": "1.0",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "total_papers": 0,
        "domains": {},
        "papers": [],
        "errors": [],
    }


def save_manifest(manifest: dict, path: str):
    """Atomically save manifest to disk."""
    manifest["total_papers"] = len(manifest["papers"])
    # Recount domain totals
    domain_counts: dict[str, int] = {}
    for p in manifest["papers"]:
        d = p["domain"]
        domain_counts[d] = domain_counts.get(d, 0) + 1
    manifest["domains"] = domain_counts

    tmp_path = path + ".tmp"
    with open(tmp_path, "w") as f:
        json.dump(manifest, f, indent=2)
    os.replace(tmp_path, path)


def get_collected_ids(manifest: dict) -> set[str]:
    """Return set of OpenAlex IDs already collected."""
    return {p["openalex_id"] for p in manifest["papers"]}


def get_errored_ids(manifest: dict) -> set[str]:
    """Return set of OpenAlex IDs that previously errored."""
    return {e["openalex_id"] for e in manifest["errors"]}


# ---------------------------------------------------------------------------
# Validation wrapper
# ---------------------------------------------------------------------------


def validate_pdf(pdf_bytes: bytes) -> tuple[bool, str]:
    """Synchronous wrapper around the async validate_pdf_content."""
    return asyncio.run(validate_pdf_content(pdf_bytes, source="benchmark"))


def get_page_count(pdf_bytes: bytes) -> int:
    """Extract page count from PDF bytes."""
    reader = PdfReader(BytesIO(pdf_bytes))
    return len(reader.pages)


# ---------------------------------------------------------------------------
# Paper metadata extraction
# ---------------------------------------------------------------------------


def extract_paper_metadata(
    work: OpenAlexWork,
    domain: str,
    query: str,
    pdf_bytes: bytes,
    pdf_source_url: str,
    pdf_source_type: str,
    s3_key: str,
    s3_url: str,
) -> dict:
    """Build a manifest entry dict from an OpenAlexWork and download info."""
    authors = []
    if work.authorships:
        for a in work.authorships:
            if a.author and a.author.display_name:
                authors.append(a.author.display_name)

    topics = []
    if work.topics:
        for t in work.topics:
            topics.append(
                {
                    "display_name": t.display_name,
                    "field": t.field.display_name if t.field else None,
                    "subfield": t.subfield.display_name if t.subfield else None,
                    "domain": t.domain.display_name if t.domain else None,
                }
            )

    journal = None
    if work.primary_location and work.primary_location.source:
        journal = work.primary_location.source.display_name

    doi = None
    if work.doi:
        doi = extract_doi_from_url(work.doi) or work.doi

    sha256 = hashlib.sha256(pdf_bytes).hexdigest()

    return {
        "openalex_id": work.id,
        "doi": doi,
        "title": work.title,
        "abstract": work.abstract or "",
        "authors": authors,
        "publication_date": work.publication_date,
        "publication_year": work.publication_year,
        "cited_by_count": work.cited_by_count or 0,
        "domain": domain,
        "search_query": query,
        "topics": topics,
        "journal": journal,
        "pdf_source_url": pdf_source_url,
        "pdf_source_type": pdf_source_type,
        "s3_object_key": s3_key,
        "s3_url": s3_url,
        "page_count": get_page_count(pdf_bytes),
        "file_size_bytes": len(pdf_bytes),
        "sha256": sha256,
        "collected_at": datetime.now(timezone.utc).isoformat(),
    }


# ---------------------------------------------------------------------------
# Main collection logic
# ---------------------------------------------------------------------------

MAX_PAGES_PER_QUERY = 10  # Up to 10 pages per query (250 results max)


def iter_candidate_papers(
    domain: str,
    queries: list[str],
    skip_ids: set[str],
):
    """
    Generator that lazily yields (work, domain, query) candidates from OpenAlex.

    Iterates through all queries and pages, skipping already-seen IDs.
    The caller controls when to stop pulling.
    """
    seen_ids: set[str] = set()

    oa_filter = OpenAlexFilter(
        only_oa=True,
        from_publication_date="2018-01-01",
        min_cited_by_count=10,
    )

    for query in queries:
        for page in range(1, MAX_PAGES_PER_QUERY + 1):
            try:
                response = search_open_alex(
                    search_term=query,
                    filter=oa_filter,
                    page=page,
                    sort="cited_by_count:desc",
                )
            except Exception as e:
                logger.warning(f"Search failed for '{query}' page {page}: {e}")
                break

            if not response.results:
                break

            for work in response.results:
                if work.id in skip_ids or work.id in seen_ids:
                    continue
                has_pdf_source = (
                    (work.primary_location and work.primary_location.pdf_url)
                    or (work.open_access and work.open_access.oa_url)
                    or work.doi
                )
                if not has_pdf_source:
                    continue
                seen_ids.add(work.id)
                yield work, domain, query

            time.sleep(RATE_LIMIT_BETWEEN_QUERIES)


def collect_papers(
    manifest_path: str,
    target_per_domain: int,
    dry_run: bool,
    domains: Optional[list[str]],
):
    """Main collection loop."""
    manifest = load_manifest(manifest_path)
    collected_ids = get_collected_ids(manifest)
    errored_ids = get_errored_ids(manifest)

    # Determine which domains to process
    active_domains = domains if domains else list(DOMAIN_QUERIES.keys())
    for d in active_domains:
        if d not in DOMAIN_QUERIES:
            logger.error(
                f"Unknown domain: {d}. Available: {list(DOMAIN_QUERIES.keys())}"
            )
            sys.exit(1)

    # Initialize S3 if not dry run
    s3: Optional[BenchmarkS3] = None
    if not dry_run:
        bucket = os.environ.get("BENCHMARK_S3_BUCKET_NAME")
        if not bucket:
            logger.error(
                "BENCHMARK_S3_BUCKET_NAME env var is required (unless --dry-run)"
            )
            sys.exit(1)
        s3 = BenchmarkS3(bucket)

    # Count how many we already have per domain
    domain_counts: dict[str, int] = {}
    for p in manifest["papers"]:
        d = p["domain"]
        domain_counts[d] = domain_counts.get(d, 0) + 1

    total_new = 0

    for domain in active_domains:
        existing = domain_counts.get(domain, 0)
        needed = target_per_domain - existing
        if needed <= 0:
            logger.info(
                f"[{domain}] Already have {existing}/{target_per_domain} papers, skipping"
            )
            continue

        logger.info(
            f"[{domain}] Need {needed} more papers (have {existing}/{target_per_domain})"
        )
        queries = DOMAIN_QUERIES[domain]

        skip_ids = collected_ids | errored_ids
        candidates = iter_candidate_papers(domain, queries, skip_ids)

        if dry_run:
            count = 0
            for work, _, query in candidates:
                logger.info(f"  [DRY RUN] {work.title[:80]} (query: {query})")
                count += 1
                if count >= needed:
                    break
            continue

        collected_this_domain = 0
        for work, dom, query in candidates:
            if collected_this_domain >= needed:
                break

            logger.info(f"  Downloading: {work.title[:80]}...")

            # Download PDF
            pdf_bytes, source_type = download_pdf(work)
            if not pdf_bytes:
                error_entry = {
                    "openalex_id": work.id,
                    "title": work.title,
                    "domain": dom,
                    "error": "All PDF download strategies failed",
                }
                manifest["errors"].append(error_entry)
                errored_ids.add(work.id)
                save_manifest(manifest, manifest_path)
                logger.warning(f"  Failed to download PDF for: {work.title[:60]}")
                time.sleep(RATE_LIMIT_BETWEEN_DOWNLOADS)
                continue

            # Validate PDF
            is_valid, error_msg = validate_pdf(pdf_bytes)
            if not is_valid:
                error_entry = {
                    "openalex_id": work.id,
                    "title": work.title,
                    "domain": dom,
                    "error": f"PDF validation failed: {error_msg}",
                }
                manifest["errors"].append(error_entry)
                errored_ids.add(work.id)
                save_manifest(manifest, manifest_path)
                logger.warning(
                    f"  PDF validation failed for: {work.title[:60]} - {error_msg}"
                )
                time.sleep(RATE_LIMIT_BETWEEN_DOWNLOADS)
                continue

            # Extract OpenAlex ID suffix for S3 key
            oa_id = work.id.split("/")[-1]  # e.g. "W1234567890"
            s3_key = f"op-evals/benchmark/{oa_id}.pdf"

            # Upload to S3
            try:
                s3_url = None
                if s3:
                    s3_url = s3.upload(s3_key, pdf_bytes)
            except (ClientError, Exception) as e:
                error_entry = {
                    "openalex_id": work.id,
                    "title": work.title,
                    "domain": dom,
                    "error": f"S3 upload failed: {str(e)}",
                }
                manifest["errors"].append(error_entry)
                errored_ids.add(work.id)
                save_manifest(manifest, manifest_path)
                logger.error(f"  S3 upload failed for: {work.title[:60]} - {e}")
                time.sleep(RATE_LIMIT_BETWEEN_DOWNLOADS)
                continue

            if not s3_url:
                error_entry = {
                    "openalex_id": work.id,
                    "title": work.title,
                    "domain": dom,
                    "error": "S3 upload failed with unknown error",
                }
                manifest["errors"].append(error_entry)
                errored_ids.add(work.id)
                save_manifest(manifest, manifest_path)
                logger.error(
                    f"  S3 upload failed for: {work.title[:60]} - unknown error"
                )
                time.sleep(RATE_LIMIT_BETWEEN_DOWNLOADS)
                continue

            # Determine source URL
            pdf_source_url = ""
            if source_type == "pdf_url" and work.primary_location:
                pdf_source_url = work.primary_location.pdf_url or ""
            elif source_type == "oa_url" and work.open_access:
                pdf_source_url = work.open_access.oa_url or ""
            elif source_type == "unpaywall":
                pdf_source_url = f"unpaywall:{work.doi}"

            # Build manifest entry
            entry = extract_paper_metadata(
                work=work,
                domain=dom,
                query=query,
                pdf_bytes=pdf_bytes,
                pdf_source_url=pdf_source_url,
                pdf_source_type=source_type,
                s3_key=s3_key,
                s3_url=s3_url,
            )
            manifest["papers"].append(entry)
            collected_ids.add(work.id)
            collected_this_domain += 1
            total_new += 1
            save_manifest(manifest, manifest_path)
            logger.info(
                f"  Collected ({collected_this_domain}/{needed}): {work.title[:60]}"
            )

            time.sleep(RATE_LIMIT_BETWEEN_DOWNLOADS)

        domain_total = domain_counts.get(domain, 0) + collected_this_domain
        logger.info(f"[{domain}] Done. Total: {domain_total}/{target_per_domain}")

    save_manifest(manifest, manifest_path)
    logger.info(
        f"Collection complete. {total_new} new papers collected. "
        f"Total in manifest: {manifest['total_papers']}. "
        f"Errors: {len(manifest['errors'])}."
    )


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser(
        description="Collect benchmark papers for OpenPaper QA eval",
    )
    parser.add_argument(
        "--manifest",
        default="evals/benchmark_manifest.json",
        help="Path to manifest JSON file (default: evals/benchmark_manifest.json)",
    )
    parser.add_argument(
        "--target-per-domain",
        type=int,
        default=25,
        help="Number of papers to collect per domain (default: 25)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Search only, no download or upload",
    )
    parser.add_argument(
        "--domains",
        type=str,
        default=None,
        help="Comma-separated list of domains to collect (default: all)",
    )
    args = parser.parse_args()

    domain_list = None
    if args.domains:
        domain_list = [d.strip() for d in args.domains.split(",")]

    collect_papers(
        manifest_path=args.manifest,
        target_per_domain=args.target_per_domain,
        dry_run=args.dry_run,
        domains=domain_list,
    )


if __name__ == "__main__":
    main()
