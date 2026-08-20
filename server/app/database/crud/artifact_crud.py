"""CRUD for first-party artifacts.

Every write goes through a validated payload and is fanned out into the typed
tables for its kind; every read reassembles the payload the API promises. No
caller hands this module a bare dict, and no reader has to know how a kind is
laid out.
"""

import logging
import uuid
from typing import Any, Dict, List, Optional, Sequence, Tuple

from app.database.crud.base_crud import CRUDBase
from app.database.crud.sanitization import sanitize_for_postgres
from app.database.models import (
    Artifact,
    ArtifactKind,
    ChartArtifact,
    ChartExcludedPaper,
    ChartField,
    ChartFieldRole,
    ChartRecord,
    ChartValue,
    CitationArtifact,
    ConversableType,
    Conversation,
    Message,
)
from app.schemas.artifact import ArtifactPayload, CitationArtifactPayload
from app.schemas.chart import ChartArtifactPayload
from app.schemas.user import CurrentUser
from pydantic import BaseModel
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


class ArtifactCreate(BaseModel):
    """Unused by callers; CRUDBase's generic signature requires a create type."""

    kind: ArtifactKind


class ArtifactUpdate(BaseModel):
    """Artifacts are written once. Nothing updates them in place."""


def _as_uuid(value: Any) -> Optional[uuid.UUID]:
    """A paper id as stored, or nothing when it is not one.

    Ids reach here as strings from payloads the model helped assemble, so a
    malformed one is possible; it costs that value rather than the write.
    """
    if isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        return None


def _citation_artifact(payload: CitationArtifactPayload) -> Optional[CitationArtifact]:
    paper_id = _as_uuid(payload.paper_id)
    if paper_id is None:
        logger.warning("Citation artifact has no usable paper id: %r", payload.paper_id)
        return None
    return CitationArtifact(
        paper_id=paper_id,
        preferred_style=payload.preferred_style,
        style_display=payload.style_display,
        method=payload.method,
        confidence=payload.confidence,
        missing_fields=list(payload.missing_fields),
        title=payload.data.title,
        authors=list(payload.data.authors),
        publish_date=payload.data.publish_date,
        journal=payload.data.journal,
        publisher=payload.data.publisher,
        doi=payload.data.doi,
    )


def _chart_fields(payload: ChartArtifactPayload) -> List[ChartField]:
    """The plan's fields as rows, each tagged with the position it occupies."""
    plan = payload.plan
    rows: List[ChartField] = []
    roles = [
        (ChartFieldRole.X, plan.x),
        (ChartFieldRole.Y, plan.y),
        (ChartFieldRole.SERIES, plan.series),
    ]
    for role, field in roles:
        if field is None:
            continue
        rows.append(
            ChartField(
                role=role.value,
                key=field.key,
                label=field.label,
                unit=field.unit,
                position=len(rows),
            )
        )
    # A plan often repeats x or y in `fields`; the role keeps them distinct, but
    # a primitive listed twice would collide on the unique constraint.
    seen: set[str] = set()
    for field in plan.fields:
        if field.key in seen:
            continue
        seen.add(field.key)
        rows.append(
            ChartField(
                role=ChartFieldRole.PRIMITIVE.value,
                key=field.key,
                label=field.label,
                unit=field.unit,
                position=len(rows),
            )
        )
    return rows


def _chart_records(payload: ChartArtifactPayload) -> List[ChartRecord]:
    rows: List[ChartRecord] = []
    for index, record in enumerate(payload.records):
        paper_id = _as_uuid(record.paper_id)
        if paper_id is None:
            logger.warning(
                "Dropping chart record %s: %r is not a paper id",
                record.record_id,
                record.paper_id,
            )
            continue
        rows.append(
            ChartRecord(
                record_key=record.record_id,
                paper_id=paper_id,
                paper_title=record.paper_title,
                exclusion_reason=record.exclusion_reason,
                position=index,
                values=[
                    ChartValue(
                        key=key,
                        value=value.value,
                        quote=value.quote,
                        line_number=value.line_number,
                        unit=value.unit,
                        conversion=value.conversion or "",
                        conversion_note=value.conversion_note,
                        number=value.number,
                        position=order,
                    )
                    for order, (key, value) in enumerate(record.values.items())
                ],
            )
        )
    return rows


