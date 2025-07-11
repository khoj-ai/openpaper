import uuid
from enum import Enum
from types import NoneType

from sqlalchemy import UUID  # type: ignore
from sqlalchemy import (  # type: ignore
    ARRAY,
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, relationship  # type: ignore
from sqlalchemy.sql import func

# Special notes:
# - All models inherit from the `Base` class, which provides common fields and methods.
# - The `last_accessed_at` field is automatically updated to the current timestamp
#   whenever the record is accessed. It is only present in selected models
#   (e.g., `Paper` to track when a user last interacted with a paper.)
# - This can be useful for tracking user activity and engagement with papers.
# - The `created_at` and `updated_at` fields are automatically managed by SQLAlchemy
#   to record when the record was created and last updated, respectively.
# - The `to_dict` method converts the model instance to a dictionary, making it easier
#   to serialize the model for APIs or other uses.


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
            elif isinstance(value, (int, float, bool)):
                return value
            elif isinstance(value, NoneType):
                return None
            return str(value)

        return {
            column.name: _to_json_friendly(getattr(self, column.name))
            for column in self.__table__.columns
        }


class AuthProvider(str, Enum):
    GOOGLE = "google"
    # Add more providers as needed
    # GITHUB = "github"
    # MICROSOFT = "microsoft"


# BASIC plans are not considered active subscriptions.
# They are used for users who have not yet subscribed.
class SubscriptionPlan(str, Enum):
    BASIC = "basic"
    RESEARCHER = "researcher"


# When a user has a RESEARCHER (or more advanced) subscription,
# they can have one of the following statuses.
class SubscriptionStatus(str, Enum):
    ACTIVE = "active"
    CANCELED = "canceled"
    PAST_DUE = "past_due"
    INCOMPLETE = "incomplete"
    TRIALING = "trialing"
    UNPAID = "unpaid"


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String, unique=True, nullable=False, index=True)
    name = Column(String, nullable=True)
    picture = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)
    is_admin = Column(Boolean, default=False)

    # OAuth related fields
    auth_provider = Column(String, nullable=False)
    provider_user_id = Column(String, nullable=False, index=True)

    # Optional profile information
    locale = Column(String, nullable=True)

    papers = relationship("Paper", back_populates="user", cascade="all, delete-orphan")
    sessions = relationship(
        "Session", back_populates="user", cascade="all, delete-orphan"
    )
    messages = relationship(
        "Message", back_populates="user", cascade="all, delete-orphan"
    )
    conversations = relationship(
        "Conversation", back_populates="user", cascade="all, delete-orphan"
    )
    paper_notes = relationship(
        "PaperNote", back_populates="user", cascade="all, delete-orphan"
    )
    highlights = relationship(
        "Highlight", back_populates="user", cascade="all, delete-orphan"
    )
    annotations = relationship(
        "Annotation", back_populates="user", cascade="all, delete-orphan"
    )
    hypothesis_jobs = relationship(
        "HypothesisJob", back_populates="user", cascade="all, delete-orphan"
    )
    audio_overview_jobs = relationship(
        "AudioOverviewJob", back_populates="user", cascade="all, delete-orphan"
    )
    paper_upload_jobs = relationship(
        "PaperUploadJob", back_populates="user", cascade="all, delete-orphan"
    )

    # The associated subscription for the user.
    subscription = relationship(
        "Subscription",
        back_populates="user",
        uselist=False,
        cascade="all, delete-orphan",
    )


class Session(Base):
    __tablename__ = "sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    token = Column(String, unique=True, nullable=False, index=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    user_agent = Column(String, nullable=True)
    ip_address = Column(String, nullable=True)

    user = relationship("User", back_populates="sessions")


class JobStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class RoleType(str, Enum):
    USER = "user"
    ASSISTANT = "assistant"


class PaperUploadJob(Base):
    __tablename__ = "paper_upload_jobs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    status = Column(String, nullable=False, default=JobStatus.PENDING)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    task_id = Column(String, nullable=True)  # For tracking task in Celery

    user = relationship("User", back_populates="paper_upload_jobs")


