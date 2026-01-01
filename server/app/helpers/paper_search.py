import logging
import os
import re
import time
from enum import Enum
from typing import List, Optional
from urllib.parse import quote, unquote

import requests
from app.schemas.paper import EnrichedData
from pydantic import BaseModel, ConfigDict, model_validator

logger = logging.getLogger(__name__)

OPENALEX_MAX_RETRIES = 3
OPENALEX_RETRY_DELAY = 1  # seconds


def _request_with_retry(
    url: str,
    method: str = "GET",
    max_retries: int = OPENALEX_MAX_RETRIES,
    retry_delay: float = OPENALEX_RETRY_DELAY,
    timeout: int = 10,
) -> requests.Response:
    """
    Make an HTTP request with automatic retry on failure.

    Args:
        url: The URL to request.
        method: HTTP method (GET, POST, etc.).
        max_retries: Maximum number of retry attempts.
        retry_delay: Delay between retries in seconds.
        timeout: Request timeout in seconds.

    Returns:
        requests.Response: The response object.

    Raises:
        requests.RequestException: If all retries fail.
    """
    last_exception = None

    for attempt in range(max_retries):
        try:
            response = requests.request(method, url, timeout=timeout)
            response.raise_for_status()
            return response
        except requests.RequestException as e:
            last_exception = e
            if attempt < max_retries - 1:
                logger.warning(
                    f"OpenAlex API request failed (attempt {attempt + 1}/{max_retries}): {e}. "
                    f"Retrying in {retry_delay}s..."
                )
                time.sleep(retry_delay)
            else:
                logger.error(
                    f"OpenAlex API request failed after {max_retries} attempts: {e}"
                )

    raise last_exception  # type: ignore


SEMANTIC_SCHOLAR_API_KEY = os.getenv("SEMANTIC_SCHOLAR_API_KEY")

DISABLE_SEMANTIC_SCHOLAR = (
    True  # Temporary flag to disable Semantic Scholar API calls due to 403 errors
)


class OAStatus(str, Enum):
    """
    Enum for OpenAlex OA status.
    """

    DIAMOND = "diamond"
    GOLDEN = "gold"
    GREEN = "green"
    HYBRID = "hybrid"
    BRONZE = "bronze"
    CLOSED = "closed"


class BaseOpenAlexModel(BaseModel):
    model_config = ConfigDict(extra="ignore")


class OpenAccess(BaseOpenAlexModel):
    is_oa: bool
    oa_status: Optional[OAStatus] = None
    oa_url: Optional[str] = None


class Keyword(BaseOpenAlexModel):
    id: str
    display_name: str
    score: Optional[float] = None


class PrimaryLocationSource(BaseOpenAlexModel):
    id: Optional[str] = None
    display_name: Optional[str] = None
    type: Optional[str] = None
    issn_l: Optional[str] = None
    issn: Optional[List[str]] = None
    host_organization: Optional[str] = None


class PrimaryLocation(BaseOpenAlexModel):
    is_oa: Optional[bool] = None
    landing_page_url: Optional[str] = None
    pdf_url: Optional[str] = None
    source: Optional[PrimaryLocationSource] = None


class Biblio(BaseOpenAlexModel):
    volume: Optional[str] = None
    issue: Optional[str] = None
    first_page: Optional[str] = None
    last_page: Optional[str] = None


class SubTopic(BaseOpenAlexModel):
    id: str
    display_name: str


class Topic(BaseOpenAlexModel):
    id: str
    display_name: Optional[str] = None
    score: Optional[float] = None
    subfield: Optional[SubTopic] = None
    field: Optional[SubTopic] = None
    domain: Optional[SubTopic] = None


class Author(BaseOpenAlexModel):
    id: Optional[str] = None
    display_name: Optional[str] = None
    orcid: Optional[str] = None


class Institution(BaseOpenAlexModel):
    id: Optional[str] = None
    display_name: Optional[str] = None
    ror: Optional[str] = None
    country_code: Optional[str] = None
    type: Optional[str] = None


class Authorship(BaseOpenAlexModel):
    author_position: Optional[str] = None
    author: Optional[Author] = None
    institutions: Optional[List[Institution]] = None


