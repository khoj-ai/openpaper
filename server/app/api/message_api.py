import json
import logging
import uuid
from datetime import datetime, timezone
from typing import AsyncGenerator, List, Optional, Union, cast

from app.auth.dependencies import get_required_user
from app.database.crud.artifact_crud import artifact_crud
from app.database.crud.conversation_crud import conversation_crud
from app.database.crud.highlight_crud import highlight_crud
from app.database.crud.message_crud import MessageCreate, message_crud
from app.database.crud.paper_crud import paper_crud
from app.database.crud.projects.project_chart_crud import chart_job_crud
from app.database.crud.projects.project_conversation_crud import (
    project_conversation_crud,
)
from app.database.crud.projects.project_crud import project_crud
from app.database.crud.projects.project_paper_crud import project_paper_crud
from app.database.database import get_db
from app.database.models import Annotation, ConversableType
from app.database.telemetry import track_event
from app.llm.base import LLMProvider
from app.llm.citation_handler import CitationHandler
from app.llm.operations import operations
from app.schemas.artifact import artifact_payload_adapter
from app.schemas.message import EvidenceCollection, ResponseStyle
from app.schemas.user import CurrentUser
from app.tasks.chart_generation import generate_chart
from dotenv import load_dotenv
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ValidationError
from sqlalchemy.orm import Session

load_dotenv()

logger = logging.getLogger(__name__)

logger.setLevel(logging.INFO)

# Create API router with prefix
message_router = APIRouter()

END_DELIMITER = "END_OF_STREAM"

ANSWER_FAILED_MESSAGE = (
    "I ran into a problem writing this response. Please try asking again — if it "
    "keeps happening, contact support (saba@openpaper.ai)."
)


def _append_status(messages: Optional[List[str]], message: str) -> None:
    """Append a status message, collapsing consecutive duplicates (e.g. heartbeats)."""
    if messages is None or not message:
        return
    if not messages or messages[-1] != message:
        messages.append(message)


async def _stream_chat_chunks(
    chunk_generator: AsyncGenerator[Union[dict, str], None],
    content_chunks: List[str],
    evidence_container: dict,
    artifacts: Optional[List] = None,
    status_messages: Optional[List[str]] = None,
    errors: Optional[List[str]] = None,
) -> AsyncGenerator[str, None]:
    """Helper to stream chat chunks and handle common logic.

    Anything appended to `errors` has already been reported to the client, so
    the caller can tell a turn that failed loudly from one that simply ended
    with nothing to show.
    """
    async for chunk in chunk_generator:
        if not isinstance(chunk, dict):
            logger.warning(f"Received unexpected chunk format: {chunk}")
            continue

        chunk_type = chunk.get("type")
        chunk_content = chunk.get("content", "")

        if chunk_type == "reset":
            # The upstream connection dropped mid-answer and the request was
            # re-sent from scratch. Everything accumulated so far belongs to the
            # abandoned attempt — drop it here so the persisted message is the
            # replacement answer, and forward the signal so the client clears
            # what it already rendered.
            # Only the answer stream is discarded: artifacts and status
            # messages come from the evidence-gathering phase that ran before
            # this stream opened, and are still valid.
            content_chunks.clear()
            evidence_container["evidence"] = None
            yield f"{json.dumps({'type': 'reset', 'content': ''})}{END_DELIMITER}"
            continue

        if chunk_type == "artifact":
            if artifacts is not None:
                artifacts.append(chunk_content)
            try:
                yield f"{json.dumps({'type': 'artifact', 'content': chunk_content})}{END_DELIMITER}"
            except (TypeError, ValueError) as json_error:
                logger.warning(f"Failed to serialize artifact: {json_error}")
            continue

        if chunk_type == "content":
            content_chunks.append(chunk_content)
            try:
                json_response = json.dumps(
                    {"type": "content", "content": chunk_content}
                )
                yield f"{json_response}{END_DELIMITER}"
            except (TypeError, ValueError) as json_error:
                logger.warning(f"Failed to serialize chunk content: {json_error}")
                safe_content = (
                    str(chunk_content).encode("utf-8", errors="replace").decode("utf-8")
                )
                json_response = json.dumps({"type": "content", "content": safe_content})
                yield f"{json_response}{END_DELIMITER}"

        elif chunk_type == "references":
            evidence_container["evidence"] = chunk_content
            try:
                json_response = json.dumps(
                    {"type": "references", "content": chunk_content}
                )
                yield f"{json_response}{END_DELIMITER}"
            except (TypeError, ValueError) as json_error:
                logger.warning(f"Failed to serialize references: {json_error}")
                yield f"{json.dumps({'type': 'error', 'content': 'Failed to serialize references'})}{END_DELIMITER}"
        elif chunk_type == "status":
            _append_status(status_messages, chunk_content)
            yield f"{json.dumps({'type': 'status', 'content': chunk_content})}{END_DELIMITER}"
        elif chunk_type == "error":
            # The answer stream failed. Forwarding this is what turns a blank
            # message into something the user can act on — the client renders
            # it and stops the turn. Dropping it here left the two
            # indistinguishable.
            logger.error(f"Error while streaming the answer: {chunk_content}")
            if errors is not None:
                errors.append(str(chunk_content))
            yield f"{json.dumps({'type': 'error', 'content': chunk_content})}{END_DELIMITER}"


