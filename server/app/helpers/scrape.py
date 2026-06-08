import logging
import os

from firecrawl import FirecrawlApp

logger = logging.getLogger(__name__)

FIRECRAWL_API_KEY = os.getenv("FIRECRAWL_API_KEY")
if not FIRECRAWL_API_KEY:
    raise ValueError("FIRECRAWL_API_KEY environment variable is not set.")

firecrawl_app = FirecrawlApp(api_key=FIRECRAWL_API_KEY)


def scrape_web_page(url: str) -> str:
    """
    Scrape the content of a web page using Firecrawl.

    Args:
        url (str): The URL of the web page to scrape.

    Returns:
        str: The scraped content of the web page.
    """
    try:
        # firecrawl-py 4.x: scrape() returns a Document (with .markdown) on
        # success and raises on failure. There is no .error attribute.
        document = firecrawl_app.scrape(url, formats=["markdown"])
        if document.markdown:
            return document.markdown
        raise Exception(f"Failed to scrape {url}: no markdown content returned")
    except Exception as e:
        logger.error(f"Error scraping {url}: {str(e)}")
        raise Exception(f"Error scraping {url}: {str(e)}")
