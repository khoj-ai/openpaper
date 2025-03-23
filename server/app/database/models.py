import uuid
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, UUID
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship, DeclarativeBase

class Base(DeclarativeBase):
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

class Document(Base):
    __tablename__ = "documents"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    filename = Column(String, nullable=False)
    file_path = Column(String, nullable=False)
    file_url = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    annotations = relationship("Annotation", back_populates="document", cascade="all, delete-orphan")

class Annotation(Base):
    __tablename__ = "annotations"
    
    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(UUID(as_uuid=True), ForeignKey("documents.id"))
    content = Column(Text, nullable=False)
    page_number = Column(Integer)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    document = relationship("Document", back_populates="annotations", foreign_keys=[document_id])