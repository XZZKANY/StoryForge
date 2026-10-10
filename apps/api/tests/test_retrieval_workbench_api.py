from __future__ import annotations

from sqlalchemy import event
from sqlalchemy.orm import Session, sessionmaker

import app.models  # noqa: F401
from app.domains.books.models import Book
from app.domains.retrieval.models import RetrievalRefreshRun
from app.domains.retrieval.schemas import RetrievalSourceCreate
from app.domains.retrieval.service import (
    create_retrieval_source,
    list_retrieval_workbench_sources,
)


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
    assert select_count == 1



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
