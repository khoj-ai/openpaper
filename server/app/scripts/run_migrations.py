import sys
import os
import logging

# Add the parent directory to the Python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../')))

from app.database.config import create_database, run_migrations

logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s: %(message)s"
)

if __name__ == "__main__":
    create_database()
    run_migrations()
    logging.info("Migrations complete")