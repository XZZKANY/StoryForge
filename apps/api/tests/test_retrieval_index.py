from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

import app.models  # noqa: F401
from app.domains.books.models import Book
from app.domains.series.models import Series


@pytest.fixture()
def retrieval_scope(session_factory: sessionmaker[Session]) -> dict[str, int]:
    with session_factory() as session:
        book = Book(title="灯塔余烬", status="draft", premise="林岚追查信号。")
        series = Series(title="星海纪元", status="active", description="远航舰队系列。")
        session.add_all([book, series])
        session.commit()
        return {"book_id": book.id, "series_id": series.id}


def test_retrieval_source_refresh_and_search(client: TestClient, retrieval_scope: dict[str, int]) -> None:
    created = client.post(
        "/api/retrieval/sources",
        json={
            "book_id": retrieval_scope["book_id"],
            "series_id": retrieval_scope["series_id"],
            "source_type": "reference_doc",
            "title": "灯塔港档案",
            "content_text": "灯塔信号每七分钟重复一次。林岚必须隐藏伤势。港口议会只相信旧协议。",
            "payload": {"origin": "upload", "api_key": "secret-retrieval-value"},
        },
    )
    assert created.status_code == 201, created.text
    source = created.json()
    assert source["chunk_count"] >= 1
    assert source["payload"]["api_key"] == "[REDACTED]"
    assert "secret-retrieval-value" not in created.text

    refresh = client.post(
        "/api/retrieval/refresh-runs",
        json={"source_id": source["id"]},
    )
    assert refresh.status_code == 201, refresh.text
    assert refresh.json()["chunk_count"] >= 1

    search = client.post(
        "/api/retrieval/search",
        json={"book_id": retrieval_scope["book_id"], "query": "灯塔信号 旧协议", "limit": 3},
    )
    assert search.status_code == 200, search.text
    hits = search.json()
    assert hits
    assert hits[0]["source_ref"].startswith("retrieval:")
    assert hits[0]["book_id"] == retrieval_scope["book_id"]
    assert hits[0]["series_id"] == retrieval_scope["series_id"]
    assert hits[0]["rank"] == 1
    assert hits[0]["score"] >= hits[-1]["score"]
    assert "灯塔" in hits[0]["excerpt"]