def _chart_artifact(payload: ChartArtifactPayload) -> ChartArtifact:
    plan = payload.plan
    coverage = payload.coverage
    searched = [pid for pid in map(_as_uuid, coverage.searched_paper_ids) if pid]
    included = [pid for pid in map(_as_uuid, coverage.included_paper_ids) if pid]
    excluded: List[ChartExcludedPaper] = []
    for position, (paper_id, reason) in enumerate(coverage.excluded.items()):
        parsed = _as_uuid(paper_id)
        if parsed is None:
            continue
        excluded.append(
            ChartExcludedPaper(paper_id=parsed, reason=reason, position=position)
        )
    return ChartArtifact(
        title=plan.title,
        chart_type=plan.chart_type,
        series_by_paper=payload.series_by_paper,
        calculation_label=plan.calculation.label if plan.calculation else None,
        calculation_spec=plan.calculation.spec if plan.calculation else None,
        calculation_inputs=list(plan.calculation.inputs) if plan.calculation else [],
        searched_paper_ids=searched,
        included_paper_ids=included,
        warnings=list(payload.warnings),
        extraction_steps=list(payload.extraction_steps),
        computation=payload.computation,
        conversions=payload.conversions,
        investigation_trace=payload.investigation_trace,
        fields=_chart_fields(payload),
        records=_chart_records(payload),
        excluded_papers=excluded,
    )


def _build(payload: ArtifactPayload) -> Optional[Artifact]:
    """The ORM object for a payload, whichever kind it is."""
    # Postgres cannot store NUL, and quotes lifted out of a PDF sometimes carry
    # one. Sanitizing the payload rather than each column keeps one place to do
    # it, as it was when the whole thing was a single JSON column.
    cleaned = sanitize_for_postgres(payload.model_dump())
    if cleaned != payload.model_dump():
        logger.warning("Sanitized null characters from a %s artifact", payload.kind)
    if isinstance(payload, CitationArtifactPayload):
        return _citation_artifact(CitationArtifactPayload.model_validate(cleaned))
    return _chart_artifact(ChartArtifactPayload.model_validate(cleaned))