class OpenAlexWork(BaseOpenAlexModel):
    id: str
    title: str
    doi: Optional[str] = None
    display_name: Optional[str] = None
    publication_year: Optional[int] = None
    publication_date: Optional[str] = None
    type: Optional[str] = None
    open_access: Optional[OpenAccess] = None
    keywords: Optional[List[Keyword]] = None
    primary_location: Optional[PrimaryLocation] = None
    biblio: Optional[Biblio] = None
    topics: Optional[List[Topic]] = None
    authorships: Optional[List[Authorship]] = None
    cited_by_count: Optional[int] = None
    abstract_inverted_index: Optional[dict] = None
    abstract: Optional[str] = None

    @model_validator(mode="before")
    @classmethod
    def validate_work(cls, data):
        if "abstract_inverted_index" in data and data["abstract_inverted_index"]:
            data["abstract"] = build_abstract_from_inverted_index(
                data["abstract_inverted_index"]
            )
        return data


class OpenAlexResponse(BaseModel):
    meta: dict
    results: List[OpenAlexWork]

    @model_validator(mode="before")
    @classmethod
    def validate_results(cls, data):
        if "results" in data:
            valid_results = []
            for item in data["results"]:
                try:
                    valid_results.append(OpenAlexWork(**item))
                except Exception as e:
                    logger.debug(f"Skipping invalid OpenAlex work entry: {e}")

            data["results"] = valid_results
        return data


class OpenAlexCitationGraph(BaseModel):
    center: OpenAlexWork
    cites: OpenAlexResponse
    cited_by: OpenAlexResponse

    @model_validator(mode="before")
    @classmethod
    def validate_citation_graph(cls, data):
        if "cites" in data:
            data["cites"] = OpenAlexResponse(**data["cites"])
        if "cited_by" in data:
            data["cited_by"] = OpenAlexResponse(**data["cited_by"])
        return data


class OpenAlexFilter(BaseModel):
    authors: Optional[List[str]] = None
    institutions: Optional[List[str]] = None
    only_oa: bool = False


def construct_open_alex_filter_url(filter: OpenAlexFilter) -> str:
    """
    Construct a filter URL for OpenAlex API based on provided filters.

    Args:
        filter (OpenAlexFilter): The filter object containing authors and institutions.

    Returns:
        str: The constructed filter URL.
    """
    filters = []
    if filter.authors:
        filters.append(f"authorships.author.id:{'|'.join(filter.authors)}")
    if filter.institutions:
        filters.append(f"institutions.id:{'|'.join(filter.institutions)}")
    if filter.only_oa:
        filters.append("open_access.is_oa:true")

    return ",".join(filters) if filters else ""


# Utility functions for searching the OpenAlex API
# For documentation, see https://docs.openalex.org/api-entities/works/search-works
def search_open_alex(
    search_term: Optional[str], filter: Optional[OpenAlexFilter] = None, page: int = 1
) -> OpenAlexResponse:
    """
    Search the OpenAlex API for papers based on a search term and optional filter.

    Args:
        search_term (str): The term to search for.
        filter (Optional[OpenAlexFilter]): Optional filter for the search.

    Returns:
        dict: The response from the OpenAlex API.
    """
    # Construct the search URL
    base_url = "https://api.openalex.org/works"

    params = {"search": quote(search_term) if search_term else "", "page": page}
    if filter:
        params["filter"] = quote(construct_open_alex_filter_url(filter))

    constructed_url = f"{base_url}?"
    for key, value in params.items():
        constructed_url += f"{key}={value}&"

    constructed_url = constructed_url.rstrip("&")  # Remove trailing '&'

    logger.debug(f"Constructed URL: {constructed_url}")

    response = _request_with_retry(constructed_url)

    logger.info(f"Response Status: {response.status_code}")
    logger.debug(f"Response JSON: {response.json()}")

    return OpenAlexResponse(**response.json())


