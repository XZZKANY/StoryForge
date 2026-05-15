from __future__ import annotations

from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.base import Base
from app.db.session import get_session
from app.domains.series.models import Series, SeriesMemory, SeriesMemoryEvidence
from app.main import app


@pytest.fixture()
def session_factory() -> Generator[sessionmaker[Session], None, None]:
    """每个系列级记忆测试使用独立内存数据库。"""

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
    """覆盖数据库依赖，复用 API 本地 TestClient 模式。"""

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


def test_series_memory_keeps_latest_history_and_evidence(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """系列级记忆按谱系保留历史，并输出最新版本和证据。"""

    series_response = client.post(
        "/api/series",
        json={"title": "星海纪元", "description": "远航舰队系列。"},
    )
    assert series_response.status_code == 201, series_response.text
    series_id = series_response.json()["id"]
    memory_response = client.post(
        f"/api/series/{series_id}/memories",
        json={
            "memory_type": "world_rule",
            "subject": "灯塔信号",
            "payload": {"规则": "灯塔信号每七分钟重复一次。"},
            "evidence": [
                {
                    "evidence_type": "chapter_fact",
                    "source_ref": "book:1/chapter:2",
                    "rationale": "第二章批准后写入系列规则。",
                }
            ],
        },
    )
    assert memory_response.status_code == 201, memory_response.text
    memory = memory_response.json()
    assert memory["version"] == 1
    assert memory["memory_type"] == "world_rule"
    assert memory["evidence"][0]["source_ref"] == "book:1/chapter:2"

    update_response = client.patch(
        f"/api/series/memories/{memory['id']}",
        json={"payload": {"规则": "灯塔信号每七分钟重复一次，且会召回旧航线。"}},
    )
    assert update_response.status_code == 200, update_response.text
    assert update_response.json()["version"] == 2

    latest_response = client.get(f"/api/series/{series_id}/memories", params={"memory_type": "world_rule"})
    assert latest_response.status_code == 200, latest_response.text
    latest = latest_response.json()
    assert len(latest) == 1
    assert latest[0]["version"] == 2
    assert latest[0]["payload"]["规则"].endswith("旧航线。")

    history_response = client.get(f"/api/series/memories/{memory['id']}/history")
    assert history_response.status_code == 200, history_response.text
    assert [item["version"] for item in history_response.json()] == [1, 2]

    with session_factory() as session:
        rows = session.scalars(select(SeriesMemory).order_by(SeriesMemory.version)).all()
        evidence_rows = session.scalars(select(SeriesMemoryEvidence)).all()
    assert [row.version for row in rows] == [1, 2]
    assert evidence_rows[0].rationale == "第二章批准后写入系列规则。"


def test_series_memory_isolated_between_series(client: TestClient) -> None:
    """不同系列的记忆列表必须按 series_id 隔离。"""

    first = client.post("/api/series", json={"title": "星海纪元"}).json()
    second = client.post("/api/series", json={"title": "雾港纪事"}).json()
    response = client.post(
        f"/api/series/{first['id']}/memories",
        json={
            "memory_type": "character_state",
            "subject": "林岚",
            "payload": {"状态": "左臂旧伤贯穿全系列。"},
        },
    )
    assert response.status_code == 201, response.text

    first_memories = client.get(f"/api/series/{first['id']}/memories").json()
    second_memories = client.get(f"/api/series/{second['id']}/memories").json()
    assert [item["subject"] for item in first_memories] == ["林岚"]
    assert second_memories == []


def test_series_memory_rejects_missing_series(client: TestClient) -> None:
    """不存在的系列不能产生孤立记忆。"""

    response = client.post(
        "/api/series/999/memories",
        json={"memory_type": "world_rule", "subject": "灯塔", "payload": {}},
    )
    assert response.status_code == 404
    assert "系列不存在" in response.json()["detail"]