class PaperStatus(str, Enum):
    todo = "todo"
    reading = "reading"
    completed = "completed"


class Paper(Base):
    __tablename__ = "papers"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # we can change the default to TODO once we have some kind of bulk paper upload? for now, every upload automatically converts to reading
    status = Column(String, nullable=False, default=PaperStatus.reading)
    file_url = Column(String, nullable=False)
    preview_url = Column(String, nullable=True)
    s3_object_key = Column(String, nullable=True)
    authors = Column(ARRAY(String), nullable=True)
    title = Column(Text, nullable=True)
    abstract = Column(Text, nullable=True)
    institutions = Column(ARRAY(String), nullable=True)
    keywords = Column(ARRAY(String), nullable=True)
    summary = Column(Text, nullable=True)
    summary_citations = Column(JSONB, nullable=True)
    publish_date = Column(DateTime, nullable=True)
    starter_questions = Column(ARRAY(String), nullable=True)
    raw_content = Column(Text, nullable=True)
    page_offset_map = Column(
        JSONB, nullable=True
    )  # Maps page numbers to text offsets. Useful for re-annotation.
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    last_accessed_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    upload_job_id = Column(
        UUID(as_uuid=True),
        ForeignKey("paper_upload_jobs.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Cached presigned URL fields
    cached_presigned_url = Column(String, nullable=True)
    presigned_url_expires_at = Column(DateTime(timezone=True), nullable=True)

    # Optional fields for sharing
    is_public = Column(Boolean, default=False)
    share_id = Column(String, unique=True, nullable=True, index=True)

    # Additional metadata
    doi = Column(String, nullable=True)  # Digital Object Identifier
    size_in_kb = Column(Integer, nullable=True)  # Size of the paper file in KB

    # OpenAlex metadata
    open_alex_id = Column(String, nullable=True)  # OpenAlex ID for the paper

    user = relationship("User", back_populates="papers")
    conversations = relationship(
        "Conversation", back_populates="paper", cascade="all, delete-orphan"
    )
    paper_notes = relationship(
        "PaperNote", back_populates="paper", cascade="all, delete-orphan"
    )
    audio_overviews = relationship(
        "AudioOverview", back_populates="paper", cascade="all, delete-orphan"
    )
    audio_overview_jobs = relationship(
        "AudioOverviewJob", back_populates="paper", cascade="all, delete-orphan"
    )
    paper_images = relationship(
        "PaperImage", back_populates="paper", cascade="all, delete-orphan"
    )


class PaperImage(Base):
    __tablename__ = "paper_images"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    paper_id = Column(
        UUID(as_uuid=True), ForeignKey("papers.id", ondelete="CASCADE"), nullable=False
    )
    s3_object_key = Column(String, nullable=False)
    image_url = Column(String, nullable=False)
    format = Column(String, nullable=False)  # e.g., 'png', 'jpg'

    size_bytes = Column(Integer, nullable=False)  # Size of the image in bytes
    width = Column(Integer, nullable=False)  # Width of the image in pixels
    height = Column(Integer, nullable=False)  # Height of the image in pixels

    page_number = Column(
        Integer, nullable=False
    )  # Page number where the image is located
    image_index = Column(Integer, nullable=False)  # Index of the image in the paper

    caption = Column(Text, nullable=True)  # Optional caption for the image

    placeholder_id = Column(String, nullable=True)  # Placeholder ID for the image

    paper = relationship("Paper", back_populates="paper_images")


class Message(Base):
    __tablename__ = "messages"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    conversation_id = Column(
        UUID(as_uuid=True),
        ForeignKey("conversations.id", ondelete="CASCADE"),
        nullable=False,
    )
    role = Column(String, nullable=False)  # 'user' or 'assistant'
    content = Column(Text, nullable=False)

    # References from the paper
    references = Column(JSONB, nullable=True)

    bucket = Column(JSONB, nullable=True)  # For any additional attributes
    sequence = Column(Integer, nullable=False)  # To maintain message order
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    user = relationship("User", back_populates="messages")
    conversation = relationship("Conversation", back_populates="messages")


class Conversation(Base):
    __tablename__ = "conversations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    paper_id = Column(
        UUID(as_uuid=True),
        ForeignKey("papers.id", ondelete="CASCADE"),
        nullable=False,
    )
    title = Column(String, nullable=True)  # Optional conversation title
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    user = relationship("User", back_populates="conversations")

    paper = relationship("Paper", back_populates="conversations")
    messages = relationship(
        "Message",
        back_populates="conversation",
        order_by=Message.sequence,
        cascade="all, delete-orphan",
    )


class PaperNote(Base):
    __tablename__ = "paper_notes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Ensure each document has only one associated paper note
    paper_id = Column(
        UUID(as_uuid=True),
        ForeignKey("papers.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    content = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    user = relationship("User", back_populates="paper_notes")

    paper = relationship("Paper", back_populates="paper_notes")


class Highlight(Base):
    __tablename__ = "highlights"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    paper_id = Column(
        UUID(as_uuid=True), ForeignKey("papers.id", ondelete="CASCADE"), nullable=False
    )
    raw_text = Column(Text, nullable=False)

    # Position (exact for user, hints for AI)
    start_offset = Column(Integer, nullable=True)
    end_offset = Column(Integer, nullable=True)
    page_number = Column(Integer, nullable=True)

    # Role
    # This can be user for user-created highlights or assistant for AI-generated highlights
    role = Column(String, nullable=False, default="user")  # 'user' or 'assistant'
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    # Relationships
    user = relationship("User", back_populates="highlights")
    annotations = relationship(
        "Annotation", back_populates="highlight", cascade="all, delete-orphan"
    )


class Annotation(Base):
    __tablename__ = "annotations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # The associated highlight
    highlight_id = Column(
        UUID(as_uuid=True), ForeignKey("highlights.id"), nullable=False
    )

    # The associated paper
    paper_id = Column(
        UUID(as_uuid=True), ForeignKey("papers.id", ondelete="CASCADE"), nullable=False
    )
    content = Column(Text, nullable=False)

    # Role tracking
    role = Column(String, nullable=False, default="user")  # 'user' or 'assistant'
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)

    # Relationships
    user = relationship("User", back_populates="annotations")
    highlight = relationship("Highlight", back_populates="annotations")


class HypothesisJob(Base):
    __tablename__ = "hypothesis_jobs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)

    # Job metadata
    status = Column(String, nullable=False, default=JobStatus.PENDING)

    # Input data
    original_question = Column(Text, nullable=False)
    generated_hypothesis = Column(Text, nullable=True)

    # Progress tracking
    total_steps = Column(Integer, nullable=True)
    completed_steps = Column(Integer, default=0)

    # Error handling
    error_message = Column(Text, nullable=True)
    error_traceback = Column(Text, nullable=True)

    # Timing
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    user = relationship("User", back_populates="hypothesis_jobs")
    steps = relationship(
        "HypothesisStep", back_populates="job", cascade="all, delete-orphan"
    )
    research_result = relationship(
        "HypothesisResearchResult", back_populates="job", cascade="all, delete-orphan"
    )


class HypothesisStep(Base):
    __tablename__ = "hypothesis_steps"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id = Column(
        UUID(as_uuid=True),
        ForeignKey("hypothesis_jobs.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Step data from LLM
    question = Column(Text, nullable=False)
    motivation = Column(Text, nullable=False)
    search_terms = Column(ARRAY(String), nullable=False)

    # Step execution
    status = Column(String, nullable=False, default=JobStatus.PENDING)
    step_order = Column(Integer, nullable=False)

    # Results
    findings = Column(Text, nullable=True)

    # Error handling
    error_message = Column(Text, nullable=True)

    # Timing
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    job = relationship("HypothesisJob", back_populates="steps")
    papers = relationship(
        "HypothesisStepPaper", back_populates="step", cascade="all, delete-orphan"
    )


class HypothesisStepPaper(Base):
    __tablename__ = "hypothesis_step_papers"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    step_id = Column(
        UUID(as_uuid=True),
        ForeignKey("hypothesis_steps.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Paper metadata from OpenAlex
    external_id = Column(String, nullable=False)  # OpenAlex ID
    title = Column(Text, nullable=False)
    abstract = Column(Text, nullable=True)
    publication_year = Column(Integer, nullable=True)
    pdf_url = Column(String, nullable=True)
    doi = Column(String, nullable=True)
    cited_by_count = Column(Integer, nullable=True)

    # Processing data
    was_selected_for_scraping = Column(Boolean, default=False)
    scraping_attempted = Column(Boolean, default=False)
    scraping_successful = Column(Boolean, default=False)
    scraping_error = Column(Text, nullable=True)

    # Content
    raw_text = Column(Text, nullable=True)
    contextual_summary = Column(Text, nullable=True)

    # Reference tracking
    reference_idx = Column(Integer, nullable=True)

    # Timing
    scraped_at = Column(DateTime(timezone=True), nullable=True)
    summarized_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    step = relationship("HypothesisStep", back_populates="papers")


class HypothesisResearchResult(Base):
    __tablename__ = "hypothesis_research_results"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id = Column(
        UUID(as_uuid=True),
        ForeignKey("hypothesis_jobs.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )

    # Research response fields
    motivation = Column(Text, nullable=False)
    methodology = Column(Text, nullable=False)
    findings = Column(Text, nullable=False)
    limitations = Column(ARRAY(String), nullable=True, default=[])
    future_research = Column(ARRAY(String), nullable=True, default=[])

    # Relationships
    job = relationship("HypothesisJob", back_populates="research_result")


class AudioOverviewJob(Base):
    __tablename__ = "audio_overview_jobs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    paper_id = Column(
        UUID(as_uuid=True),
        ForeignKey("papers.id", ondelete="CASCADE"),
        nullable=False,
    )
    status = Column(String, nullable=False, default=JobStatus.PENDING)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    user = relationship("User", back_populates="audio_overview_jobs")
    paper = relationship("Paper", back_populates="audio_overview_jobs")


class AudioOverview(Base):
    __tablename__ = "audio_overviews"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    user_id = Column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )

    paper_id = Column(
        UUID(as_uuid=True),
        ForeignKey("papers.id", ondelete="CASCADE"),
        nullable=False,
    )

    s3_object_key = Column(
        String, nullable=False
    )  # Store the S3 object key of the wav file

    transcript = Column(Text, nullable=True)

    citations = Column(
        JSONB, nullable=True
    )  # Store citations in a JSONB format for flexibility. Typically, it would be a list of dicts with keys like `index` and `text`. See `AudioOverviewCitation` schema for more details.

    title = Column(String, nullable=True)

    paper = relationship("Paper", back_populates="audio_overviews")


class Subscription(Base):
    __tablename__ = "subscriptions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )

    # Subscription details
    plan = Column(String, nullable=False, default=SubscriptionPlan.BASIC)
    status = Column(String, nullable=False, default=SubscriptionStatus.ACTIVE)

    # Billing period
    current_period_start = Column(DateTime(timezone=True), nullable=True)
    current_period_end = Column(DateTime(timezone=True), nullable=True)

    # Stripe integration fields
    stripe_customer_id = Column(String, nullable=True)
    stripe_subscription_id = Column(String, nullable=True)
    stripe_price_id = Column(String, nullable=True)

    # Cancel at period end flag
    cancel_at_period_end = Column(Boolean, default=False)

    # When the subscription was canceled, if it was
    canceled_at = Column(DateTime(timezone=True), nullable=True)

    # Relationship with User
    user = relationship("User", back_populates="subscription")
