from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status

from app.db.deps import SessionDependency
from app.domains.evaluations.schemas import EvaluationCaseCreate, EvaluationCaseRead, EvaluationFailedSampleRead, EvaluationRunCreate, EvaluationRunDetailRead, EvaluationRunRead
from app.domains.evaluations.service import EvaluationError, EvaluationRunNotFoundError, create_evaluation_case, create_evaluation_run, get_evaluation_run_detail, list_evaluation_runs, list_failed_samples

router = APIRouter(prefix="/api/evaluations", tags=["评测系统"])


@router.post("/cases", response_model=EvaluationCaseRead, status_code=status.HTTP_201_CREATED)
def create_evaluation_case_endpoint(payload: EvaluationCaseCreate, session: SessionDependency) -> EvaluationCaseRead:
    try:
        return create_evaluation_case(session, payload)
    except EvaluationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/runs", response_model=EvaluationRunRead, status_code=status.HTTP_201_CREATED)
def create_evaluation_run_endpoint(payload: EvaluationRunCreate, session: SessionDependency) -> EvaluationRunRead:
    try:
        return create_evaluation_run(session, payload)
    except EvaluationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/runs", response_model=list[EvaluationRunRead])
def list_evaluation_runs_endpoint(
    session: SessionDependency,
    workspace_id: Annotated[int | None, Query(gt=0)] = None,
    book_id: Annotated[int | None, Query(gt=0)] = None,
) -> list[EvaluationRunRead]:
    return list(list_evaluation_runs(session, workspace_id=workspace_id, book_id=book_id))


@router.get("/runs/{run_id}", response_model=EvaluationRunDetailRead)
def get_evaluation_run_detail_endpoint(run_id: int, session: SessionDependency) -> EvaluationRunDetailRead:
    try:
        return get_evaluation_run_detail(session, run_id)
    except EvaluationRunNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/runs/{run_id}/failed-samples", response_model=list[EvaluationFailedSampleRead])
def list_failed_samples_endpoint(run_id: int, session: SessionDependency) -> list[EvaluationFailedSampleRead]:
    try:
        return list_failed_samples(session, run_id)
    except EvaluationRunNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

