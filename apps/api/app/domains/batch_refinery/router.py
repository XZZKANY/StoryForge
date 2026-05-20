from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from app.db.deps import SessionDependency
from app.domains.batch_refinery.schemas import BatchRefineryRunCreate, BatchRefineryRunRead
from app.domains.batch_refinery.service import BatchRefineryInputError, get_batch_refinery_run, run_batch_refinery

router = APIRouter(prefix="/api/batch-refinery", tags=["批量精修"])


@router.post("/runs", response_model=BatchRefineryRunRead, status_code=status.HTTP_201_CREATED)
def create_batch_refinery_run(payload: BatchRefineryRunCreate, session: SessionDependency) -> BatchRefineryRunRead:
    """同步执行批量精修，并返回 JobRun 进度明细。"""

    try:
        job = run_batch_refinery(session, payload)
    except BatchRefineryInputError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return BatchRefineryRunRead.model_validate(job)


@router.get("/runs/{job_id}", response_model=BatchRefineryRunRead)
def read_batch_refinery_run(job_id: int, session: SessionDependency) -> BatchRefineryRunRead:
    """读取批量精修 JobRun 明细，供恢复和重试前检查。"""

    try:
        job = get_batch_refinery_run(session, job_id)
    except BatchRefineryInputError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return BatchRefineryRunRead.model_validate(job)
