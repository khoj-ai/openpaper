import os
from pydantic_settings import BaseSettings
from dotenv import load_dotenv

load_dotenv()

class Settings(BaseSettings):
    PROJECT_NAME: str = "Annotated Papers App"
    DATABASE_URL: str = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/annotated-paper")
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "your_openai_api_key")
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "your_gemini_api_key")
    
    class Config:
        env_file = ".env"
        extra = "ignore"  # Ignore extra fields in the .env file