class ArtifactCRUD(CRUDBase[Artifact, ArtifactCreate, ArtifactUpdate]):
    """CRUD for the artifacts hierarchy."""

    def _persist(
        self,
        db: Session,
        *,
        artifact: Optional[Artifact],
        user: CurrentUser,
        scope_type: str,
        scope_id: Optional[uuid.UUID],
        message_id: Optional[uuid.UUID],
        auto_commit: bool = True,
    ) -> Optional[Artifact]:
        if artifact is None:
            return None
        artifact.user_id = user.id  # type: ignore[assignment]
        artifact.scope_type = scope_type  # type: ignore[assignment]
        artifact.scope_id = scope_id  # type: ignore[assignment]
        artifact.message_id = message_id  # type: ignore[assignment]
        try:
            db.add(artifact)
            if auto_commit:
                db.commit()
            else:
                db.flush()
            db.refresh(artifact)
            return artifact
        except Exception:
            db.rollback()
            logger.error("Error creating artifact", exc_info=True)
            return None

    def create_for_message(
        self,
        db: Session,
        *,
        message: Message,
        conversation: Conversation,
        payload: ArtifactPayload,
        user: CurrentUser,
        auto_commit: bool = True,
    ) -> Optional[Artifact]:
        """Insert one artifact, copying scope from the parent conversation."""
        return self._persist(
            db,
            artifact=_build(payload),
            user=user,
            scope_type=str(conversation.conversable_type),
            scope_id=conversation.conversable_id,  # type: ignore[arg-type]
            message_id=message.id,  # type: ignore[arg-type]
            auto_commit=auto_commit,
        )

    def create_for_scope(
        self,
        db: Session,
        *,
        payload: ArtifactPayload,
        scope_type: str,
        scope_id: Optional[uuid.UUID],
        user: CurrentUser,
        message_id: Optional[uuid.UUID] = None,
    ) -> Optional[Artifact]:
        """Create an artifact raised by a job rather than by a conversation.

        `message_id` is still accepted, because a job can be raised BY a chat
        turn and finish minutes later: the chart belongs to the turn that asked
        for it even though nothing about that turn was waiting. It stays
        optional for the composer, which has no conversation at all. Only kinds
        that can exist without a message may pass None; the table's own CHECK is
        the backstop.
        """
        return self._persist(
            db,
            artifact=_build(payload),
            user=user,
            scope_type=scope_type,
            scope_id=scope_id,
            message_id=message_id,
        )

    def bulk_create_for_message(
        self,
        db: Session,
        *,
        message: Message,
        conversation: Conversation,
        payloads: Sequence[ArtifactPayload],
        user: CurrentUser,
    ) -> List[Artifact]:
        """Insert several artifacts for one assistant message in a single commit."""
        created: List[Artifact] = []
        for payload in payloads:
            obj = self.create_for_message(
                db,
                message=message,
                conversation=conversation,
                payload=payload,
                user=user,
                auto_commit=False,
            )
            if obj is not None:
                created.append(obj)
        if created:
            db.commit()
        return created

    def list_for_scope(
        self,
        db: Session,
        *,
        scope_type: str,
        scope_id: Optional[uuid.UUID],
        user: CurrentUser,
        kinds: Optional[Sequence[ArtifactKind]] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> List[Artifact]:
        """List artifacts in a given scope (e.g. project panel feed).

        Returns every occurrence; callers attach conversation breadcrumbs.
        Ownership is enforced via user_id.
        """
        q = db.query(Artifact).filter(
            Artifact.user_id == user.id,
            Artifact.scope_type == scope_type,
        )
        if scope_id is not None:
            q = q.filter(Artifact.scope_id == scope_id)
        else:
            q = q.filter(Artifact.scope_id.is_(None))
        if kinds is not None:
            q = q.filter(Artifact.kind.in_([kind.value for kind in kinds]))
        return q.order_by(Artifact.created_at.desc()).offset(offset).limit(limit).all()

    def list_for_project(
        self,
        db: Session,
        *,
        project_id: uuid.UUID,
        kinds: Optional[Sequence[ArtifactKind]] = None,
        limit: int = 200,
        offset: int = 0,
    ) -> List[Tuple[Artifact, Optional[uuid.UUID], Optional[str]]]:
        """List artifacts across ALL members' conversations in a project.

        Deliberately no user_id filter: project conversations are visible to
        every member, so their artifacts are too. Callers MUST verify the
        requester holds a role in the project before calling this.

        Returns (artifact, conversation_id, conversation_title) so the panel can
        attach a breadcrumb back to the source conversation — absent for the
        artifacts a job raised, which never had one.
        """
        q = (
            db.query(Artifact, Conversation.id, Conversation.title)
            .outerjoin(Message, Artifact.message_id == Message.id)
            .outerjoin(Conversation, Message.conversation_id == Conversation.id)
            .filter(
                Artifact.scope_type == ConversableType.PROJECT.value,
                Artifact.scope_id == project_id,
            )
        )
        if kinds is not None:
            q = q.filter(Artifact.kind.in_([kind.value for kind in kinds]))
        return q.order_by(Artifact.created_at.desc()).offset(offset).limit(limit).all()

    def get_chart_for_project(
        self,
        db: Session,
        *,
        artifact_id: uuid.UUID,
        project_id: uuid.UUID,
    ) -> Optional[ChartArtifact]:
        """One chart in a project, for the full-detail view.

        Callers MUST verify the requester holds a role in the project.
        """
        return (
            db.query(ChartArtifact)
            .filter(
                ChartArtifact.id == artifact_id,
                ChartArtifact.scope_type == ConversableType.PROJECT.value,
                ChartArtifact.scope_id == project_id,
            )
            .first()
        )


def artifact_response(
    artifact: Artifact,
    *,
    conversation_id: Optional[uuid.UUID] = None,
    conversation_title: Optional[str] = None,
) -> Dict[str, Any]:
    """One artifact as the panel feed sends it."""
    return {
        "id": str(artifact.id),
        "kind": artifact.kind,
        "payload": artifact.to_payload(),
        "message_id": str(artifact.message_id) if artifact.message_id else None,
        "conversation_id": str(conversation_id) if conversation_id else None,
        "conversation_title": conversation_title,
        "created_at": (
            artifact.created_at.isoformat() if artifact.created_at else None
        ),
        "updated_at": (
            artifact.updated_at.isoformat() if artifact.updated_at else None
        ),
    }


artifact_crud = ArtifactCRUD(Artifact)
