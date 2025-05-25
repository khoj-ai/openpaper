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


# Utility functions for searching the OpenAlex API
# For documentation, see https://docs.openalex.org/api-entities/works/search-works
def search_open_alex(
    search_term: str, filter: Optional[str] = None, page: int = 1
) -> OpenAlexResponse:
    """
    Search the OpenAlex API for papers based on a search term and optional filter.

    Args:
        search_term (str): The term to search for.
        filter (Optional[str]): Optional filter for the search.

    Returns:
        dict: The response from the OpenAlex API.
    """
    # Construct the search URL
    base_url = "https://api.openalex.org/works"

    params = {"search": quote(search_term), "page": page}
    if filter:
        params["filter"] = quote(filter)

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
        inverted_index (dict): The inverted index of the paper.

    Returns:
        str: The constructed abstract.
    """
    abstract = []
    for key, value in inverted_index.items():
        abstract.append(f"{key}: {value}")
    return "\n".join(abstract)
