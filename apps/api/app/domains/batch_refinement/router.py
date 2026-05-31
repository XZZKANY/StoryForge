from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from app.db.deps import SessionDependency
from app.domains.batch_refinement.schemas import BatchRefinementJobCreate, BatchRefinementJobRead
from app.domains.batch_refinement.service import (
    BatchRefinementInputError,
    batch_refinement_payload,
    create_batch_refinement_job,
    get_batch_refinement_job,
)

router = APIRouter(prefix="/api/batch-refinement", tags=["批量精修兼容"])


@router.post(
    "/jobs",
    response_model=BatchRefinementJobRead,
    status_code=status.HTTP_201_CREATED,
    summary="创建并同步执行批量精修任务",
)
def create_batch_refinement_run(
    payload: BatchRefinementJobCreate,
    session: SessionDependency,
) -> BatchRefinementJobRead:
    """兼容 Phase 2 早期草稿 API，内部复用现有评审与修复事实源。"""

    try:
        job = create_batch_refinement_job(
            session,
            book_id=payload.book_id,
            scene_ids=payload.scene_ids,
            required_facts=payload.required_facts,
            style_rules=payload.style_rules,
        )
    except BatchRefinementInputError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return BatchRefinementJobRead.model_validate(batch_refinement_payload(job))


@router.get(
    "/jobs/{job_run_id}",
    response_model=BatchRefinementJobRead,
    summary="读取批量精修任务",
)
def read_batch_refinement_run(job_run_id: int, session: SessionDependency) -> BatchRefinementJobRead:
    """读取兼容 API 创建的批量精修任务。"""

    try:
        job = get_batch_refinement_job(session, job_run_id)
    except BatchRefinementInputError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return BatchRefinementJobRead.model_validate(batch_refinement_payload(job))