@message_router.get("/models")
async def get_available_models() -> dict:
    return {
        "models": operations.get_chat_model_options(),
        "default": operations.default_provider.value,
    }


class MultiPaperChatRequest(BaseModel):
    conversation_id: str
    user_query: str
    user_references: Optional[List[str]] = None
    llm_provider: Optional[LLMProvider] = None
    project_id: Optional[str] = None
    # @-mention scoping: when any of these are set, the chat's search space is
    # hard-limited to the union of the mentioned papers, the papers in the
    # mentioned projects, and the parent papers of the mentioned highlights.
    mentioned_paper_ids: Optional[List[str]] = None
    mentioned_project_ids: Optional[List[str]] = None
    mentioned_highlight_ids: Optional[List[str]] = None


def _resolve_mention_scope(
    db: Session,
    current_user: CurrentUser,
    request: "MultiPaperChatRequest",
) -> tuple[Optional[List[str]], Optional[List[dict]], Optional[List[dict]]]:
    """Resolve @-mentions into (scoped_paper_ids, scope_snapshot, highlights).

    - scoped_paper_ids: the flat, user-scoped set of paper ids the search is
      hard-limited to — a paper mention contributes itself, a project mention
      contributes all of its papers, a highlight mention contributes its parent
      paper. Used for retrieval scoping.
    - scope_snapshot: a denormalized [{kind, id, title, ...}] of the mentioned
      entities themselves (a project stays a single entry, not its papers),
      persisted on the user message so it renders faithfully later.
    - highlights: [{paper_id, highlighted_text, notes}] for the mentioned
      highlights, injected into the answer prompt so the model sees the exact
      attached passages.

    Every id is resolved through a user-scoped CRUD call, so a mention the user
    can't access is silently dropped. All values are None when there are no
    mentions at all (i.e. no scoping should be applied).
    """
    if (
        not request.mentioned_paper_ids
        and not request.mentioned_project_ids
        and not request.mentioned_highlight_ids
    ):
        return None, None, None

    scoped: set[str] = set()
    snapshot: List[dict] = []

    for paper_id in request.mentioned_paper_ids or []:
        # In a project chat, resolve via project access (papers may be shared,
        # i.e. not owned by the current user); otherwise resolve by ownership.
        if request.project_id:
            paper = project_paper_crud.get_paper_by_project(
                db,
                paper_id=uuid.UUID(paper_id),
                project_id=uuid.UUID(request.project_id),
                user=current_user,
            )
        else:
            paper = paper_crud.get(db, id=paper_id, user=current_user)
        if paper:
            scoped.add(str(paper.id))
            snapshot.append(
                {"kind": "paper", "id": str(paper.id), "title": paper.title}
            )

    for project_id in request.mentioned_project_ids or []:
        project = project_crud.get(db, id=project_id, user=current_user)
        if not project:
            continue
        paper_ids = project_paper_crud.get_project_paper_ids_by_project_id(
            db, project_id=uuid.UUID(project_id), user=current_user
        )
        scoped.update(str(pid) for pid in paper_ids)
        snapshot.append(
            {"kind": "project", "id": str(project.id), "title": project.title}
        )

    # Mentioned highlights are grouped by parent paper so each highlighted
    # passage is delivered with that paper's title + abstract for grounding,
    # rather than a bare paper id the model would have to cross-reference.
    highlights_by_paper: dict[str, dict] = {}
    for highlight_id in request.mentioned_highlight_ids or []:
        highlight = highlight_crud.get(db, id=highlight_id, user=current_user)
        if not highlight:
            continue
        paper_id_str = str(highlight.paper_id)
        # The parent paper joins the search scope so it stays searchable.
        scoped.add(paper_id_str)

        group = highlights_by_paper.get(paper_id_str)
        if group is None:
            paper = paper_crud.get(db, id=paper_id_str, user=current_user)
            group = {
                "paper_id": paper_id_str,
                "paper_title": paper.title if paper else None,
                "paper_abstract": paper.abstract if paper else None,
                "highlights": [],
            }
            highlights_by_paper[paper_id_str] = group

        highlight_annotations = cast(list[Annotation], highlight.annotations)
        annotation_contents = [
            annotation.content
            for annotation in highlight_annotations
            if annotation.content
        ]

        snapshot.append(
            {
                "kind": "highlight",
                "id": str(highlight.id),
                "title": highlight.raw_text,
                "paper_id": paper_id_str,
                "paper_title": group["paper_title"],
                "annotations": annotation_contents,
            }
        )

        group["highlights"].append(
            {
                "highlighted_text": highlight.raw_text,
                "page_number": highlight.page_number,
                "annotations": annotation_contents,
            }
        )

    return list(scoped), snapshot, list(highlights_by_paper.values())


