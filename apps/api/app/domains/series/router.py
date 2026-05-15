from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.domains.series.schemas import SeriesCreate, SeriesMemoryCreate, SeriesMemoryRead, SeriesMemoryUpdate, SeriesRead
from app.domains.series.service import (
    EmptySeriesMemoryUpdateError,
    SeriesMemoryNotFoundError,
    SeriesNotFoundError,
    create_series,
    create_series_memory,
    get_series_memory_history,
    list_series_memories,
    update_series_memory,
)

router = APIRouter(prefix="/api/series", tags=["系列级记忆"])
SessionDependency = Annotated[Session, Depends(get_session)]


@router.post("", response_model=SeriesRead, status_code=status.HTTP_201_CREATED)
def create_series_endpoint(payload: SeriesCreate, session: SessionDependency) -> SeriesRead:
    """创建承载跨书记忆的系列根实体。"""

    return create_series(session, payload)


@router.post("/{series_id}/memories", response_model=SeriesMemoryRead, status_code=status.HTTP_201_CREATED)
def create_series_memory_endpoint(
    series_id: int,
    payload: SeriesMemoryCreate,
    session: SessionDependency,
) -> SeriesMemoryRead:
    """创建系列级记忆首版本。"""

    try:
        return create_series_memory(session, series_id, payload)
    except SeriesNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/{series_id}/memories", response_model=list[SeriesMemoryRead])
def list_series_memories_endpoint(
    series_id: int,
    session: SessionDependency,
    memory_type: Annotated[str | None, Query(min_length=1, max_length=80)] = None,
) -> list[SeriesMemoryRead]:
    """读取指定系列下每条记忆谱系的最新版本。"""

    try:
        return list(list_series_memories(session, series_id=series_id, memory_type=memory_type))
    except SeriesNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.patch("/memories/{memory_id}", response_model=SeriesMemoryRead)
def update_series_memory_endpoint(
    memory_id: int,
    payload: SeriesMemoryUpdate,
    session: SessionDependency,
) -> SeriesMemoryRead:
    """更新系列级记忆并创建新版本。"""

    try:
        return update_series_memory(session, memory_id, payload)
    except SeriesMemoryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except EmptySeriesMemoryUpdateError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/memories/{memory_id}/history", response_model=list[SeriesMemoryRead])
def read_series_memory_history_endpoint(memory_id: int, session: SessionDependency) -> list[SeriesMemoryRead]:
    """读取同一系列记忆谱系的全部版本历史。"""

    try:
        return list(get_series_memory_history(session, memory_id))
    except SeriesMemoryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
