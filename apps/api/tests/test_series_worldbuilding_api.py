from __future__ import annotations

from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.base import Base
from app.db.session import get_session
from app.domains.books.models import Book
from app.main import app


@pytest.fixture()
def session_factory() -> Generator[sessionmaker[Session], None, None]:
    """每个系列与世界观 API 测试使用独立内存数据库。"""

    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    try:
        yield factory
    finally:
        Base.metadata.drop_all(engine)
        engine.dispose()


@pytest.fixture()
def client(session_factory: sessionmaker[Session]) -> Generator[TestClient, None, None]:
    """覆盖数据库依赖，使路由在同一 SQLite 内存库中执行。"""

    def override_get_session() -> Generator[Session, None, None]:
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_session] = override_get_session
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture()
def book_id(session_factory: sessionmaker[Session]) -> int:
    """准备可绑定到系列的作品。"""

    with session_factory() as session:
        book = Book(title="群星三部曲：第一部", status="draft", premise="舰队寻找新家园。")
        session.add(book)
        session.commit()
        session.refresh(book)
        return book.id


def test_create_series_attach_book_and_read_memory_summary(client: TestClient, book_id: int) -> None:
    """系列记忆摘要应包含系列、作品、记忆快照和世界观条目。"""

    series_response = client.post(
        "/api/series",
        json={"title": "群星三部曲", "premise": "三代舰队穿越失落航道。", "payload": {"主题": "迁徙"}},
    )
    assert series_response.status_code == 201, series_response.text
    series = series_response.json()
    assert series["title"] == "群星三部曲"
    assert series["versioned_memory_count"] == 0

    attach_response = client.post(
        f"/api/series/{series['id']}/books",
        json={"book_id": book_id, "ordinal": 1, "inheritance_policy": "inherit_active"},
    )
    assert attach_response.status_code == 201, attach_response.text
    attached = attach_response.json()
    assert attached["book_id"] == book_id
    assert attached["ordinal"] == 1

    worldbuilding_response = client.post(
        "/api/worldbuilding/entries",
        json={
            "book_id": book_id,
            "entry_type": "term",
            "name": "灯塔港",
            "payload": {"定义": "舰队进入失落航道前的最后补给港"},
        },
    )
    assert worldbuilding_response.status_code == 201, worldbuilding_response.text
    entry = worldbuilding_response.json()
    assert entry["asset_type"] == "worldbuilding:term"
    assert entry["version"] == 1

    update_response = client.patch(
        f"/api/worldbuilding/entries/{entry['id']}",
        json={"payload": {"定义": "最后补给港，隐藏着旧无线电协议"}, "name": "灯塔港术语"},
    )
    assert update_response.status_code == 200, update_response.text
    updated_entry = update_response.json()
    assert updated_entry["lineage_key"] == entry["lineage_key"]
    assert updated_entry["version"] == 2
    assert updated_entry["asset_type"] == "worldbuilding:term"

    snapshot_response = client.post(
        f"/api/series/{series['id']}/memory-snapshots",
        json={
            "series_id": series["id"],
            "book_id": book_id,
            "snapshot_type": "world_state",
            "subject": "灯塔港",
            "payload": {"摘要": "灯塔港保存旧无线电协议，后续作品必须继承。"},
        },
    )
    assert snapshot_response.status_code == 201, snapshot_response.text
    snapshot = snapshot_response.json()
    assert snapshot["series_id"] == series["id"]
    assert snapshot["version"] == 1

    summary_response = client.get(f"/api/series/{series['id']}/memory-summary")
    assert summary_response.status_code == 200, summary_response.text
    summary = summary_response.json()
    assert summary["series"]["title"] == "群星三部曲"
    assert summary["books"][0]["book_id"] == book_id
    assert summary["latest_memory_snapshots"][0]["subject"] == "灯塔港"
    assert summary["worldbuilding_entries"][0]["name"] == "灯塔港术语"
    assert summary["worldbuilding_entries"][0]["version"] == 2


def test_worldbuilding_entry_list_filters_by_book_and_latest_version(client: TestClient, book_id: int) -> None:
    """世界观条目列表只返回指定作品下每条谱系的最新版本。"""

    first_response = client.post(
        "/api/worldbuilding/entries",
        json={
            "book_id": book_id,
            "entry_type": "organization",
            "name": "星桥议会",
            "payload": {"职责": "维护航道"},
        },
    )
    assert first_response.status_code == 201, first_response.text
    first = first_response.json()
    patch_response = client.patch(
        f"/api/worldbuilding/entries/{first['id']}",
        json={"payload": {"职责": "维护航道并封存禁区坐标"}},
    )
    assert patch_response.status_code == 200, patch_response.text

    list_response = client.get(f"/api/worldbuilding/entries?book_id={book_id}")
    assert list_response.status_code == 200, list_response.text
    entries = list_response.json()
    assert len(entries) == 1
    assert entries[0]["lineage_key"] == first["lineage_key"]
    assert entries[0]["version"] == 2
    assert entries[0]["asset_type"] == "worldbuilding:organization"
