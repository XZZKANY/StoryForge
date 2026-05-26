from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status

from app.db.deps import SessionDependency
from app.domains.retrieval.embedding_client import resolve_embedding_client
from app.domains.retrieval.reranker_client import resolve_reranker_client
from app.domains.retrieval.schemas import (
    RetrievalHitRead,
    RetrievalRefreshRunCreate,
    RetrievalRefreshRunRead,
    RetrievalSearchCreate,
    RetrievalSourceCreate,
    RetrievalSourceRead,
    RetrievalWorkbenchRefreshRunRead,
    RetrievalWorkbenchSearchRead,
    RetrievalWorkbenchSourceRead,
)
from app.domains.retrieval.service import (
    RetrievalInputError,
    create_retrieval_refresh_run,
    create_retrieval_source,
    list_retrieval_sources,
    list_retrieval_workbench_refresh_runs,
    list_retrieval_workbench_sources,
    search_retrieval,
    search_retrieval_workbench,
)

router = APIRouter(prefix="/api/retrieval", tags=["检索中心"])


@router.get(
    "/workbench/sources",
    response_model=list[RetrievalWorkbenchSourceRead],
    summary="读取检索工作台资料源",
)
def list_retrieval_workbench_sources_endpoint(
    session: SessionDependency,
    book_id: Annotated[int | None, Query(gt=0)] = None,
    series_id: Annotated[int | None, Query(gt=0)] = None,
) -> list[RetrievalWorkbenchSourceRead]:
    """读取检索工作台需要的资料源摘要：状态、规模、最近一次刷新时间。"""

    return list_retrieval_workbench_sources(session, book_id=book_id, series_id=series_id)


@router.get(
    "/workbench/refresh-runs",
    response_model=list[RetrievalWorkbenchRefreshRunRead],
    summary="读取检索刷新任务列表",
)
def list_retrieval_workbench_refresh_runs_endpoint(
    session: SessionDependency,
    source_id: Annotated[int | None, Query(gt=0)] = None,
    book_id: Annotated[int | None, Query(gt=0)] = None,
    series_id: Annotated[int | None, Query(gt=0)] = None,
) -> list[RetrievalWorkbenchRefreshRunRead]:
    """按资料源或作品维度列出索引刷新任务的最近运行记录。"""

    return list_retrieval_workbench_refresh_runs(
        session,
        source_id=source_id,
        book_id=book_id,
        series_id=series_id,
    )


@router.post(
    "/workbench/search",
    response_model=RetrievalWorkbenchSearchRead,
    summary="检索工作台搜索",
)
def search_retrieval_workbench_endpoint(
    payload: RetrievalSearchCreate,
    session: SessionDependency,
) -> RetrievalWorkbenchSearchRead:
    """检索工作台搜索：返回命中、证据锚点和检索摘要，便于核对 Scene Packet 的来源。"""

    try:
        return search_retrieval_workbench(
            session,
            payload,
            embedding_client=resolve_embedding_client(),
            reranker_client=resolve_reranker_client(),
        )
    except RetrievalInputError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post(
    "/sources",
    response_model=RetrievalSourceRead,
    status_code=status.HTTP_201_CREATED,
    summary="创建检索资料源",
)
def create_retrieval_source_endpoint(payload: RetrievalSourceCreate, session: SessionDependency) -> RetrievalSourceRead:
    """登记一条检索资料源（URL 或文档），可后续触发索引刷新任务。"""

    try:
        return create_retrieval_source(
            session,
            payload,
            embedding_client=resolve_embedding_client(),
        )
    except RetrievalInputError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get(
    "/sources",
    response_model=list[RetrievalSourceRead],
    summary="读取检索资料源列表",
)
def list_retrieval_sources_endpoint(
    session: SessionDependency,
    book_id: Annotated[int | None, Query(gt=0)] = None,
    series_id: Annotated[int | None, Query(gt=0)] = None,
) -> list[RetrievalSourceRead]:
    """按作品或系列范围列出已登记的检索资料源。"""

    return list(list_retrieval_sources(session, book_id=book_id, series_id=series_id))


@router.post(
    "/refresh-runs",
    response_model=RetrievalRefreshRunRead,
    status_code=status.HTTP_201_CREATED,
    summary="创建检索索引刷新任务",
)
def create_retrieval_refresh_run_endpoint(
    payload: RetrievalRefreshRunCreate,
    session: SessionDependency,
) -> RetrievalRefreshRunRead:
    """对指定资料源发起索引刷新任务，返回刷新运行记录。"""

    try:
        return create_retrieval_refresh_run(
            session,
            payload,
            embedding_client=resolve_embedding_client(),
        )
    except RetrievalInputError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post(
    "/search",
    response_model=list[RetrievalHitRead],
    summary="基础检索",
)
def search_retrieval_endpoint(payload: RetrievalSearchCreate, session: SessionDependency) -> list[RetrievalHitRead]:
    """基础检索接口：仅返回命中列表，不附加工作台需要的摘要字段。"""

    try:
        return search_retrieval(
            session,
            payload,
            embedding_client=resolve_embedding_client(),
            reranker_client=resolve_reranker_client(),
        )
    except RetrievalInputError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
