from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.domains.model_runs.schemas import ModelRunCreate, ModelRunRead
from app.domains.model_runs.service import ModelRunError, create_model_run, list_model_runs

router = APIRouter(prefix="/api/model-runs", tags=["模型运行日志"])
SessionDependency = Annotated[Session, Depends(get_session)]


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

