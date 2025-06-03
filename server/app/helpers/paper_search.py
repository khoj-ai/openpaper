import logging
from enum import Enum
from typing import List, Optional, Union
from urllib.parse import quote

import requests
from pydantic import BaseModel, ConfigDict, model_validator

logger = logging.getLogger(__name__)


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
                    if item.get("abstract_inverted_index"):
                        item["abstract"] = build_abstract_from_inverted_index(
                            item["abstract_inverted_index"]
                        )
                    valid_results.append(OpenAlexWork(**item))
                except Exception as e:
                    logger.warning(f"Skipping invalid OpenAlex work entry: {e}")

            data["results"] = valid_results
        return data


class OpenAlexFilter(BaseModel):
    authors: Optional[List[str]] = None
    institutions: Optional[List[str]] = None


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

    return "|".join(filters) if filters else ""


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
