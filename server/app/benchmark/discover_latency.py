from dotenv import load_dotenv
load_dotenv()

import json
import re
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import unquote

import requests

from app.helpers.exa_search import search_exa
from app.helpers.paper_search import extract_doi_from_url, get_doi, get_work_by_doi

BENCHMARK_DIR = Path(__file__).resolve().parent

QUERIES = [
    "Human-AI interaction",
    "Reinforcement learning and games"
]


def get_doi_from_url(url: str) -> str | None:
    """
    Get DOI from a publisher or paper URL.
    Tries embedded DOI first, then known publisher URL patterns (Nature, MDPI, arXiv).
    """
    if not url or not url.strip():
        return None
    
    # Normalize the URL before parsing the DOI
    url = unquote(url.strip())

    # URL already contains a DOI
    doi = extract_doi_from_url(url)
    if doi:
        return doi

    # Nature: .../articles/<slug>  ->  10.1038/<slug>
    match = re.search(r"nature\.com/articles/([^/?\s]+)", url)
    if match:
        return f"10.1038/{match.group(1)}"

    # MDPI: .../ISSN/vol/issue/article  ->  10.3390/<abbrev><vol><issue><article>
    match = re.search(r"mdpi\.com/(\d{4}-\d{4})/(\d+)/(\d+)/(\d+)", url)
    if match:
        issn, vol, issue, art = match.groups()
        mdpi_suffix = {
            "2076-3417": "app",
            "2075-5309": "buildings",
            "1999-4907": "f",
            "2227-7390": "mathematics",
            "1422-0067": "ijms",
            "2072-6643": "nu",
            "2073-4395": "agronomy",
            "2071-1050": "su",
            "2076-2615": "animals",
            "2079-9292": "electronics",
        }
        abbrev = mdpi_suffix.get(issn)
        if abbrev:
            return f"10.3390/{abbrev}{vol}{issue}{art}"

    # arXiv: .../abs/2510.17753 or .../pdf/2405.15051  ->  10.48550/arXiv.2510.17753
    match = re.search(r"arxiv\.org/(?:abs|pdf)/(\d{4}\.\d{4,5})", url)
    if match:
        return f"10.48550/arXiv.{match.group(1)}"

    # ScienceDirect PII: .../pii/<PII>  ->  10.1016/<PII> or lookup via Crossref alternative-id
    match = re.search(r"sciencedirect\.com/science/article/pii/([A-Z0-9()\-]+)", url, re.IGNORECASE)
    if match:
        pii = match.group(1)
        candidate_doi = f"10.1016/{pii}"
        try:
            r = requests.head(
                f"https://doi.org/{candidate_doi}",
                allow_redirects=True,
                timeout=5,
                headers={"User-Agent": "OpenPaperBenchmark/1.0 (https://github.com/openpaper)"},
            )
            if r.ok or 300 <= r.status_code < 400:
                return candidate_doi
        except requests.RequestException:
            pass
        # Crossref stores PII as alternative-id; look up DOI
        try:
            cr = requests.get(
                "https://api.crossref.org/works",
                params={"filter": f"alternative-id:{pii}", "rows": 1},
                timeout=10,
                headers={"User-Agent": "OpenPaperBenchmark/1.0 (https://github.com/openpaper)"},
            )
            if cr.ok:
                items = cr.json().get("message", {}).get("items", [])
                if items and items[0].get("DOI"):
                    return items[0]["DOI"]
        except requests.RequestException:
            pass
        return candidate_doi

    return None


def _work_to_openalex_result_dict(work) -> dict:
    """Convert OpenAlex work to OpenAlexResult-shaped dict (authors, cited_by_count, text, etc.)."""
    authors = []
    institutions_set = set()
    if work.authorships:
        for a in work.authorships:
            if a.author and a.author.display_name:
                authors.append(a.author.display_name)
            if a.institutions:
                for inst in a.institutions:
                    if inst.display_name:
                        institutions_set.add(inst.display_name)
    source = None
    if work.primary_location and work.primary_location.source:
        source = work.primary_location.source.display_name
    url = ""
    if work.primary_location and work.primary_location.landing_page_url:
        url = work.primary_location.landing_page_url
    elif work.doi:
        url = work.doi if work.doi.startswith("http") else f"https://doi.org/{work.doi}"
    else:
        url = work.id or ""
    return {
        "title": (work.title or "").strip(),
        "url": url,
        "authors": authors,
        "published_date": work.publication_date,
        "text": work.abstract,
        "highlights": [],
        "highlight_scores": [],
        "favicon": None,
        "cited_by_count": work.cited_by_count,
        "source": source,
        "institutions": list(institutions_set),
    }


def _exa_to_openalex_result_dict(result) -> dict:
    """Map EXA result to OpenAlexResult-shaped dict."""
    return {
        "title": result.title,
        "url": result.url,
        "authors": result.authors or [],
        "published_date": result.published_date,
        "text": result.text,
        "highlights": result.highlights or [],
        "highlight_scores": result.highlight_scores or [],
        "favicon": result.favicon,
        "cited_by_count": None,
        "source": None,
        "institutions": [],
    }


def _enrich_one_result(result) -> dict:
    """Resolve DOI and enrich one EXA result (work unit for parallel execution)."""
    doi = get_doi_from_url(result.url)
    if not doi:
        doi = get_doi(result.title, result.authors)
    work = get_work_by_doi(doi) if doi else None
    if work and work.title and work.title.strip():
        return _work_to_openalex_result_dict(work)
    return _exa_to_openalex_result_dict(result)


def benchmark_exa_only_latency(query: str):
    start_time = time.time()
    results = search_exa(query)
    end_time = time.time()
    print(json.dumps([r.to_dict() for r in results], indent=2))
    with open(BENCHMARK_DIR / f"exa_results_{query}.json", "w") as f:
        json.dump([r.to_dict() for r in results], f, indent=2)
    return end_time - start_time

def benchmark_openalex_exa_latency(query: str):
    start_time = time.time()
    results = search_exa(query)

    # Enrich in parallel (one task per Exa result), preserve order
    max_workers = min(10, len(results)) if results else 1
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        enriched_results = list(executor.map(_enrich_one_result, results))

    end_time = time.time()

    with open(BENCHMARK_DIR / f"openalex_exa_results_{query}.json", "w") as f:
        json.dump(enriched_results, f, indent=2)

    print(json.dumps(enriched_results, indent=2))
    return end_time - start_time

if __name__ == "__main__":
    latency_exa_only = benchmark_exa_only_latency(QUERIES[0])
    print(f"Latency exa only: {latency_exa_only} seconds")
    latency_openalex_exa = benchmark_openalex_exa_latency(QUERIES[0])
    print(f"Latency openalex exa: {latency_openalex_exa} seconds")
    