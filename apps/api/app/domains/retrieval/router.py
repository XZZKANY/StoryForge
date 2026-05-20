from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status

from app.db.deps import SessionDependency
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


@router.get("/workbench/sources", response_model=list[RetrievalWorkbenchSourceRead])
def list_retrieval_workbench_sources_endpoint(
    session: SessionDependency,
    book_id: Annotated[int | None, Query(gt=0)] = None,
    series_id: Annotated[int | None, Query(gt=0)] = None,
) -> list[RetrievalWorkbenchSourceRead]:
    return list_retrieval_workbench_sources(session, book_id=book_id, series_id=series_id)


@router.get("/workbench/refresh-runs", response_model=list[RetrievalWorkbenchRefreshRunRead])
def list_retrieval_workbench_refresh_runs_endpoint(
    session: SessionDependency,
    source_id: Annotated[int | None, Query(gt=0)] = None,
    book_id: Annotated[int | None, Query(gt=0)] = None,
    series_id: Annotated[int | None, Query(gt=0)] = None,
) -> list[RetrievalWorkbenchRefreshRunRead]:
    return list_retrieval_workbench_refresh_runs(
        session,
        source_id=source_id,
        book_id=book_id,
        series_id=series_id,
    )


@router.post("/workbench/search", response_model=RetrievalWorkbenchSearchRead)
def search_retrieval_workbench_endpoint(
    payload: RetrievalSearchCreate,
    session: SessionDependency,
) -> RetrievalWorkbenchSearchRead:
    try:
        return search_retrieval_workbench(session, payload)
    except RetrievalInputError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/sources", response_model=RetrievalSourceRead, status_code=status.HTTP_201_CREATED)
def create_retrieval_source_endpoint(payload: RetrievalSourceCreate, session: SessionDependency) -> RetrievalSourceRead:
    try:
        return create_retrieval_source(session, payload)
    except RetrievalInputError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/sources", response_model=list[RetrievalSourceRead])
def list_retrieval_sources_endpoint(
    session: SessionDependency,
    book_id: Annotated[int | None, Query(gt=0)] = None,
    series_id: Annotated[int | None, Query(gt=0)] = None,
) -> list[RetrievalSourceRead]:
    return list(list_retrieval_sources(session, book_id=book_id, series_id=series_id))


@router.post("/refresh-runs", response_model=RetrievalRefreshRunRead, status_code=status.HTTP_201_CREATED)
def create_retrieval_refresh_run_endpoint(
    payload: RetrievalRefreshRunCreate,
    session: SessionDependency,
) -> RetrievalRefreshRunRead:
    try:
        return create_retrieval_refresh_run(session, payload)
    except RetrievalInputError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/search", response_model=list[RetrievalHitRead])
def search_retrieval_endpoint(payload: RetrievalSearchCreate, session: SessionDependency) -> list[RetrievalHitRead]:
    try:
        return search_retrieval(session, payload)
    except RetrievalInputError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

