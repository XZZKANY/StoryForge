from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status

from app.common.pagination import MAX_PAGE_LIMIT, paginate_by_id
from app.db.deps import SessionDependency
from app.domains.evaluations.models import EvaluationRun
from app.domains.evaluations.schemas import (
    EvaluationCaseCreate,
    EvaluationCaseRead,
    EvaluationFailedSampleRead,
    EvaluationRunCreate,
    EvaluationRunDetailRead,
    EvaluationRunListPage,
    EvaluationRunRead,
)
from app.domains.evaluations.service import (
    EvaluationError,
    EvaluationRunNotFoundError,
    build_evaluation_run_list_query,
    create_evaluation_case,
    create_evaluation_run,
    get_evaluation_run_detail,
    list_evaluation_runs,
    list_failed_samples,
)

router = APIRouter(prefix="/api/evaluations", tags=["评测系统"])


@router.post(
    "/cases",
    response_model=EvaluationCaseRead,
    status_code=status.HTTP_201_CREATED,
    summary="创建评测样例",
)
def create_evaluation_case_endpoint(payload: EvaluationCaseCreate, session: SessionDependency) -> EvaluationCaseRead:
    """登记一条评测样例（输入 / 预期输出），供评测运行批量执行。"""

    try:
        return create_evaluation_case(session, payload)
    except EvaluationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post(
    "/runs",
    response_model=EvaluationRunRead,
    status_code=status.HTTP_201_CREATED,
    summary="启动评测运行",
)
def create_evaluation_run_endpoint(payload: EvaluationRunCreate, session: SessionDependency) -> EvaluationRunRead:
    """对一批评测样例发起新的评测运行，返回评测运行入口。"""

    try:
        return create_evaluation_run(session, payload)
    except EvaluationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get(
    "/runs",
    response_model=list[EvaluationRunRead] | EvaluationRunListPage,
    summary="读取评测运行列表",
)
def list_evaluation_runs_endpoint(
    session: SessionDependency,
    workspace_id: Annotated[int | None, Query(gt=0)] = None,
    book_id: Annotated[int | None, Query(gt=0)] = None,
    cursor: Annotated[str | None, Query(max_length=64)] = None,
    limit: Annotated[int | None, Query(ge=1, le=MAX_PAGE_LIMIT)] = None,
) -> list[EvaluationRunRead] | EvaluationRunListPage:
    """评测运行列表：未指定 limit 时返回兼容数组；指定 limit 时返回游标分页信封。"""

    if limit is None and cursor is None:
        return list(list_evaluation_runs(session, workspace_id=workspace_id, book_id=book_id))
    query = build_evaluation_run_list_query(workspace_id=workspace_id, book_id=book_id)
    page = paginate_by_id(session, query, id_column=EvaluationRun.id, cursor=cursor, limit=limit)
    return EvaluationRunListPage(
        items=[EvaluationRunRead.model_validate(item) for item in page.items],
        next_cursor=page.next_cursor,
        has_more=page.has_more,
    )


@router.get(
    "/runs/{run_id}",
    response_model=EvaluationRunDetailRead,
    summary="读取评测运行详情",
)
def get_evaluation_run_detail_endpoint(run_id: int, session: SessionDependency) -> EvaluationRunDetailRead:
    """读取单次评测运行的整体指标摘要与子样本统计。"""

    try:
        return get_evaluation_run_detail(session, run_id)
    except EvaluationRunNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get(
    "/runs/{run_id}/failed-samples",
    response_model=list[EvaluationFailedSampleRead],
    summary="读取评测失败样例",
)
def list_failed_samples_endpoint(run_id: int, session: SessionDependency) -> list[EvaluationFailedSampleRead]:
    """读取指定评测运行下未达标的样例列表，便于排错和反馈。"""

    try:
        return list_failed_samples(session, run_id)
    except EvaluationRunNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
