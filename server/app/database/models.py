import uuid
from enum import Enum
from types import NoneType

from sqlalchemy import (  # type: ignore
    ARRAY,
    UUID,
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    and_,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.hybrid import hybrid_property
from sqlalchemy.orm import (  # type: ignore
    DeclarativeBase,
    foreign,
    relationship,
    sessionmaker,
)
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


class ProjectRoles(str, Enum):
    ADMIN = "admin"


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

    onboarding = relationship(
        "Onboarding",
        back_populates="user",
        uselist=False,
        cascade="all, delete-orphan",
    )

    project_roles = relationship("ProjectRole", back_populates="user")


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


class ConversableType(str, Enum):
    PAPER = "paper"
    PROJECT = "project"
    EVERYTHING = (
        "everything"  # For conversations that are across the user's entire library
    )


def generic_relationship(type_col_name, id_col_name):
    """Returns a property that emulates a generic relationship."""

    def getter(self):
        """Get the related object."""
        # Get the type and ID from the instance
        type_name = getattr(self, type_col_name)
        id_val = getattr(self, id_col_name)
        if type_name is None or id_val is None:
            return None

        # Get the session and find the object
        session = sessionmaker.object_session(self)
        if not session:
            # Cannot function without a session
            return None

        # Dynamically get the parent class from the Base's registry
        parent_class = self.registry.class_mapper(type_name).class_
        return session.get(parent_class, id_val)

    def setter(self, value):
        """Set the related object."""
        # Get the type and ID from the object being assigned
        type_name = value.__tablename__ if value else None
        id_val = value.id if value else None

        setattr(self, type_col_name, type_name)
        setattr(self, id_col_name, id_val)

    return property(getter, setter)


class Conversation(Base):
    __tablename__ = "conversations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title = Column(String, nullable=True)  # Optional conversation title
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    # Polymorphic Columns
    conversable_id = Column(UUID(as_uuid=True), nullable=True)
    conversable_type = Column(String, nullable=False, default=ConversableType.PAPER)
    conversable = generic_relationship("conversable_type", "conversable_id")

    # Specific relationship for papers
    paper = relationship(
        "Paper",
        primaryjoin=lambda: and_(
            foreign(Conversation.conversable_id) == Paper.id,
            Conversation.conversable_type == ConversableType.PAPER.value,
        ),
        viewonly=True,
    )

    user = relationship("User", back_populates="conversations")

    messages = relationship(
        "Message",
        back_populates="conversation",
        order_by=Message.sequence,
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        CheckConstraint(
            "(conversable_type = 'paper' AND conversable_id IS NOT NULL) OR "
            "(conversable_type = 'everything' AND conversable_id IS NULL)",
            name="check_conversable_consistency",
        ),
    )


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
        "Conversation",
        back_populates="paper",
        cascade="all, delete-orphan",
        primaryjoin=lambda: and_(
            Paper.id == foreign(Conversation.conversable_id),
            Conversation.conversable_type == ConversableType.PAPER.value,
        ),
    )
    paper_notes = relationship(
        "PaperNote", back_populates="paper", cascade="all, delete-orphan"
    )

    audio_overviews = relationship(
        "AudioOverview",
        cascade="all, delete-orphan",
        primaryjoin=lambda: and_(
            Paper.id == foreign(AudioOverview.conversable_id),
            AudioOverview.conversable_type == ConversableType.PAPER.value,
        ),
        overlaps="audio_overviews",
    )

    audio_overview_jobs = relationship(
        "AudioOverviewJob",
        cascade="all, delete-orphan",
        primaryjoin=lambda: and_(
            Paper.id == foreign(AudioOverviewJob.conversable_id),
            AudioOverviewJob.conversable_type == ConversableType.PAPER.value,
        ),
        overlaps="audio_overview_jobs",
    )

    paper_images = relationship(
        "PaperImage", back_populates="paper", cascade="all, delete-orphan"
    )

    project_papers = relationship("ProjectPaper", back_populates="paper")


class Project(Base):
    __tablename__ = "project"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title = Column(String, nullable=True)
    description = Column(Text, nullable=True)
    admin_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)

    project_roles = relationship("ProjectRole", back_populates="project")
    project_papers = relationship("ProjectPaper", back_populates="project")

    audio_overviews = relationship(
        "AudioOverview",
        cascade="all, delete-orphan",
        primaryjoin=lambda: and_(
            Project.id == foreign(AudioOverview.conversable_id),
            AudioOverview.conversable_type == ConversableType.PROJECT.value,
        ),
        overlaps="audio_overviews",
    )

    audio_overview_jobs = relationship(
        "AudioOverviewJob",
        cascade="all, delete-orphan",
        primaryjoin=lambda: and_(
            Project.id == foreign(AudioOverviewJob.conversable_id),
            AudioOverviewJob.conversable_type == ConversableType.PROJECT.value,
        ),
        overlaps="audio_overview_jobs",
    )


