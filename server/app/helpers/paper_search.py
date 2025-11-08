import logging
import os
from enum import Enum
from typing import List, Optional
from urllib.parse import quote

import requests
from pydantic import BaseModel, ConfigDict, model_validator

logger = logging.getLogger(__name__)

SEMANTIC_SCHOLAR_API_KEY = os.getenv("SEMANTIC_SCHOLAR_API_KEY")


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
    oa_status: OAStatus
    oa_url: Optional[str]


class Keyword(BaseOpenAlexModel):
    id: str
    display_name: str
    score: Optional[float]


class PrimaryLocationSource(BaseOpenAlexModel):
    id: str
    display_name: str
    type: Optional[str]
    host_organization: Optional[dict]


class PrimaryLocation(BaseOpenAlexModel):
    is_oa: bool
    landing_page_url: Optional[str]
    pdf_url: Optional[str]


class SubTopic(BaseOpenAlexModel):
    id: str
    display_name: str


class Topic(BaseOpenAlexModel):
    id: str
    display_name: Optional[str]
    score: Optional[float]
    subfield: Optional[SubTopic]
    field: Optional[SubTopic]
    domain: Optional[SubTopic]


class Author(BaseOpenAlexModel):
    id: Optional[str]
    display_name: Optional[str]
    orcid: Optional[str]


class Institution(BaseOpenAlexModel):
    id: Optional[str]
    display_name: Optional[str]
    ror: Optional[str]
    country_code: Optional[str]
    type: Optional[str]


class Authorship(BaseOpenAlexModel):
    author_position: Optional[str]
    author: Optional[Author]
    institutions: Optional[List[Institution]]


class OpenAlexWork(BaseOpenAlexModel):
    id: str
    title: str
    doi: Optional[str]
    display_name: Optional[str]
    publication_year: int
    publication_date: str
    type: Optional[str]
    open_access: Optional[OpenAccess]
    keywords: Optional[List[Keyword]]
    primary_location: Optional[PrimaryLocation]
    topics: Optional[List[Topic]]
    authorships: Optional[List[Authorship]]
    cited_by_count: Optional[int]
    abstract_inverted_index: Optional[dict]
    abstract: Optional[str]

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
                    logger.warning(f"Skipping invalid OpenAlex work entry: {e}")

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
    search_term: str, filter: Optional[OpenAlexFilter] = None, page: int = 1
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

    params = {"search": quote(search_term), "page": page}
    if filter:
        params["filter"] = quote(construct_open_alex_filter_url(filter))

    constructed_url = f"{base_url}?"
    for key, value in params.items():
        constructed_url += f"{key}={value}&"

    constructed_url = constructed_url.rstrip("&")  # Remove trailing '&'

    logger.debug(f"Constructed URL: {constructed_url}")

    # Add a timeout to the request
    response = requests.get(constructed_url, timeout=10)
    response.raise_for_status()  # Raise an error for bad responses

    logger.info(f"Response Status: {response.status_code}")
    logger.debug(f"Response JSON: {response.json()}")

    return OpenAlexResponse(**response.json())


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
    response = requests.get(url, timeout=10)
    if response.status_code == 200:
        return OpenAlexWork(**response.json())
    elif response.status_code == 404:
        return None
    else:
        response.raise_for_status()


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
    cites_response = requests.get(cites_url, timeout=10)
    cites_response.raise_for_status()

    cited_by_url = f"https://api.openalex.org/works?filter=cited_by:{quote(open_alex_id)}&page=1&per_page=20"
    cited_by_response = requests.get(cited_by_url, timeout=10)
    cited_by_response.raise_for_status()

    cites_data = cites_response.json()
    cited_by_data = cited_by_response.json()

    return OpenAlexCitationGraph(
        cites=cites_data, cited_by=cited_by_data, center=center
    )


def get_doi(title: str, author: Optional[str] = None) -> Optional[str]:
    """
    Retrieve the DOI for a paper given its title and optional author using a series of external APIs.

    1. CrossRef API
    2. OpenAlex API (if CrossRef fails)
    3. Semantic Scholar API (if OpenAlex fails)

    Args:
        title (str): The title of the paper.
        author (Optional[str]): The author of the paper.

    Returns:
        Optional[str]: The DOI of the paper if found, otherwise None.
    """
    base_url = "https://api.crossref.org/works"
    params = {"query.title": title, "rows": 1}
    if author:
        params["query.author"] = author

    try:
        response = requests.get(base_url, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()
        items = data.get("message", {}).get("items", [])
        if items:
            return items[0].get("DOI")
    except requests.RequestException:
        try:
            open_alex_results = search_open_alex(title)
            if open_alex_results.results:
                doi = open_alex_results.results[0].doi
                if doi:
                    return doi
        except Exception:
            try:
                ss_url = "https://api.semanticscholar.org/graph/v1/paper/search"
                ss_params = {"query": title, "limit": 1, "fields": "doi"}
                ss_response = requests.get(ss_url, params=ss_params, timeout=10)
                ss_response.raise_for_status()
                ss_data = ss_response.json()
                if ss_data.get("data"):
                    doi = ss_data["data"][0].get("doi")
                    if doi:
                        return doi
            except requests.RequestException:
                return None
    return None
