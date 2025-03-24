import os
from pathlib import Path

from alembic.config import main as alembic_config
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import uvicorn # type: ignore
import psycopg2
from dotenv import load_dotenv
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT


from app.api.api import router
from app.api.document_api import document_router
from app.database.config import Settings


load_dotenv()

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
            database="postgres"  # Connect to default postgres database
        )
        
        conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
        cursor = conn.cursor()
        
        # Check if database exists
        cursor.execute(f"SELECT 1 FROM pg_catalog.pg_database WHERE datname = '{db_name}'")
        exists = cursor.fetchone()
        
        if not exists:
            print(f"Creating database {db_name}")
            cursor.execute(f'CREATE DATABASE "{db_name}"')
        
        cursor.close()
        conn.close()
    except Exception as e:
        print(f"Error creating database: {e}")

create_database()

def run_migrations():
    alembic_args = [
        '--raiseerr',
        'upgrade', 'head',
    ]
    try:
        alembic_config(argv=alembic_args)
    finally:
        # Restore directory
        pass

# Run migrations
run_migrations()

app = FastAPI(
    title="Annotated Paper",
    description="A web application for uploading and annotating papers.",
    version="1.0.0"
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods
    allow_headers=["*"],  # Allows all headers
)

# Mount the uploads directory
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

# Include the router in the main app
app.include_router(router, prefix="/api")
app.include_router(document_router, prefix="/api/paper")

if __name__ == "__main__":
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("app.main:app", host="0.0.0.0", port=port, reload=True)