@message_router.post("/chat/everything")
async def chat_message_multipaper(
    request: MultiPaperChatRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
) -> StreamingResponse:
    """
    Send a chat message and stream the response from the LLM.

    This searches over the entire corpus of papers and returns a response based on the user's query.
    The response includes both the content and any relevant evidence gathered.
    """
    try:

        async def response_generator():
            try:
                content_chunks = []
                artifacts_collected: List[dict] = []
                status_messages: List[str] = []
                stream_errors: List[str] = []
                start_time = datetime.now(timezone.utc)
                evidence_container = {"evidence": None}
                evidence_collection: Optional[EvidenceCollection] = None
                project = None

                # Ensure conversation is valid
                if request.project_id:
                    project = project_crud.get(
                        db, id=request.project_id, user=current_user
                    )

                    if not project:
                        raise ValueError("Project not found.")

                    conversation = project_conversation_crud.get_by_conversation_id(
                        db,
                        project_id=uuid.UUID(request.project_id),
                        conversation_id=uuid.UUID(request.conversation_id),
                        user=current_user,
                    )
                else:
                    conversation = conversation_crud.get(
                        db, request.conversation_id, user=current_user
                    )

                # Multi-paper conversation must either be of type EVERYTHING or PROJECT. If it is a PROJECT conversation, naturally we need a `project_id`.

                if not conversation:
                    raise HTTPException(
                        status_code=404, detail="Conversation not found."
                    )

                if (
                    conversation.conversable_type != ConversableType.EVERYTHING
                    and not request.project_id
                ):
                    raise ValueError("Conversation is not of type EVERYTHING.")

                if (
                    request.project_id
                    and conversation.conversable_type != ConversableType.PROJECT
                ):
                    raise ValueError("Conversation is not of type PROJECT.")

                # @-mention scoping: resolve mentioned papers/projects/highlights
                # into a flat set of in-scope paper ids (None == no scoping), a
                # denormalized snapshot to persist on the user message, and the
                # highlight passages to inject into the answer.
                (
                    scoped_paper_ids,
                    scope_snapshot,
                    mentioned_highlights,
                ) = _resolve_mention_scope(db, current_user, request)

                async for chunk in operations.gather_evidence(
                    conversation_id=request.conversation_id,
                    question=request.user_query,
                    current_user=current_user,
                    llm_provider=LLMProvider.GEMINI,
                    user_references=request.user_references,
                    db=db,
                    project_id=request.project_id,
                    restrict_to_paper_ids=scoped_paper_ids,
                ):
                    # Parse the chunk as a dictionary
                    if isinstance(chunk, dict):
                        chunk_type = chunk.get("type")
                        chunk_content = chunk.get("content", "")

                        if chunk_type == "evidence_gathered":
                            # Use the EvidenceCollection directly (preserves is_compacted and citation_index)
                            assert isinstance(
                                chunk_content, EvidenceCollection
                            ), "Chunk content must be an EvidenceCollection"
                            evidence_collection = chunk_content
                        elif chunk_type == "status":
                            _append_status(status_messages, chunk_content)
                            yield f"{json.dumps({'type': 'status', 'content': chunk_content})}{END_DELIMITER}"
                        else:
                            logger.debug(f"received chunks: {chunk}")

                # Artifacts (a citation card) and queued charts count as real
                # outcomes — only short-circuit if we have none of them. A
                # chart request in particular can gather no passages at all and
                # still be the whole point of the turn, and bailing here would
                # strand its job as permanently pending.
                if evidence_collection is None or (
                    len(evidence_collection.evidence) == 0
                    and len(evidence_collection.artifacts) == 0
                    and len(evidence_collection.chart_jobs) == 0
                ):
                    json_response = json.dumps(
                        {
                            "type": "content",
                            "content": "It looks like I couldn't find any relevant papers for your question. Please try rephrasing your question. If you think this is an error, please contact support.",
                        }
                    )
                    yield f"{json_response}{END_DELIMITER}"
                    return

                if request.project_id:
                    all_papers = project_paper_crud.get_all_papers_by_project_id(
                        db, project_id=uuid.UUID(request.project_id), user=current_user
                    )
                else:
                    all_papers = paper_crud.get_all_available_papers(
                        db, user=current_user
                    )
                if scoped_paper_ids is not None:
                    allowed_ids = set(scoped_paper_ids)
                    all_papers = [
                        paper for paper in all_papers if str(paper.id) in allowed_ids
                    ]

                # Charts are queued by the evidence-gathering model, which calls
                # create_chart_artifact when it judges the question wants one.
                # Nothing is built here: a chart is minutes of investigation,
                # and running it inline held the whole turn — the user waited on
                # a spinner before a single word of the answer appeared. The
                # jobs surface now as pending cards and are dispatched once this
                # turn is saved.
                chart_jobs = evidence_collection.get_chart_jobs()
                for job in chart_jobs:
                    yield f"{json.dumps({'type': 'chart_job', 'content': job})}{END_DELIMITER}"

                yield f"{json.dumps({'type': 'status', 'content': 'Generating response...'})}{END_DELIMITER}"

                chat_generator = operations.chat_with_papers(
                    question=request.user_query,
                    llm_provider=request.llm_provider,
                    user_references=request.user_references,
                    evidence_gathered=evidence_collection,
                    conversation_id=request.conversation_id,
                    current_user=current_user,
                    all_papers=all_papers,
                    mentioned_highlights=mentioned_highlights,
                    project_title=str(project.title) if project else None,
                    is_mention_scoped=scoped_paper_ids is not None,
                    db=db,
                )
                async for stream_chunk in _stream_chat_chunks(
                    chunk_generator=chat_generator,
                    content_chunks=content_chunks,
                    evidence_container=evidence_container,
                    artifacts=artifacts_collected,
                    status_messages=status_messages,
                    errors=stream_errors,
                ):
                    yield stream_chunk

                evidence = evidence_container["evidence"]

                # Save the complete message to the database
                full_content = "".join(content_chunks)

                # An answer that produced no text is a failure, not a turn.
                # Persisting it puts a blank bubble in the thread and — worse —
                # replays an empty model part into the history of every later
                # turn in this conversation, which visibly degrades them. Say
                # what happened instead and leave the thread as it was.
                if not full_content.strip() and not artifacts_collected:
                    logger.error(
                        "Answer stream produced no content for conversation %s; "
                        "not saving an empty turn.",
                        request.conversation_id,
                    )
                    # Counted as well as logged. This failure used to be
                    # invisible from every direction — nothing raised, the
                    # request returned 200, and the only trace was a blank row
                    # that looked like a real message. A metric is what makes a
                    # regression here noticeable before a user reports it.
                    track_event(
                        "chat_answer_empty",
                        properties={
                            "had_stream_error": bool(stream_errors),
                            "has_evidence": bool(evidence),
                            "type": conversation.conversable_type,
                            "project_id": request.project_id,
                        },
                        user_id=str(current_user.id),
                        db=db,
                    )
                    if not stream_errors:
                        yield f"{json.dumps({'type': 'error', 'content': ANSWER_FAILED_MESSAGE})}{END_DELIMITER}"
                    return

                assistant_trace = (
                    evidence_collection.to_trace_dict() if evidence_collection else None
                )
                # Fold in the live status messages (the "thinking trace") so it
                # survives reloads, even when there were no tool calls.
                if status_messages:
                    assistant_trace = assistant_trace or {}
                    assistant_trace["status_messages"] = status_messages

                # Surface the trajectory live so the just-answered message can show
                # it immediately (it's also persisted for reload below).
                if assistant_trace:
                    yield f"{json.dumps({'type': 'trace', 'content': assistant_trace})}{END_DELIMITER}"

                formatted_references = (
                    CitationHandler.convert_references_to_dict(
                        references=request.user_references
                    )
                    if request.user_references
                    else None
                )

                # Save user message, with the @-mention scope snapshot attached.
                message_crud.create(
                    db,
                    obj_in=MessageCreate(
                        conversation_id=uuid.UUID(request.conversation_id),
                        role="user",
                        content=request.user_query,
                        references=formatted_references,
                        scope=scope_snapshot,
                    ),
                    user=current_user,
                )

                # Save assistant message with content, evidence, and trace.
                # Artifacts go into their own table, linked back via message_id.
                assistant_message = message_crud.create(
                    db,
                    obj_in=MessageCreate(
                        conversation_id=uuid.UUID(request.conversation_id),
                        role="assistant",
                        content=full_content,
                        references=evidence if evidence else None,
                        trace=assistant_trace,
                    ),
                    user=current_user,
                )

                if assistant_message and artifacts_collected:
                    # Each collected dict is whatever was streamed to the client
                    # as a card. Its own `kind` selects the member to parse it
                    # as, so an artifact that does not match its kind's shape
                    # fails here rather than being stored as an unreadable blob.
                    payloads = []
                    for raw in artifacts_collected:
                        try:
                            payloads.append(
                                artifact_payload_adapter.validate_python(raw)
                            )
                        except ValidationError:
                            logger.warning(
                                "Discarding malformed %r artifact",
                                raw.get("kind"),
                                exc_info=True,
                            )
                    artifact_crud.bulk_create_for_message(
                        db,
                        message=assistant_message,
                        conversation=conversation,
                        payloads=payloads,
                        user=current_user,
                    )

                # Charts are dispatched only now, because the turn they belong
                # to did not exist when the jobs were raised. Attaching them
                # first is what lets a finished chart land back in this turn,
                # and lets a reload show the pending card in the right place.
                if assistant_message and request.project_id:
                    for job in chart_jobs:
                        job_id = uuid.UUID(job["id"])
                        chart_job_crud.update(
                            db,
                            job_id=job_id,
                            message_id=assistant_message.id,  # type: ignore[arg-type]
                        )
                        background_tasks.add_task(
                            generate_chart,
                            job_id=job_id,
                            project_id=uuid.UUID(request.project_id),
                            user=current_user,
                        )

                # Rename the conversation based on the chat history
                operations.rename_conversation(
                    db=db, conversation_id=request.conversation_id, user=current_user
                )

                # @-mention scoping usage: whether the client asked to scope,
                # what actually resolved (by entity type), and the effective
                # search-space size after resolution.
                scope_items = scope_snapshot or []
                mention_scope_props = {
                    "requested_mention_scope": bool(
                        request.mentioned_paper_ids
                        or request.mentioned_project_ids
                        or request.mentioned_highlight_ids
                    ),
                    "used_mention_scope": len(scope_items) > 0,
                    "num_mentioned_papers": sum(
                        1 for i in scope_items if i.get("kind") == "paper"
                    ),
                    "num_mentioned_projects": sum(
                        1 for i in scope_items if i.get("kind") == "project"
                    ),
                    "num_mentioned_highlights": sum(
                        1 for i in scope_items if i.get("kind") == "highlight"
                    ),
                    "num_scoped_papers": (
                        len(scoped_paper_ids) if scoped_paper_ids is not None else 0
                    ),
                }

                # Track chat message event
                track_event(
                    "did_chat_message",
                    properties={
                        "has_user_references": bool(request.user_references),
                        "has_evidence": bool(evidence),
                        "llm_provider": (
                            request.llm_provider.value
                            if request.llm_provider
                            else "default"
                        ),
                        "time_taken": (
                            datetime.now(timezone.utc) - start_time
                        ).total_seconds(),
                        "type": conversation.conversable_type,
                        "project_id": request.project_id,
                        **mention_scope_props,
                    },
                    user_id=str(current_user.id),
                    db=db,
                )

            except Exception as e:

                # Track error event
                track_event(
                    "everything_chat_message_error",
                    properties={
                        "error": str(e),
                        "type": "everything",
                        "conversation_id": str(request.conversation_id),
                    },
                    user_id=str(current_user.id),
                    db=db,
                )

                logger.error(f"Error in streaming response: {e}", exc_info=True)
                yield f"{json.dumps({'type': 'error', 'content': str(e)})}{END_DELIMITER}"

        return StreamingResponse(response_generator(), media_type="text/event-stream")

    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error processing chat message: {e}")
        raise HTTPException(status_code=400, detail=str(e))


