import logging
import os

import psycopg2
from alembic.config import main as alembic_config
from dotenv import load_dotenv
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT
from pydantic_settings import BaseSettings

load_dotenv()


class Settings(BaseSettings):
    PROJECT_NAME: str = "Annotated Papers App"
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/annotated-paper"
    )
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "your_openai_api_key")
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "your_gemini_api_key")

    class Config:
        env_file = ".env"
        extra = "ignore"  # Ignore extra fields in the .env file


def run_migrations():
    import logging

    from alembic import command
    from alembic.config import Config

    # Get an Alembic configuration object
    alembic_cfg = Config("alembic.ini")

    # Instead of manipulating all loggers, just control Alembic's logging
    alembic_logger = logging.getLogger("alembic")
    old_level = alembic_logger.level
    old_propagate = alembic_logger.propagate
    old_handlers = list(alembic_logger.handlers)

    try:
        # Configure Alembic logging as needed
        alembic_logger.setLevel(logging.INFO)  # or your preferred level
        alembic_logger.propagate = False  # prevent propagation to root

        # Run the migrations
        command.upgrade(alembic_cfg, "head")
    finally:
        # Restore just the Alembic logger
        alembic_logger.setLevel(old_level)
        alembic_logger.propagate = old_propagate

        # Clear and restore handlers
        alembic_logger.handlers.clear()
        for handler in old_handlers:
            alembic_logger.addHandler(handler)


def create_database():
    """Create the database if it doesn't exist."""
    settings = Settings()

    # Extract database name from the URL
    db_url = settings.DATABASE_URL
    db_name = db_url.split("/")[-1]

    # Extract connection info
    parts = db_url.split("://")[1].split("/")[0].split("@")
    user_pass = parts[0].split(":")
    host_port = parts[1].split(":")

    user = user_pass[0]
    password = user_pass[1]
    host = host_port[0]
    port = host_port[1] if len(host_port) > 1 else "5432"

    # Create a connection to PostgreSQL server (default database)
    try:
        conn = psycopg2.connect(
            user=user,
            password=password,
            host=host,
            port=port,
            database="postgres",  # Connect to default postgres database
        )

        conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
        cursor = conn.cursor()

        # Check if database exists
        cursor.execute(
            f"SELECT 1 FROM pg_catalog.pg_database WHERE datname = '{db_name}'"
        )
        exists = cursor.fetchone()

        if not exists:
            print(f"Creating database {db_name}")
            cursor.execute(f'CREATE DATABASE "{db_name}"')

        cursor.close()
        conn.close()
    except Exception as e:
        print(f"Error creating database: {e}")
