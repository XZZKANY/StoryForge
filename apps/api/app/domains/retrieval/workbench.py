from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.domains.retrieval.models import RetrievalChunk, RetrievalRefreshRun, RetrievalSource
from app.domains.retrieval.schemas import (
    RetrievalHitRead,
    RetrievalWorkbenchHitRead,
    RetrievalWorkbenchRefreshRunRead,
    RetrievalWorkbenchSourceRead,
)


def list_retrieval_workbench_sources(
    session: Session,
    book_id: int | None = None,
    series_id: int | None = None,
) -> list[RetrievalWorkbenchSourceRead]:
    rows = _list_workbench_source_rows(session, book_id=book_id, series_id=series_id)
    return [
        _build_workbench_source(source, latest_refresh, int(chunk_count or 0))
        for source, chunk_count, latest_refresh in rows
    ]


def _list_workbench_source_rows(
    session: Session,
    book_id: int | None = None,
    series_id: int | None = None,
):
    chunk_counts = (
        select(
            RetrievalChunk.source_id.label("source_id"),
            func.count(RetrievalChunk.id).label("chunk_count"),
        )
        .group_by(RetrievalChunk.source_id)
        .subquery()
    )
    latest_run_ids = (
        select(
            RetrievalRefreshRun.source_id.label("source_id"),
            func.max(RetrievalRefreshRun.id).label("latest_run_id"),
        )
        .where(RetrievalRefreshRun.source_id.is_not(None))
        .group_by(RetrievalRefreshRun.source_id)
        .subquery()
    )
    statement = (
        select(
            RetrievalSource,
            func.coalesce(chunk_counts.c.chunk_count, 0).label("chunk_count"),
            RetrievalRefreshRun,
        )
        .outerjoin(chunk_counts, chunk_counts.c.source_id == RetrievalSource.id)
        .outerjoin(latest_run_ids, latest_run_ids.c.source_id == RetrievalSource.id)
        .outerjoin(RetrievalRefreshRun, RetrievalRefreshRun.id == latest_run_ids.c.latest_run_id)
        .order_by(RetrievalSource.id)
    )
    if book_id is not None:
        statement = statement.where(RetrievalSource.book_id == book_id)
    if series_id is not None:
        statement = statement.where(RetrievalSource.series_id == series_id)
    return session.execute(statement).all()


def list_retrieval_workbench_refresh_runs(
    session: Session,
    source_id: int | None = None,
    book_id: int | None = None,
    series_id: int | None = None,
) -> list[RetrievalWorkbenchRefreshRunRead]:
    statement = select(RetrievalRefreshRun).order_by(RetrievalRefreshRun.id.desc())
    if source_id is not None:
        statement = statement.where(RetrievalRefreshRun.source_id == source_id)
    if book_id is not None:
        statement = statement.where(RetrievalRefreshRun.book_id == book_id)
    if series_id is not None:
        statement = statement.where(RetrievalRefreshRun.series_id == series_id)
    return [_build_workbench_refresh_run(run) for run in session.scalars(statement).all()]


def _build_workbench_source(
    source: RetrievalSource,
    latest_refresh: RetrievalRefreshRun | None = None,
    chunk_count: int | None = None,
) -> RetrievalWorkbenchSourceRead:
    return RetrievalWorkbenchSourceRead(
        id=source.id,
        book_id=source.book_id,
        series_id=source.series_id,
        source_type=source.source_type,
        title=source.title,
        status=source.status,
        chunk_count=source.chunk_count if chunk_count is None else chunk_count,
        refresh_status=latest_refresh.status if latest_refresh is not None else "not_refreshed",
        evidence_anchor=f"retrieval-source-{source.id}",
    )


def _build_workbench_refresh_run(run: RetrievalRefreshRun) -> RetrievalWorkbenchRefreshRunRead:
    source_ids = run.payload.get("source_ids", [])
    return RetrievalWorkbenchRefreshRunRead(
        id=run.id,
        source_id=run.source_id,
        book_id=run.book_id,
        series_id=run.series_id,
        status=run.status,
        chunk_count=run.chunk_count,
        embedding_provider=run.payload.get("embedding_provider"),
        embedding_model=run.payload.get("embedding_model"),
        credential_status=run.payload.get("credential_status"),
        source_ids=[source_id for source_id in source_ids if isinstance(source_id, int)],
    )


def _build_workbench_hit(hit: RetrievalHitRead) -> RetrievalWorkbenchHitRead:
    return RetrievalWorkbenchHitRead(
        **hit.model_dump(),
        evidence_href=f"#retrieval-evidence-{hit.source_id}-{hit.chunk_id}",
    )
