"""
FastAPI application for the Celery PDF processing service.
Provides endpoints for submitting tasks and checking status.
"""
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Dict, Any, Optional
import logging

from src.celery_app import celery_app

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="PDF Processing Service",
    description="Celery-based service for processing PDF files",
    version="1.0.0"
)


class TaskSubmission(BaseModel):
    pdf_base64: str
    webhook_url: str
    processing_options: Optional[Dict[str, Any]] = {}


class TaskResponse(BaseModel):
    task_id: str
    status: str
    message: str


class TaskStatus(BaseModel):
    task_id: str
    status: str
    result: Optional[Dict[str, Any]] = None
    meta: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    progress: Optional[int] = None  # Progress percentage (0-100)
    progress_message: Optional[str] = None  # Human-readable progress message


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "service": "pdf-processing"}

@app.get("/task/{task_id}/status", response_model=TaskStatus)
async def get_task_status(task_id: str):
    """
    Get the status of a processing task by ID.
    """
    try:
        # Get task result from Celery
        task_result = celery_app.AsyncResult(task_id) # type: ignore

        if task_result.state == "PENDING":
            # Task is waiting or doesn't exist
            status_response = TaskStatus(
                task_id=task_id,
                status="pending",
                meta={"message": "Task is pending or does not exist"}
            )
        elif task_result.state == "PROGRESS":
            # Task is in progress - extract progress details
            progress_info = task_result.info or {}
            status_response = TaskStatus(
                task_id=task_id,
                status="progress",
                meta=progress_info,
                progress=progress_info.get("progress", 0),
                progress_message=progress_info.get("status", "Processing...")
            )
        elif task_result.state == "SUCCESS":
            # Task completed successfully
            status_response = TaskStatus(
                task_id=task_id,
                status="success",
                result=task_result.result,
                meta={"completed_at": str(task_result.date_done)}
            )
        elif task_result.state == "FAILURE":
            # Task failed
            status_response = TaskStatus(
                task_id=task_id,
                status="failure",
                error=str(task_result.info),
                meta={"failed_at": str(task_result.date_done)}
            )
        else:
            # Unknown state
            status_response = TaskStatus(
                task_id=task_id,
                status=task_result.state.lower(),
                meta={"info": str(task_result.info)}
            )

        return status_response

    except Exception as e:
        logger.error(f"Failed to get task status for {task_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get task status: {str(e)}")


@app.delete("/task/{task_id}")
async def cancel_task(task_id: str):
    """
    Cancel a pending or running task.
    """
    try:
        celery_app.control.revoke(task_id, terminate=True) # type: ignore
        logger.info(f"Cancelled task {task_id}")
        return {"message": f"Task {task_id} has been cancelled"}

    except Exception as e:
        logger.error(f"Failed to cancel task {task_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to cancel task: {str(e)}")


@app.get("/worker/status")
async def get_worker_status():
    """
    Get status of Celery workers.
    """
    try:
        # Inspect active tasks and worker status
        inspect = celery_app.control.inspect()

        active_tasks = inspect.active()
        registered_tasks = inspect.registered()
        worker_stats = inspect.stats()

        return {
            "active_tasks": active_tasks,
            "registered_tasks": registered_tasks,
            "worker_stats": worker_stats
        }

    except Exception as e:
        logger.error(f"Failed to get worker status: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get worker status: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
