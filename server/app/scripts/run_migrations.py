import logging
import os
import sys

# Add the parent directory to the Python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../")))

from app.database.config import create_database, run_migrations
from app.logging_config import configure_logging

configure_logging()
logger = logging.getLogger(__name__)

if __name__ == "__main__":
    create_database()
    run_migrations()
    logger.info("Migrations complete")
