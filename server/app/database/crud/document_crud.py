from typing import Optional
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy.future import select

from app.database.crud.base_crud import CRUDBase
from app.database.models import Document

# Define Pydantic models for type safety
class DocumentBase(BaseModel):
    filename: Optional[str] = None
    file_url: Optional[str] = None
    authors: Optional[str] = None
    title: Optional[str] = None
    abstract: Optional[str] = None
    institutions: Optional[str] = None
    keywords: Optional[str] = None
    summary: Optional[str] = None
    date: Optional[str] = None

class DocumentCreate(DocumentBase):
    # Only mandate required fields for creation, others are optional
    filename: str
    file_url: str

class DocumentUpdate(DocumentBase):
    pass

# Document CRUD that inherits from the base CRUD
class DocumentCRUD(CRUDBase[Document, DocumentCreate, DocumentUpdate]):
    """CRUD operations specifically for Document model"""
    pass

# Create a single instance to use throughout the application
document_crud = DocumentCRUD(Document)