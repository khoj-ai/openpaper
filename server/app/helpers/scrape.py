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
        response = firecrawl_app.scrape_url(url, formats=["markdown"])
        if not response.error and response.markdown:
            return response.markdown
        else:
            raise Exception(f"Failed to scrape {url}: {response.error}")
    except Exception as e:
        logger.error(f"Error scraping {url}: {str(e)}")
        raise Exception(f"Error scraping {url}: {str(e)}")
