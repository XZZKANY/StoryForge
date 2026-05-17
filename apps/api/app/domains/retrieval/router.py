from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.domains.retrieval.schemas import (
    RetrievalHitRead,
    RetrievalRefreshRunCreate,
    RetrievalRefreshRunRead,
    RetrievalSearchCreate,
    RetrievalSourceCreate,
    RetrievalSourceRead,
)
from app.domains.retrieval.service import (
    RetrievalInputError,
    create_retrieval_refresh_run,
    create_retrieval_source,
    list_retrieval_sources,
    search_retrieval,
)

router = APIRouter(prefix="/api/retrieval", tags=["检索中心"])
SessionDependency = Annotated[Session, Depends(get_session)]


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

