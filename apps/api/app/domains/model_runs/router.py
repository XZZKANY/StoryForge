from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status

from app.common.pagination import MAX_PAGE_LIMIT, paginate_by_id
from app.db.deps import SessionDependency
from app.domains.model_runs.models import ModelRun
from app.domains.model_runs.schemas import (
    ModelRunCreate,
    ModelRunListPage,
    ModelRunRead,
    RunsJobRunRead,
    RunsJobRunRetryRead,
)
from app.domains.model_runs.service import (
    ModelRunError,
    build_model_run_list_query,
    create_model_run,
    get_runs_job_run,
    list_model_runs,
    retry_runs_job_run,
)

router = APIRouter(prefix="/api/model-runs", tags=["模型运行日志"])


@router.post(
    "",
    response_model=ModelRunRead,
    status_code=status.HTTP_201_CREATED,
    summary="记录模型调用",
)
def create_model_run_endpoint(payload: ModelRunCreate, session: SessionDependency) -> ModelRunRead:
    """登记一次模型调用的输入、输出、token 用量和成本估计。"""

    try:
        return create_model_run(session, payload)
    except ModelRunError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get(
    "",
    response_model=list[ModelRunRead] | ModelRunListPage,
    summary="读取模型运行列表",
)
def list_model_runs_endpoint(
    session: SessionDependency,
    workspace_id: Annotated[int | None, Query(gt=0)] = None,
    book_id: Annotated[int | None, Query(gt=0)] = None,
    job_run_id: Annotated[int | None, Query(gt=0)] = None,
    cursor: Annotated[str | None, Query(max_length=64)] = None,
    limit: Annotated[int | None, Query(ge=1, le=MAX_PAGE_LIMIT)] = None,
) -> list[ModelRunRead] | ModelRunListPage:
    """模型运行列表：未指定 limit 时返回兼容数组；指定 limit 时返回游标分页信封。"""

    if limit is None and cursor is None:
        return list(
            list_model_runs(session, workspace_id=workspace_id, book_id=book_id, job_run_id=job_run_id)
        )
    query = build_model_run_list_query(
        workspace_id=workspace_id, book_id=book_id, job_run_id=job_run_id
    )
    page = paginate_by_id(session, query, id_column=ModelRun.id, cursor=cursor, limit=limit)
    return ModelRunListPage(
        items=[ModelRunRead.model_validate(item) for item in page.items],
        next_cursor=page.next_cursor,
        has_more=page.has_more,
    )


@router.get(
    "/job-runs/{job_run_id}",
    response_model=RunsJobRunRead,
    summary="读取 JobRun 详情",
)
def get_runs_job_run_endpoint(job_run_id: int, session: SessionDependency) -> RunsJobRunRead:
    """按 job_run_id 读取 JobRun、Checkpoint 和 ModelRun 摘要。"""

    try:
        return get_runs_job_run(session, job_run_id=job_run_id)
    except ModelRunError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post(
    "/job-runs/{job_run_id}/retry",
    response_model=RunsJobRunRetryRead,
    summary="创建 JobRun 恢复任务",
)
def retry_runs_job_run_endpoint(job_run_id: int, session: SessionDependency) -> RunsJobRunRetryRead:
    """对失败的 JobRun 创建恢复任务（仅登记，不立即续跑 workflow）。"""

    try:
        return retry_runs_job_run(session, job_run_id=job_run_id)
    except ModelRunError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