def get_host_organization_name(host_organization_url: str) -> Optional[str]:
    """
    Retrieve the host organization name from OpenAlex given a host_organization URL.

    The host_organization can be either a Publisher (P...) or an Institution (I...).
    This function handles both cases.

    Args:
        host_organization_url (str): The full OpenAlex URL of the host organization
                                      (e.g., "https://openalex.org/P4310320052" or
                                       "https://openalex.org/I205783295")
    Returns:
        Optional[str]: The name of the host organization if found, otherwise None.
    """
    # Extract the ID from the URL (e.g., "P4310320052" from "https://openalex.org/P4310320052")
    org_id = (
        host_organization_url.split("/")[-1]
        if "/" in host_organization_url
        else host_organization_url
    )

    # Determine the entity type based on the ID prefix
    if org_id.startswith("P"):
        entity_type = "publishers"
    elif org_id.startswith("I"):
        entity_type = "institutions"
    else:
        logger.warning(f"Unknown host_organization ID type: {org_id}")
        return None

    url = f"https://api.openalex.org/{entity_type}/{org_id}"
    for attempt in range(OPENALEX_MAX_RETRIES):
        try:
            response = requests.get(url, timeout=10)
            if response.status_code == 200:
                data = response.json()
                return data.get("display_name")
            elif response.status_code == 404:
                return None
            else:
                response.raise_for_status()
        except requests.RequestException as e:
            if attempt < OPENALEX_MAX_RETRIES - 1:
                logger.warning(
                    f"Error fetching host organization (attempt {attempt + 1}): {e}. Retrying..."
                )
                time.sleep(OPENALEX_RETRY_DELAY)
            else:
                logger.exception(f"Error fetching host organization: {url}")
                return None
    return None


def build_abstract_from_inverted_index(inverted_index: dict) -> str:
    """
    Build an abstract from the inverted index of a paper.

    Args:
        inverted_index (dict): The inverted index of the paper. Keys are terms, and values are the list of word indexes at which they appear.

    Returns:
        str: The constructed abstract.
    """
    min_index = min(min(value) for value in inverted_index.values() if value)
    max_index = max(max(value) for value in inverted_index.values() if value)
    abstract = [""] * (max_index - min_index + 1)
    for key, value in inverted_index.items():
        for index in value:
            if min_index <= index <= max_index:
                abstract[index - min_index] = key
    return " ".join(abstract).strip() if abstract else ""


def get_paper_by_open_alex_id(open_alex_id: str) -> Optional[OpenAlexWork]:
    """
    Retrieve a paper from OpenAlex by its OpenAlex ID.

    Args:
        open_alex_id (str): The OpenAlex ID of the work.

    Returns:
        Optional[OpenAlexWork]: The OpenAlexWork object if found, otherwise None.
    """
    url = f"https://api.openalex.org/works/{quote(open_alex_id)}"
    for attempt in range(OPENALEX_MAX_RETRIES):
        try:
            response = requests.get(url, timeout=10)
            if response.status_code == 200:
                return OpenAlexWork(**response.json())
            elif response.status_code == 404:
                return None
            else:
                response.raise_for_status()
        except requests.RequestException as e:
            if attempt < OPENALEX_MAX_RETRIES - 1:
                logger.warning(
                    f"Error fetching paper by OpenAlex ID (attempt {attempt + 1}): {e}. Retrying..."
                )
                time.sleep(OPENALEX_RETRY_DELAY)
            else:
                raise
    return None


def get_work_by_doi(doi: str) -> Optional[OpenAlexWork]:
    """
    Retrieve a work from OpenAlex by its DOI.

    OpenAlex accepts DOIs as external IDs in the works endpoint.
    The DOI can be in either format:
    - Full URL: https://doi.org/10.7717/peerj.4375
    - Just the DOI: 10.7717/peerj.4375

    Args:
        doi (str): The DOI of the work (with or without https://doi.org/ prefix).

    Returns:
        Optional[OpenAlexWork]: The OpenAlexWork object if found, otherwise None.
    """
    # Ensure DOI is in URL format for OpenAlex
    if not doi.startswith("https://doi.org/"):
        doi = f"https://doi.org/{doi}"

    url = f"https://api.openalex.org/works/{doi}"
    for attempt in range(OPENALEX_MAX_RETRIES):
        try:
            response = requests.get(url, timeout=10)
            if response.status_code == 200:
                return OpenAlexWork(**response.json())
            elif response.status_code == 404:
                return None
            else:
                response.raise_for_status()
        except requests.RequestException as e:
            if attempt < OPENALEX_MAX_RETRIES - 1:
                logger.warning(
                    f"Error fetching work by DOI (attempt {attempt + 1}): {e}. Retrying..."
                )
                time.sleep(OPENALEX_RETRY_DELAY)
            else:
                raise
    return None


