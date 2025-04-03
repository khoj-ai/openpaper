import uuid

from sqlalchemy import ARRAY, UUID, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, relationship
from sqlalchemy.sql import func


class Base(DeclarativeBase):
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

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
            column.name: _to_json_friendly(getattr(self, column.name))
            for column in self.__table__.columns
        }


class Document(Base):
    __tablename__ = "documents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    filename = Column(String, nullable=False)
    file_url = Column(String, nullable=False)
    authors = Column(ARRAY(String), nullable=True)  # type: ignore
    title = Column(Text, nullable=True)
    abstract = Column(Text, nullable=True)
    institutions = Column(ARRAY(String), nullable=True)  # type: ignore
    keywords = Column(ARRAY(String), nullable=True)  # type: ignore
    summary = Column(Text, nullable=True)
    publish_date = Column(DateTime, nullable=True)
    starter_questions = Column(ARRAY(String), nullable=True)  # type: ignore
    raw_content = Column(Text, nullable=True)

    conversations = relationship("Conversation", back_populates="document")
    paper_notes = relationship("PaperNote", back_populates="document")


class Message(Base):
    __tablename__ = "messages"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    conversation_id = Column(
        UUID(as_uuid=True), ForeignKey("conversations.id"), nullable=False
    )
    role = Column(String, nullable=False)  # 'user' or 'assistant'
    content = Column(Text, nullable=False)
    references = Column(
        JSONB, nullable=True
    )  # For assistant's document snippet references
    bucket = Column(JSONB, nullable=True)  # For any additional attributes
    sequence = Column(Integer, nullable=False)  # To maintain message order

    conversation = relationship("Conversation", back_populates="messages")


class Conversation(Base):
    __tablename__ = "conversations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id = Column(UUID(as_uuid=True), ForeignKey("documents.id"), nullable=False)
    title = Column(String, nullable=True)  # Optional conversation title

    document = relationship("Document", back_populates="conversations")
    messages = relationship(
        "Message", back_populates="conversation", order_by=Message.sequence
    )


class PaperNote(Base):
    __tablename__ = "paper_notes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Ensure each document has only one associated paper note
    document_id = Column(
        UUID(as_uuid=True), ForeignKey("documents.id"), nullable=False, unique=True
    )
    content = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    document = relationship("Document", back_populates="paper_notes")


class Highlight(Base):
    __tablename__ = "highlights"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id = Column(
        UUID(as_uuid=True), ForeignKey("documents.id"), nullable=False
    )  # type: ignore
    raw_text = Column(Text, nullable=False)
    start_offset = Column(Integer, nullable=False)
    end_offset = Column(Integer, nullable=False)


class Annotation(Base):
    __tablename__ = "annotations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    highlight_id = Column(
        UUID(as_uuid=True), ForeignKey("highlights.id"), nullable=False
    )  # type: ignore
    document_id = Column(
        UUID(as_uuid=True), ForeignKey("documents.id"), nullable=False
    )  # type: ignore
    content = Column(Text, nullable=False)
