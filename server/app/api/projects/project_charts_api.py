"""Project chart composer endpoints."""

import uuid

from app.auth.dependencies import get_required_user
from app.database.crud.artifact_crud import artifact_crud
from app.database.crud.message_crud import MessageCreate, message_crud
from app.database.crud.projects.project_conversation_crud import (
    ProjectConversationCreate,
    project_conversation_crud,
)
from app.database.crud.projects.project_paper_crud import project_paper_crud
from app.database.database import get_db
from app.database.models import ArtifactKind
from app.llm.operations import operations
from app.schemas.chart import ChartPlan
from app.schemas.user import CurrentUser
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

project_charts_router = APIRouter()


class ProposeChartRequest(BaseModel):
    project_id: str
    prompt: str
    paper_ids: list[str] = Field(default_factory=list)


class CreateChartRequest(ProposeChartRequest):
    plan: ChartPlan


def _papers_for_request(
    db: Session, user: CurrentUser, project_id: str, paper_ids: list[str]
):
    papers = project_paper_crud.get_all_papers_by_project_id(
        db, project_id=uuid.UUID(project_id), user=user
    )
    if paper_ids:
        allowed = set(paper_ids)
        papers = [paper for paper in papers if str(paper.id) in allowed]
    return papers


@project_charts_router.post("/propose")
def propose_chart(
    request: ProposeChartRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    prompt = request.prompt.strip()
    if not prompt:
        return JSONResponse(
            status_code=400, content={"message": "Prompt must not be empty"}
        )
    papers = _papers_for_request(
        db, current_user, request.project_id, request.paper_ids
    )
    if not papers:
        return JSONResponse(
            status_code=400, content={"message": "Select at least one project paper"}
        )
    investigation = operations.investigate_chart_fields(
        prompt=prompt,
        papers=[(str(paper.id), str(paper.title or "Untitled")) for paper in papers],
        current_user=current_user,
        db=db,
        project_id=request.project_id,
    )
    plan = operations.propose_chart_plan(
        prompt,
        [(str(paper.id), str(paper.title or "Untitled")) for paper in papers],
        investigation.findings,
    )
    if not plan:
        return JSONResponse(
            status_code=500, content={"message": "Failed to propose a chart plan"}
        )
    return JSONResponse(content={"plan": plan.model_dump()})


@project_charts_router.post("")
def create_chart(
    request: CreateChartRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    prompt = request.prompt.strip()
    papers = _papers_for_request(
        db, current_user, request.project_id, request.paper_ids
    )
    if not prompt or not papers:
        return JSONResponse(
            status_code=400,
            content={
                "message": "A request and at least one project paper are required"
            },
        )
    investigation = operations.investigate_chart_fields(
        prompt=prompt,
        papers=[(str(paper.id), str(paper.title or "Untitled")) for paper in papers],
        current_user=current_user,
        db=db,
        project_id=request.project_id,
        plan=request.plan,
    )
    artifact = operations.build_chart_artifact(
        prompt=prompt,
        plan=request.plan,
        evidence=investigation.evidence,
        papers=[(str(paper.id), str(paper.title or "Untitled")) for paper in papers],
    )
    if not artifact:
        return JSONResponse(
            status_code=422,
            content={"message": "No cited chart could be built from this scope."},
        )
    if not operations.is_chart_ready(artifact):
        return JSONResponse(
            status_code=422,
            content={"message": operations.chart_failure_message(artifact)},
        )

    conversation = project_conversation_crud.create(
        db,
        obj_in=ProjectConversationCreate(title=artifact.plan.title),
        user=current_user,
        project_id=uuid.UUID(request.project_id),
    )
    if not conversation:
        return JSONResponse(
            status_code=403,
            content={"message": "You do not have permission to create artifacts"},
        )
    message_crud.create(
        db,
        obj_in=MessageCreate(
            conversation_id=conversation.id, role="user", content=prompt
        ),
        user=current_user,
    )
    message = message_crud.create(
        db,
        obj_in=MessageCreate(
            conversation_id=conversation.id,
            role="assistant",
            content=f"Created chart: {artifact.plan.title}",
        ),
        user=current_user,
    )
    created = artifact_crud.create_for_message(
        db,
        message=message,
        conversation=conversation,
        kind=ArtifactKind.CHART,
        payload=artifact.model_dump(),
        user=current_user,
    )
    if not created:
        return JSONResponse(
            status_code=500, content={"message": "Failed to save chart artifact"}
        )
    return JSONResponse(
        status_code=201,
        content={
            "id": str(created.id),
            "artifact": artifact.model_dump(),
            "conversation_id": str(conversation.id),
        },
    )