class ProjectRole(Base):
    __tablename__ = "project_role"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(
        UUID(as_uuid=True), ForeignKey("project.id", ondelete="CASCADE"), nullable=False
    )
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    role = Column(String, nullable=False, default=ProjectRoles.ADMIN)

    project = relationship("Project", back_populates="project_roles")
    user = relationship("User", back_populates="project_roles")


class ProjectPaper(Base):
    """
    Association table for linking papers and projects. This is because projects can have many papers and papers can belong to many projects.
    """

    __tablename__ = "project_paper"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    paper_id = Column(
        UUID(as_uuid=True), ForeignKey("papers.id", ondelete="RESTRICT"), nullable=False
    )
    project_id = Column(
        UUID(as_uuid=True), ForeignKey("project.id", ondelete="CASCADE"), nullable=False
    )

    project = relationship("Project", back_populates="project_papers")
    paper = relationship("Paper", back_populates="project_papers")


class ProjectAudioOverview(Base):
    __tablename__ = "project_audio_overview"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(
        UUID(as_uuid=True), ForeignKey("project.id", ondelete="CASCADE"), nullable=False
    )
    audio_overview_id = Column(
        UUID(as_uuid=True),
        ForeignKey("audio_overviews.id", ondelete="CASCADE"),
        nullable=False,
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


class HighlightType(str, Enum):
    TOPIC = "topic"
    MOTIVATION = "motivation"
    METHOD = "method"
    EVIDENCE = "evidence"
    RESULT = "result"
    IMPACT = "impact"
    GENERAL = "general"


class Highlight(Base):
    __tablename__ = "highlights"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    paper_id = Column(
        UUID(as_uuid=True), ForeignKey("papers.id", ondelete="CASCADE"), nullable=False
    )
    raw_text = Column(Text, nullable=False)
    type = Column(String, nullable=True)  # HighlightType enum value)

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

    conversable_id = Column(UUID(as_uuid=True), nullable=False)
    conversable_type = Column(String, nullable=False, default=ConversableType.PAPER)
    conversable = generic_relationship("conversable_type", "conversable_id")

    status = Column(String, nullable=False, default=JobStatus.PENDING)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    user = relationship("User", back_populates="audio_overview_jobs")

    # Specific relationship for papers (viewonly)
    paper = relationship(
        "Paper",
        primaryjoin=lambda: and_(
            foreign(AudioOverviewJob.conversable_id) == Paper.id,
            AudioOverviewJob.conversable_type == ConversableType.PAPER.value,
        ),
        viewonly=True,
    )

    __table_args__ = (
        CheckConstraint(
            "(conversable_type = 'paper' AND conversable_id IS NOT NULL) OR "
            "(conversable_type = 'project' AND conversable_id IS NOT NULL) OR "
            "(conversable_type = 'everything' AND conversable_id IS NULL)",
            name="check_audio_overview_job_conversable_consistency",
        ),
    )


class AudioOverview(Base):
    __tablename__ = "audio_overviews"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    user_id = Column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )

    s3_object_key = Column(
        String, nullable=False
    )  # Store the S3 object key of the wav file

    transcript = Column(Text, nullable=True)

    citations = Column(
        JSONB, nullable=True
    )  # Store citations in a JSONB format for flexibility. Typically, it would be a list of dicts with keys like `index` and `text`.

    title = Column(String, nullable=True)

    conversable_id = Column(UUID(as_uuid=True), nullable=False)
    conversable_type = Column(String, nullable=False, default=ConversableType.PAPER)
    conversable = generic_relationship("conversable_type", "conversable_id")

    # Specific relationship for papers (viewonly)
    paper = relationship(
        "Paper",
        primaryjoin=lambda: and_(
            foreign(AudioOverview.conversable_id) == Paper.id,
            AudioOverview.conversable_type == ConversableType.PAPER.value,
        ),
        viewonly=True,
    )

    __table_args__ = (
        CheckConstraint(
            "(conversable_type = 'paper' AND conversable_id IS NOT NULL) OR "
            "(conversable_type = 'project' AND conversable_id IS NOT NULL) OR "
            "(conversable_type = 'everything' AND conversable_id IS NULL)",
            name="check_audio_overview_conversable_consistency",
        ),
    )


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


class Onboarding(Base):
    __tablename__ = "onboarding"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # Basic user information
    name = Column(String, nullable=True)
    email = Column(String, nullable=True)
    company = Column(String, nullable=True)

    # Research fields (stored as comma-separated string)
    research_fields = Column(String, nullable=True)
    research_fields_other = Column(String, nullable=True)

    # Job titles (stored as comma-separated string)
    job_titles = Column(String, nullable=True)
    job_titles_other = Column(String, nullable=True)

    # Reading frequency
    reading_frequency = Column(String, nullable=True)

    # Referral source
    referral_source = Column(String, nullable=True)
    referral_source_other = Column(String, nullable=True)

    user = relationship("User", back_populates="onboarding")
