"""Project chart composer endpoints."""

import uuid

from app.auth.dependencies import get_required_user
from app.database.crud.projects.project_chart_crud import chart_job_crud
from app.database.crud.projects.project_paper_crud import project_paper_crud
from app.database.database import get_db
from app.llm.operations import operations
from app.schemas.chart import ChartPlan
from app.schemas.user import CurrentUser
from app.tasks.chart_generation import generate_chart
from fastapi import APIRouter, BackgroundTasks, Depends
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
    background_tasks: BackgroundTasks,
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
    project_id = uuid.UUID(request.project_id)
    job = chart_job_crud.create(
        db,
        project_id=project_id,
        prompt=prompt,
        paper_ids=request.paper_ids,
        plan=request.plan.model_dump(),
        user=current_user,
    )
    if not job:
        return JSONResponse(
            status_code=403,
            content={"message": "You do not have permission to create artifacts"},
        )
    background_tasks.add_task(
        generate_chart,
        job_id=job.id,
        project_id=project_id,
        user=current_user,
    )
    return JSONResponse(
        status_code=202,
        content={
            "id": str(job.id),
            "status": job.status,
            "message": "Chart generation started",
        },
    )


@project_charts_router.get("/jobs/{project_id}")
def list_chart_jobs(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_required_user),
):
    jobs = chart_job_crud.get_by_project(
        db, project_id=uuid.UUID(project_id), user=current_user
    )
    return JSONResponse(content={"jobs": [chart_job_crud.to_dict(job) for job in jobs]})
