"""CRUD for first-party artifacts (citations today; charts/images later)."""

import uuid
from typing import Any, Dict, List, Optional

from app.database.crud.base_crud import CRUDBase
from app.database.models import (
    Artifact,
    ArtifactKind,
    ConversableType,
    Conversation,
    Message,
)
from app.schemas.user import CurrentUser
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session


class ArtifactCreate(BaseModel):
    kind: ArtifactKind
    payload: Dict[str, Any]
    message_id: uuid.UUID
    scope_type: str  # ConversableType value
    scope_id: Optional[uuid.UUID] = None


class ArtifactUpdate(BaseModel):
    payload: Optional[Dict[str, Any]] = None


class ArtifactCRUD(CRUDBase[Artifact, ArtifactCreate, ArtifactUpdate]):
    """CRUD for the artifacts table."""

    def create_for_message(
        self,
        db: Session,
        *,
        message: Message,
        conversation: Conversation,
        kind: ArtifactKind,
        payload: Dict[str, Any],
        user: CurrentUser,
    ) -> Optional[Artifact]:
        """Insert a single artifact, copying scope from the parent conversation."""
        obj_in = ArtifactCreate(
            kind=kind,
            payload=payload,
            message_id=message.id,  # type: ignore[arg-type]
            scope_type=str(conversation.conversable_type),
            scope_id=conversation.conversable_id,  # type: ignore[arg-type]
        )
        return self.create(db, obj_in=obj_in, user=user)

    def bulk_create_for_message(
        self,
        db: Session,
        *,
        message: Message,
        conversation: Conversation,
        items: List[tuple[ArtifactKind, Dict[str, Any]]],
        user: CurrentUser,
    ) -> List[Artifact]:
        """Insert several artifacts for one assistant message in a single commit."""
        created: List[Artifact] = []
        for kind, payload in items:
            obj = self.create_for_message(
                db,
                message=message,
                conversation=conversation,
                kind=kind,
                payload=payload,
                user=user,
            )
            if obj is not None:
                created.append(obj)
        return created

    def list_for_scope(
        self,
        db: Session,
        *,
        scope_type: str,
        scope_id: Optional[uuid.UUID],
        user: CurrentUser,
        kind: Optional[ArtifactKind] = None,
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
        if kind is not None:
            q = q.filter(Artifact.kind == kind.value)
        return q.order_by(Artifact.created_at.desc()).offset(offset).limit(limit).all()

    def list_for_project(
        self,
        db: Session,
        *,
        project_id: uuid.UUID,
        kind: Optional[ArtifactKind] = None,
        limit: int = 200,
        offset: int = 0,
    ) -> List[tuple[Artifact, uuid.UUID, Optional[str]]]:
        """List artifacts across ALL members' conversations in a project.

        Deliberately no user_id filter: project conversations are visible to
        every member, so their artifacts are too. Callers MUST verify the
        requester holds a role in the project before calling this.

        Returns (artifact, conversation_id, conversation_title) so the panel
        can attach a breadcrumb back to the source conversation.
        """
        q = (
            db.query(Artifact, Conversation.id, Conversation.title)
            .join(Message, Artifact.message_id == Message.id)
            .join(Conversation, Message.conversation_id == Conversation.id)
            .filter(
                Artifact.scope_type == ConversableType.PROJECT.value,
                Artifact.scope_id == project_id,
            )
        )
        if kind is not None:
            q = q.filter(Artifact.kind == kind.value)
        return q.order_by(Artifact.created_at.desc()).offset(offset).limit(limit).all()


artifact_crud = ArtifactCRUD(Artifact)
