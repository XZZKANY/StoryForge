from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status

from app.db.deps import SessionDependency
from app.domains.model_runs.schemas import ModelRunCreate, ModelRunRead, RunsJobRunRead, RunsJobRunRetryRead
from app.domains.model_runs.service import (
    ModelRunError,
    create_model_run,
    get_runs_job_run,
    list_model_runs,
    retry_runs_job_run,
)

router = APIRouter(prefix="/api/model-runs", tags=["模型运行日志"])


@router.post("", response_model=ModelRunRead, status_code=status.HTTP_201_CREATED)
def create_model_run_endpoint(payload: ModelRunCreate, session: SessionDependency) -> ModelRunRead:
    try:
        return create_model_run(session, payload)
    except ModelRunError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("", response_model=list[ModelRunRead])
def list_model_runs_endpoint(
    session: SessionDependency,
    workspace_id: Annotated[int | None, Query(gt=0)] = None,
    book_id: Annotated[int | None, Query(gt=0)] = None,
    job_run_id: Annotated[int | None, Query(gt=0)] = None,
) -> list[ModelRunRead]:
    return list(list_model_runs(session, workspace_id=workspace_id, book_id=book_id, job_run_id=job_run_id))


@router.get("/job-runs/{job_run_id}", response_model=RunsJobRunRead)
def get_runs_job_run_endpoint(job_run_id: int, session: SessionDependency) -> RunsJobRunRead:
    try:
        return get_runs_job_run(session, job_run_id=job_run_id)
    except ModelRunError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post("/job-runs/{job_run_id}/retry", response_model=RunsJobRunRetryRead)
def retry_runs_job_run_endpoint(job_run_id: int, session: SessionDependency) -> RunsJobRunRetryRead:
    try:
        return retry_runs_job_run(session, job_run_id=job_run_id)
    except ModelRunError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