def construct_citation_graph(open_alex_id: str) -> OpenAlexCitationGraph:
    """
    Construct a citation graph for a given OpenAlex ID, including both citations and cited-by relationships. Use a depth of 1 to include direct citations and works that cite the original work.

    Args:
        open_alex_id (str): The OpenAlex ID of the work.

    Returns:
        dict: A dictionary representing the citation graph.
    """
    center = get_paper_by_open_alex_id(open_alex_id)
    if not center:
        raise ValueError(f"Paper with OpenAlex ID {open_alex_id} not found.")

    # Construct the citation graph
    cites_url = f"https://api.openalex.org/works?filter=cites:{quote(open_alex_id)}&page=1&per_page=20"
    cites_response = _request_with_retry(cites_url)

    cited_by_url = f"https://api.openalex.org/works?filter=cited_by:{quote(open_alex_id)}&page=1&per_page=20"
    cited_by_response = _request_with_retry(cited_by_url)

    cites_data = cites_response.json()
    cited_by_data = cited_by_response.json()

    return OpenAlexCitationGraph(
        cites=cites_data, cited_by=cited_by_data, center=center
    )


def extract_doi_from_url(url: str) -> str | None:
    """Extract DOI from various URL formats."""
    # Decode URL-encoded characters
    url = unquote(url)

    # DOI pattern: 10.XXXX/anything (until whitespace or certain chars)
    doi_pattern = r'10\.\d{4,}/[^\s"<>]+'

    match = re.search(doi_pattern, url)
    if match:
        doi = match.group(0)
        # Clean trailing punctuation that might be captured
        doi = doi.rstrip(".,;:)")
        return doi

    return None


