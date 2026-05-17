from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.domains.evaluations.schemas import EvaluationCaseCreate, EvaluationCaseRead, EvaluationRunCreate, EvaluationRunRead
from app.domains.evaluations.service import EvaluationError, create_evaluation_case, create_evaluation_run, list_evaluation_runs

router = APIRouter(prefix="/api/evaluations", tags=["评测系统"])
SessionDependency = Annotated[Session, Depends(get_session)]


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

