from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, HTTPException, status

from app.common.metrics import batch_refinery_jobs_total
from app.db.deps import SessionDependency
from app.domains.batch_refinery.schemas import BatchRefineryRunCreate, BatchRefineryRunRead
from app.domains.batch_refinery.service import (
    BatchRefineryInputError,
    create_batch_refinery_job,
    get_batch_refinery_run,
    run_batch_refinery_in_background,
)

router = APIRouter(prefix="/api/batch-refinery", tags=["批量精修"])


@router.post("/runs", response_model=BatchRefineryRunRead, status_code=status.HTTP_202_ACCEPTED)
def create_batch_refinery_run(
    payload: BatchRefineryRunCreate,
    session: SessionDependency,
    background_tasks: BackgroundTasks,
) -> BatchRefineryRunRead:
    """创建排队任务并交给后台执行，客户端通过查询接口读取进度。"""

    try:
        job = create_batch_refinery_job(session, payload)
    except BatchRefineryInputError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    batch_refinery_jobs_total.inc()
    background_tasks.add_task(run_batch_refinery_in_background, payload, job.id)
    return BatchRefineryRunRead.model_validate(job)


@router.get("/runs/{job_id}", response_model=BatchRefineryRunRead)
def read_batch_refinery_run(job_id: int, session: SessionDependency) -> BatchRefineryRunRead:
    """读取批量精修 JobRun 明细，供恢复和重试前检查。"""

    try:
        job = get_batch_refinery_run(session, job_id)
    except BatchRefineryInputError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return BatchRefineryRunRead.model_validate(job)
