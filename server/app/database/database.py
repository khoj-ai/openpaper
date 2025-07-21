from contextlib import asynccontextmanager

from app.database.config import Settings
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import Session, sessionmaker

settings = Settings()

SQLALCHEMY_DATABASE_URL = settings.DATABASE_URL

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    pool_size=20,  # default 5
    max_overflow=30,  # default 10
    pool_timeout=60,  # default 30s
    pool_pre_ping=True,  # Validate connections before use
    pool_recycle=3600,  # default 3600
)

SessionLocal: sessionmaker[Session] = sessionmaker(
    autocommit=False, autoflush=False, bind=engine
)

Base = declarative_base()


# Dependency for FastAPI
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@asynccontextmanager
async def aget_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