# Add this new model for the chat request
class ChatMessageRequest(BaseModel):
    paper_id: str
    conversation_id: str
    user_query: str
    user_references: Optional[List[str]] = None
    style: Optional[ResponseStyle] = ResponseStyle.NORMAL
    llm_provider: Optional[LLMProvider] = None


@message_router.post("/chat/paper")
async def chat_message_stream(
    request: ChatMessageRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
) -> StreamingResponse:
    """
    Send a chat message and stream the response from the LLM

    The response style can be:
    - normal: Standard balanced response
    - concise: Short and to the point
    - detailed: Comprehensive and thorough
    """
    try:

        async def response_generator():
            try:
                content_chunks = []
                stream_errors: List[str] = []
                start_time = datetime.now(timezone.utc)
                evidence_container = {"evidence": None}

                chat_generator = operations.chat_with_paper(
                    paper_id=request.paper_id,
                    conversation_id=request.conversation_id,
                    question=request.user_query,
                    current_user=current_user,
                    llm_provider=request.llm_provider,
                    user_references=request.user_references,
                    response_style=request.style,
                    db=db,
                )

                async for chunk in _stream_chat_chunks(
                    chunk_generator=chat_generator,
                    content_chunks=content_chunks,
                    evidence_container=evidence_container,
                    errors=stream_errors,
                ):
                    yield chunk

                evidence = evidence_container["evidence"]

                # Save the complete message to the database
                full_content = "".join(content_chunks)

                # An answer that produced no text is a failure, not a turn.
                # Persisting it puts a blank bubble in the thread and — worse —
                # replays an empty model part into the history of every later
                # turn in this conversation, which visibly degrades them. Say
                # what happened instead and leave the thread as it was.
                if not full_content.strip():
                    logger.error(
                        "Answer stream produced no content for conversation %s; "
                        "not saving an empty turn.",
                        request.conversation_id,
                    )
                    track_event(
                        "chat_answer_empty",
                        properties={
                            "had_stream_error": bool(stream_errors),
                            "has_evidence": bool(evidence),
                            "type": "paper",
                        },
                        user_id=str(current_user.id),
                        db=db,
                    )
                    if not stream_errors:
                        yield f"{json.dumps({'type': 'error', 'content': ANSWER_FAILED_MESSAGE})}{END_DELIMITER}"
                    return

                formatted_references = (
                    CitationHandler.convert_references_to_dict(
                        references=request.user_references
                    )
                    if request.user_references
                    else None
                )

                # Save user message
                message_crud.create(
                    db,
                    obj_in=MessageCreate(
                        conversation_id=uuid.UUID(request.conversation_id),
                        role="user",
                        content=request.user_query,
                        references=formatted_references,
                    ),
                    user=current_user,
                )

                # Save assistant message with both content and evidence
                message_crud.create(
                    db,
                    obj_in=MessageCreate(
                        conversation_id=uuid.UUID(request.conversation_id),
                        role="assistant",
                        content=full_content,
                        references=evidence if evidence else None,
                    ),
                    user=current_user,
                )

                # Track chat message event
                track_event(
                    "did_chat_message",
                    properties={
                        "response_style": (
                            request.style.value if request.style else "normal"
                        ),
                        "has_user_references": bool(request.user_references),
                        "has_evidence": bool(evidence),
                        "llm_provider": (
                            request.llm_provider.value
                            if request.llm_provider
                            else "default"
                        ),
                        "time_taken": (
                            datetime.now(timezone.utc) - start_time
                        ).total_seconds(),
                        "paper_id": str(request.paper_id),
                        "type": "paper",
                    },
                    user_id=str(current_user.id),
                    db=db,
                )

            except Exception as e:

                # Track error event
                track_event(
                    "chat_message_error",
                    properties={
                        "error": str(e),
                        "paper_id": str(request.paper_id),
                        "conversation_id": str(request.conversation_id),
                    },
                    user_id=str(current_user.id),
                    db=db,
                )

                logger.error(f"Error in streaming response: {e}", exc_info=True)
                yield f"{json.dumps({'type': 'error', 'content': str(e)})}{END_DELIMITER}"

        return StreamingResponse(response_generator(), media_type="text/event-stream")

    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error processing chat message: {e}")
        raise HTTPException(status_code=400, detail=str(e))
