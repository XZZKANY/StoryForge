from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domains.assets.models import Asset
from app.domains.books.models import Book
from app.domains.series.models import Series, SeriesBook, SeriesMemorySnapshot
from app.domains.series.schemas import SeriesBookAttach, SeriesCreate, SeriesMemorySnapshotCreate


class SeriesInputError(ValueError):
    """系列请求无法定位关联实体或违反归属约束时抛出。"""


def create_series(session: Session, payload: SeriesCreate) -> Series:
    """创建系列根实体。"""

    series = Series(title=payload.title, premise=payload.premise, status="active", payload=payload.payload)
    session.add(series)
    session.commit()
    session.refresh(series)
    return series


def attach_book_to_series(session: Session, series_id: int, payload: SeriesBookAttach) -> SeriesBook:
    """把已有作品加入系列，并记录继承策略。"""

    series = session.get(Series, series_id)
    if series is None:
        raise SeriesInputError("系列不存在，无法绑定作品。")
    if session.get(Book, payload.book_id) is None:
        raise SeriesInputError("作品不存在，无法绑定到系列。")

    existing = session.scalar(
        select(SeriesBook).where(SeriesBook.series_id == series_id, SeriesBook.book_id == payload.book_id)
    )
    if existing is not None:
        raise SeriesInputError("作品已绑定到该系列。")

    series_book = SeriesBook(
        series_id=series_id,
        book_id=payload.book_id,
        ordinal=payload.ordinal,
        inheritance_policy=payload.inheritance_policy,
        payload=payload.payload,
    )
    session.add(series_book)
    session.commit()
    session.refresh(series_book)
    return series_book


def create_series_memory_snapshot(
    session: Session,
    series_id: int,
    payload: SeriesMemorySnapshotCreate,
) -> SeriesMemorySnapshot:
    """创建系列级记忆快照，并校验路由系列和请求系列一致。"""

    if series_id != payload.series_id:
        raise SeriesInputError("路由系列与请求系列不一致。")
    if session.get(Series, series_id) is None:
        raise SeriesInputError("系列不存在，无法创建记忆快照。")
    if payload.book_id is not None and session.get(Book, payload.book_id) is None:
        raise SeriesInputError("作品不存在，无法创建记忆快照。")

    snapshot = SeriesMemorySnapshot(
        series_id=series_id,
        book_id=payload.book_id,
        source_continuity_record_id=payload.source_continuity_record_id,
        snapshot_type=payload.snapshot_type,
        subject=payload.subject,
        status="active",
        payload=payload.payload,
        version=1,
    )
    session.add(snapshot)
    session.commit()
    session.refresh(snapshot)
    return snapshot


def get_series_memory_summary(session: Session, series_id: int) -> dict:
    """聚合系列作品、最新记忆快照和绑定作品下的世界观资产。"""

    series = session.get(Series, series_id)
    if series is None:
        raise SeriesInputError("系列不存在，无法读取记忆摘要。")

    books = session.scalars(
        select(SeriesBook).where(SeriesBook.series_id == series_id).order_by(SeriesBook.ordinal, SeriesBook.id)
    ).all()
    book_ids = [item.book_id for item in books]
    snapshots = session.scalars(
        select(SeriesMemorySnapshot)
        .where(SeriesMemorySnapshot.series_id == series_id)
        .order_by(SeriesMemorySnapshot.id.desc())
    ).all()
    worldbuilding_entries = _latest_worldbuilding_assets(session, book_ids)

    return {
        "series": series,
        "books": books,
        "latest_memory_snapshots": snapshots,
        "worldbuilding_entries": worldbuilding_entries,
    }


def count_series_memory_snapshots(series: Series) -> int:
    """读取已加载关系数量，避免响应层接触 ORM 细节。"""

    return len(series.memory_snapshots or [])


def _latest_worldbuilding_assets(session: Session, book_ids: list[int]) -> list[Asset]:
    if not book_ids:
        return []
    assets = session.scalars(
        select(Asset)
        .where(Asset.book_id.in_(book_ids), Asset.asset_type.like("worldbuilding:%"))
        .order_by(Asset.lineage_key, Asset.version.desc(), Asset.id.desc())
    ).all()
    latest_by_lineage: dict[str, Asset] = {}
    for asset in assets:
        latest_by_lineage.setdefault(asset.lineage_key, asset)
    return list(latest_by_lineage.values())
