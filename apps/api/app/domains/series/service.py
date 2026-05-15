from __future__ import annotations

from collections.abc import Sequence
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.domains.series.models import Series, SeriesMemory, SeriesMemoryEvidence
from app.domains.series.schemas import SeriesCreate, SeriesMemoryCreate, SeriesMemoryUpdate


class SeriesNotFoundError(ValueError):
    """系列不存在时抛出，避免产生孤立的跨书记忆。"""


class SeriesMemoryNotFoundError(ValueError):
    """系列记忆不存在时抛出，路由层转换为 HTTP 响应。"""


class EmptySeriesMemoryUpdateError(ValueError):
    """空更新无法形成有意义的新版本。"""


def create_series(session: Session, payload: SeriesCreate) -> Series:
    """创建系列根实体。"""

    series = Series(title=payload.title, status=payload.status, description=payload.description)
    session.add(series)
    session.commit()
    session.refresh(series)
    return series


def create_series_memory(session: Session, series_id: int, payload: SeriesMemoryCreate) -> SeriesMemory:
    """创建系列级记忆首版本，并保存来源证据。"""

    if session.get(Series, series_id) is None:
        raise SeriesNotFoundError("系列不存在，无法创建系列级记忆。")
    memory = SeriesMemory(
        series_id=series_id,
        memory_type=payload.memory_type,
        lineage_key=str(uuid4()),
        subject=payload.subject,
        status=payload.status,
        payload=payload.payload,
        version=1,
    )
    memory.evidence = [
        SeriesMemoryEvidence(
            evidence_type=item.evidence_type,
            source_ref=item.source_ref,
            rationale=item.rationale,
        )
        for item in payload.evidence
    ]
    session.add(memory)
    session.commit()
    return _load_memory(session, memory.id)


def list_series_memories(
    session: Session,
    series_id: int,
    memory_type: str | None = None,
) -> Sequence[SeriesMemory]:
    """列出指定系列下每条记忆谱系的最新版本。"""

    if session.get(Series, series_id) is None:
        raise SeriesNotFoundError("系列不存在，无法读取系列级记忆。")
    latest_versions = (
        select(SeriesMemory.lineage_key, func.max(SeriesMemory.version).label("latest_version"))
        .where(SeriesMemory.series_id == series_id)
        .group_by(SeriesMemory.lineage_key)
        .subquery()
    )
    statement = (
        select(SeriesMemory)
        .options(selectinload(SeriesMemory.evidence))
        .join(
            latest_versions,
            (SeriesMemory.lineage_key == latest_versions.c.lineage_key)
            & (SeriesMemory.version == latest_versions.c.latest_version),
        )
        .where(SeriesMemory.series_id == series_id)
        .order_by(SeriesMemory.id)
    )
    if memory_type is not None:
        statement = statement.where(SeriesMemory.memory_type == memory_type)
    return session.scalars(statement).all()


def update_series_memory(session: Session, memory_id: int, payload: SeriesMemoryUpdate) -> SeriesMemory:
    """复制上一版本并插入新版本，保持系列记忆历史不可覆盖。"""

    source = session.get(SeriesMemory, memory_id)
    if source is None:
        raise SeriesMemoryNotFoundError("系列记忆不存在，无法更新版本。")
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        raise EmptySeriesMemoryUpdateError("系列记忆更新内容不能为空。")
    latest = session.scalars(
        select(SeriesMemory)
        .where(SeriesMemory.lineage_key == source.lineage_key)
        .order_by(SeriesMemory.version.desc(), SeriesMemory.id.desc())
        .limit(1)
    ).one()
    new_memory = SeriesMemory(
        series_id=latest.series_id,
        memory_type=changes.get("memory_type", latest.memory_type),
        lineage_key=latest.lineage_key,
        subject=changes.get("subject", latest.subject),
        status=changes.get("status", latest.status),
        payload=changes.get("payload", latest.payload),
        version=latest.version + 1,
    )
    evidence_payload = changes.get("evidence")
    if evidence_payload is None:
        source_with_evidence = _load_memory(session, latest.id)
        new_memory.evidence = [
            SeriesMemoryEvidence(
                evidence_type=item.evidence_type,
                source_ref=item.source_ref,
                rationale=item.rationale,
            )
            for item in source_with_evidence.evidence
        ]
    else:
        new_memory.evidence = [
            SeriesMemoryEvidence(
                evidence_type=item["evidence_type"],
                source_ref=item["source_ref"],
                rationale=item.get("rationale"),
            )
            for item in evidence_payload
        ]
    session.add(new_memory)
    session.commit()
    return _load_memory(session, new_memory.id)


def get_series_memory_history(session: Session, memory_id: int) -> Sequence[SeriesMemory]:
    """按版本升序读取同一系列记忆谱系的完整历史。"""

    memory = session.get(SeriesMemory, memory_id)
    if memory is None:
        raise SeriesMemoryNotFoundError("系列记忆不存在，无法读取历史。")
    return session.scalars(
        select(SeriesMemory)
        .options(selectinload(SeriesMemory.evidence))
        .where(SeriesMemory.lineage_key == memory.lineage_key)
        .order_by(SeriesMemory.version, SeriesMemory.id)
    ).all()


def _load_memory(session: Session, memory_id: int) -> SeriesMemory:
    """带证据重新读取系列记忆，避免响应阶段触发懒加载。"""

    memory = session.scalars(
        select(SeriesMemory).options(selectinload(SeriesMemory.evidence)).where(SeriesMemory.id == memory_id)
    ).one_or_none()
    if memory is None:
        raise SeriesMemoryNotFoundError("系列记忆不存在，无法读取。")
    return memory
