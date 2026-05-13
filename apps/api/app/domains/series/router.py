from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.domains.series.schemas import (
    SeriesBookAttach,
    SeriesBookRead,
    SeriesCreate,
    SeriesMemorySnapshotCreate,
    SeriesMemorySnapshotRead,
    SeriesMemorySummaryRead,
    SeriesRead,
    SeriesSummaryBook,
)
from app.domains.series.service import (
    SeriesInputError,
    attach_book_to_series,
    count_series_memory_snapshots,
    create_series,
    create_series_memory_snapshot,
    get_series_memory_summary,
)

router = APIRouter(prefix="/api/series", tags=["系列记忆"])
SessionDependency = Annotated[Session, Depends(get_session)]


def _series_read(series) -> SeriesRead:
    return SeriesRead.model_validate(series).model_copy(
        update={"versioned_memory_count": count_series_memory_snapshots(series)}
    )


@router.post("", response_model=SeriesRead, status_code=status.HTTP_201_CREATED)
def create_series_endpoint(payload: SeriesCreate, session: SessionDependency) -> SeriesRead:
    """创建系列根实体。"""

    return _series_read(create_series(session, payload))


@router.post("/{series_id}/books", response_model=SeriesBookRead, status_code=status.HTTP_201_CREATED)
def attach_book_endpoint(series_id: int, payload: SeriesBookAttach, session: SessionDependency) -> SeriesBookRead:
    """把已有作品加入系列。"""

    try:
        return attach_book_to_series(session, series_id, payload)
    except SeriesInputError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post(
    "/{series_id}/memory-snapshots",
    response_model=SeriesMemorySnapshotRead,
    status_code=status.HTTP_201_CREATED,
)
def create_memory_snapshot_endpoint(
    series_id: int,
    payload: SeriesMemorySnapshotCreate,
    session: SessionDependency,
) -> SeriesMemorySnapshotRead:
    """创建系列级记忆快照。"""

    try:
        return create_series_memory_snapshot(session, series_id, payload)
    except SeriesInputError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/{series_id}/memory-summary", response_model=SeriesMemorySummaryRead)
def read_memory_summary_endpoint(series_id: int, session: SessionDependency) -> SeriesMemorySummaryRead:
    """读取系列记忆摘要。"""

    try:
        summary = get_series_memory_summary(session, series_id)
    except SeriesInputError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    return SeriesMemorySummaryRead(
        series=_series_read(summary["series"]),
        books=[
            SeriesSummaryBook(
                book_id=item.book_id,
                ordinal=item.ordinal,
                inheritance_policy=item.inheritance_policy,
            )
            for item in summary["books"]
        ],
        latest_memory_snapshots=summary["latest_memory_snapshots"],
        worldbuilding_entries=[
            {
                "id": asset.id,
                "book_id": asset.book_id,
                "asset_type": asset.asset_type,
                "lineage_key": asset.lineage_key,
                "name": asset.name,
                "status": asset.status,
                "payload": asset.payload,
                "version": asset.version,
            }
            for asset in summary["worldbuilding_entries"]
        ],
    )
