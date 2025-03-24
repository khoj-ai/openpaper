import uuid
from sqlalchemy import Column, String, Text, DateTime, UUID, ARRAY
from sqlalchemy.sql import func
from sqlalchemy.orm import DeclarativeBase

class Base(DeclarativeBase):
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    def __repr__(self):
        return f"<{self.__class__.__name__} id={self.id}>"
    
    def to_dict(self):
        """
        Convert the SQLAlchemy model instance to a dictionary.
        """
        def _to_json_friendly(value):
            if isinstance(value, list):
                return [str(item) for item in value]
            elif isinstance(value, dict):
                return {key: str(val) for key, val in value.items()}
            return str(value)
        
        return {
            column.name: _to_json_friendly(getattr(self, column.name)) for column in self.__table__.columns if column.name != "id"
        }

class Document(Base):
    __tablename__ = "documents"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    filename = Column(String, nullable=False, unique=True)
    file_url = Column(String, nullable=False, unique=True)
    authors = Column(ARRAY(String), nullable=True) # type: ignore
    title = Column(Text, nullable=True)
    abstract = Column(Text, nullable=True)
    institutions = Column(ARRAY(String), nullable=True) # type: ignore
    keywords = Column(ARRAY(String), nullable=True) # type: ignore
    summary = Column(Text, nullable=True)
    publish_date = Column(DateTime, nullable=True)
    starter_questions = Column(ARRAY(String), nullable=True) # type: ignore
    raw_content = Column(Text, nullable=True)