def get_doi(title: str, authors: Optional[List[str]] = None) -> Optional[str]:
    """
    Retrieve the DOI for a paper given its title and optional author using a series of external APIs.

    1. CrossRef API
    2. OpenAlex API (if CrossRef fails)
    3. Semantic Scholar API (if OpenAlex fails)

    Args:
        title (str): The title of the paper.
        authors (Optional[List[str]]): The authors of the paper.
    Returns:
        Optional[str]: The DOI of the paper if found, otherwise None.
    """

    def get_openalex_doi(title: str) -> Optional[str]:
        try:
            open_alex_results = search_open_alex(title)
            target_authors = set(a.lower() for a in authors) if authors else set()
            if open_alex_results.results:
                for result in open_alex_results.results:
                    # Check if title matches
                    if not (result.title and title.lower() in result.title.lower()):
                        continue

                    # If no author provided, return first title match
                    if not authors:
                        return extract_doi_from_url(result.doi) if result.doi else None

                    # Check if author matches any authorship
                    if result.authorships:
                        work_authors = set(
                            a.author.display_name.lower()
                            for a in result.authorships
                            if a.author and a.author.display_name
                        )
                        for authorship in result.authorships:
                            if authorship.author and authorship.author.display_name:
                                if work_authors & target_authors:
                                    return (
                                        extract_doi_from_url(result.doi)
                                        if result.doi
                                        else None
                                    )
        except Exception:
            return None
        return None

    def get_crossref_doi(
        title: str, authors: Optional[List[str]] = None
    ) -> Optional[str]:
        base_url = "https://api.crossref.org/works"
        params = {"query.title": quote(title), "rows": 1}
        if authors:
            params["query.author"] = ", ".join(authors)

        response = requests.get(base_url, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()
        items = data.get("message", {}).get("items", [])
        if items:
            top_match = items[0]
            if "title" in top_match and title.lower() in [
                t.lower() for t in top_match["title"]
            ]:
                return top_match.get("DOI")
        return None

    def search_semantic_scholar_doi(title: str) -> Optional[str]:
        # Not working currently - hitting 403 errors with every request. TODO fix once we have a resolution.

        if DISABLE_SEMANTIC_SCHOLAR:
            return None

        base_url = "https://api.semanticscholar.org/graph/v1/paper/search"
        headers = {}
        if SEMANTIC_SCHOLAR_API_KEY:
            headers["x-api-key"] = SEMANTIC_SCHOLAR_API_KEY

        params = {"query": title, "limit": 1, "fields": "doi"}
        response = requests.get(base_url, headers=headers, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()
        if data.get("data"):
            top_match = data["data"][0]
            if "title" in top_match and title.lower() in top_match["title"].lower():
                return top_match.get("doi")
        return None

    if not title:
        return None

    try:
        crossref_doi = get_crossref_doi(title, authors)
    except requests.RequestException:
        logger.exception(
            f"Error querying CrossRef API for DOI - {title}", exc_info=True
        )
        crossref_doi = None

    try:
        openalex_doi = get_openalex_doi(title)
    except requests.RequestException:
        logger.exception(
            f"Error querying OpenAlex API for DOI - {title}", exc_info=True
        )
        openalex_doi = None

    try:
        semantic_scholar_doi = search_semantic_scholar_doi(title)
    except requests.RequestException:
        logger.exception(
            f"Error querying Semantic Scholar API for DOI - {title}", exc_info=True
        )
        semantic_scholar_doi = None

    if crossref_doi:
        logger.info(f"Found DOI from CrossRef: {crossref_doi} for title: {title}")
    elif openalex_doi:
        logger.info(f"Found DOI from OpenAlex: {openalex_doi} for title: {title}")
    elif semantic_scholar_doi:
        logger.info(
            f"Found DOI from Semantic Scholar: {semantic_scholar_doi} for title: {title}"
        )

    return crossref_doi or openalex_doi or semantic_scholar_doi


def get_enriched_data(doi: str) -> Optional[EnrichedData]:
    """
    Retrieve enriched data for a paper given its DOI using the OpenAlex API or CrossRef API.

    Args:
        doi (str): The DOI of the paper.
    Returns:
        Optional[EnrichedData]: The enriched data of the paper if found, otherwise None.
    """

    def get_openalex_enriched_data(doi: str) -> Optional[EnrichedData]:
        try:
            result = get_work_by_doi(doi)
            if result:
                # Extract journal from primary_location.source
                journal = None
                if result.primary_location and result.primary_location.source:
                    journal = result.primary_location.source.display_name

                host_organization_id = (
                    result.primary_location.source.host_organization
                    if result.primary_location and result.primary_location.source
                    else None
                )

                publisher_name = None
                if host_organization_id:
                    publisher_name = get_host_organization_name(host_organization_id)

                publication_date = result.publication_date

                return EnrichedData(
                    publisher=publisher_name,
                    journal=journal,
                    publication_date=publication_date,
                )

        except Exception:
            logger.error(
                f"Error when querying Open Alex API for DOI {doi}", exc_info=True
            )
            return None
        return None

    def get_crossref_enriched_data(doi: str) -> Optional[EnrichedData]:
        base_url = f"https://api.crossref.org/works/{quote(doi)}"
        response = requests.get(base_url, timeout=10)
        if response.status_code == 404:
            # DOI not found in CrossRef (common for arXiv, DataCite DOIs)
            return None
        response.raise_for_status()
        data = response.json()
        message = data.get("message", {})
        publisher = message.get("publisher")
        container_titles = message.get("container-title", [])
        journal = container_titles[0] if container_titles else None
        publication_date_parts = message.get("published-print", {}).get(
            "date-parts", []
        ) or message.get("published-online", {}).get("date-parts", [])
        publication_date = None
        if publication_date_parts and len(publication_date_parts[0]) >= 3:
            year, month, day = publication_date_parts[0][:3]
            publication_date = f"{year:04d}-{month:02d}-{day:02d}"
        elif publication_date_parts and len(publication_date_parts[0]) == 2:
            year, month = publication_date_parts[0][:2]
            publication_date = f"{year:04d}-{month:02d}"
        elif publication_date_parts and len(publication_date_parts[0]) == 1:
            year = publication_date_parts[0][0]
            publication_date = f"{year:04d}"

        return EnrichedData(
            publisher=publisher,
            journal=journal,
            publication_date=publication_date,
        )

    if not doi:
        return None

    doi = extract_doi_from_url(doi) or doi

    try:
        openalex_data = get_openalex_enriched_data(doi)
        if openalex_data:
            logger.info(f"Found enriched data from OpenAlex for DOI: {doi}")
            return openalex_data
    except requests.RequestException:
        logger.exception(
            f"Error querying OpenAlex API for enriched data - {doi}", exc_info=True
        )

    try:
        crossref_data = get_crossref_enriched_data(doi)
        if crossref_data:
            logger.info(f"Found enriched data from CrossRef for DOI: {doi}")
            return crossref_data

    except requests.RequestException:
        logger.exception(
            f"Error querying CrossRef API for enriched data - {doi}", exc_info=True
        )

    return None
