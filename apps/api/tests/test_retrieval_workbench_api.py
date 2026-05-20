from __future__ import annotations

from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.base import Base
from app.db.session import get_session
from app.domains.books.models import Book
from app.domains.retrieval.models import RetrievalRefreshRun
from app.domains.retrieval.schemas import RetrievalRefreshRunCreate, RetrievalSourceCreate
from app.domains.retrieval.service import (
    create_retrieval_refresh_run,
    create_retrieval_source,
    list_retrieval_workbench_sources,
)
from app.main import app


def test_list_retrieval_workbench_sources_returns_source_summary(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """Retrieval 工作台资料源列表读取真实资料源摘要。"""

    with session_factory() as session:
        book = Book(title="检索工作台作品", status="draft", premise="验证资料源列表。")
        session.add(book)
        session.commit()
        source = create_retrieval_source(
            session,
            RetrievalSourceCreate(
                book_id=book.id,
                source_type="reference_doc",
                title="灯塔资料",
                content_text="灯塔信号每七分钟重复一次。旧协议要求隐藏伤员。",
                payload={"origin": "upload"},
            ),
        )
        book_id = book.id
        source_id = source.id
        chunk_count = source.chunk_count

    response = client.get(f"/api/retrieval/workbench/sources?book_id={book_id}")

    assert response.status_code == 200, response.text
    assert response.json() == [
        {
            "id": source_id,
            "book_id": book_id,
            "series_id": None,
            "source_type": "reference_doc",
            "title": "灯塔资料",
            "status": "active",
            "chunk_count": chunk_count,
            "refresh_status": "not_refreshed",
            "evidence_anchor": f"retrieval-source-{source_id}",
        }
    ]


def test_list_retrieval_workbench_refresh_runs_returns_embedding_summary(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """Retrieval 工作台刷新任务读取真实刷新记录摘要。"""

    with session_factory() as session:
        book = Book(title="刷新任务作品", status="draft", premise="验证刷新任务列表。")
        session.add(book)
        session.commit()
        source = create_retrieval_source(
            session,
            RetrievalSourceCreate(
                book_id=book.id,
                source_type="chapter_snapshot",
                title="章节快照",
                content_text="林岚在灯塔下确认旧协议。副官保留备用通道。",
            ),
        )
        refresh_run = create_retrieval_refresh_run(session, RetrievalRefreshRunCreate(source_id=source.id))
        source_id = source.id
        run_id = refresh_run.id
        chunk_count = refresh_run.chunk_count

    response = client.get(f"/api/retrieval/workbench/refresh-runs?source_id={source_id}")

    assert response.status_code == 200, response.text
    assert response.json() == [
        {
            "id": run_id,
            "source_id": source_id,
            "book_id": None,
            "series_id": None,
            "status": "completed",
            "chunk_count": chunk_count,
            "embedding_provider": "local",
            "embedding_model": "storyforge-fake-embedding",
            "credential_status": "not_required",
            "source_ids": [source_id],
        }
    ]


def test_search_retrieval_workbench_returns_hit_preview_and_evidence_href(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """Retrieval 工作台搜索数据源返回命中预览和证据跳转。"""

    with session_factory() as session:
        book = Book(title="搜索工作台作品", status="draft", premise="验证搜索结果。")
        session.add(book)
        session.commit()
        create_retrieval_source(
            session,
            RetrievalSourceCreate(
                book_id=book.id,
                source_type="series_memory",
                title="旧港记忆",
                content_text="灯塔信号每七分钟重复一次。林岚必须隐藏左臂旧伤。",
            ),
        )
        book_id = book.id

    response = client.post(
        "/api/retrieval/workbench/search",
        json={"book_id": book_id, "query": "灯塔 旧伤", "limit": 2},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["query"] == "灯塔 旧伤"
    assert payload["hits"]
    first_hit = payload["hits"][0]
    assert first_hit["title"] == "旧港记忆"
    assert "灯塔" in first_hit["excerpt"]
    assert first_hit["rank"] == 1
    assert first_hit["source_ref"].startswith("retrieval:")
    assert first_hit["evidence_href"] == f"#retrieval-evidence-{first_hit['source_id']}-{first_hit['chunk_id']}"


def test_list_retrieval_workbench_sources_batches_latest_refresh_runs(engine, session_factory: sessionmaker[Session]) -> None:
    """Workbench 资料源列表应批量读取最新刷新状态，避免按资料源数量放大查询。"""

    with session_factory() as session:
        book = Book(title="批量刷新状态作品", status="draft", premise="验证 N+1 查询消除。")
        session.add(book)
        session.commit()
        sources = [
            create_retrieval_source(
                session,
                RetrievalSourceCreate(
                    book_id=book.id,
                    source_type="reference_doc",
                    title=f"资料源 {index}",
                    content_text=f"灯塔资料 {index}。旧协议记录 {index}。",
                ),
            )
            for index in range(3)
        ]
        session.add(
            RetrievalRefreshRun(
                source_id=sources[1].id,
                status="failed",
                chunk_count=0,
                payload={"source_ids": [sources[1].id]},
            )
        )
        session.commit()
        latest_run = RetrievalRefreshRun(
            source_id=sources[1].id,
            status="completed",
            chunk_count=sources[1].chunk_count,
            payload={"source_ids": [sources[1].id]},
        )
        session.add(latest_run)
        session.commit()

        select_count = 0

        def count_selects(conn, cursor, statement, parameters, context, executemany) -> None:
            nonlocal select_count
            if statement.lstrip().lower().startswith("select"):
                select_count += 1

        event.listen(engine, "before_cursor_execute", count_selects)
        try:
            summaries = list_retrieval_workbench_sources(session, book_id=book.id)
        finally:
            event.remove(engine, "before_cursor_execute", count_selects)

    assert [summary.id for summary in summaries] == [source.id for source in sources]
    assert [summary.refresh_status for summary in summaries] == ["not_refreshed", "completed", "not_refreshed"]
    assert select_count <= 3



def test_list_retrieval_workbench_sources_uses_chunk_count_aggregate_without_loading_chunk_payloads(
    engine,
    session_factory: sessionmaker[Session],
) -> None:
    """Workbench 资料源列表只应聚合 chunk 数量，不应加载 chunk 大字段。"""

    with session_factory() as session:
        book = Book(title="聚合计数作品", status="draft", premise="验证 chunk_count 聚合。")
        session.add(book)
        session.commit()
        source = create_retrieval_source(
            session,
            RetrievalSourceCreate(
                book_id=book.id,
                source_type="reference_doc",
                title="超长资料",
                content_text="灯塔信号每七分钟重复一次。" * 40,
            ),
        )
        source_id = source.id
        book_id = book.id
        expected_chunk_count = source.chunk_count

    statements: list[str] = []

    def capture_sql(conn, cursor, statement, parameters, context, executemany) -> None:
        if statement.lstrip().lower().startswith("select"):
            statements.append(" ".join(statement.lower().split()))

    event.listen(engine, "before_cursor_execute", capture_sql)
    try:
        with session_factory() as session:
            summaries = list_retrieval_workbench_sources(session, book_id=book_id)
    finally:
        event.remove(engine, "before_cursor_execute", capture_sql)

    assert [(summary.id, summary.chunk_count) for summary in summaries] == [(source_id, expected_chunk_count)]
    chunk_payload_selects = [
        statement
        for statement in statements
        if "from retrieval_chunks" in statement
        and ("retrieval_chunks.content" in statement or "retrieval_chunks.embedding" in statement)
    ]
    assert chunk_payload_selects == []
