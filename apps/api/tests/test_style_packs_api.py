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
from app.domains.books.models import Book, Chapter, Scene
from app.domains.series.models import Series
from app.main import app


@pytest.fixture()
def session_factory() -> Generator[sessionmaker[Session], None, None]:
    """每个风格包 API 测试使用独立内存数据库。"""

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
    """覆盖数据库依赖，使风格包 API 测试完全本地可重复。"""

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
def story_scope(session_factory: sessionmaker[Session]) -> dict[str, int]:
    """准备系列、作品和场景，供风格包应用范围使用。"""

    with session_factory() as session:
        series = Series(title="群星三部曲", status="active", premise="跨代远航。", payload={})
        book = Book(title="群星第一部", status="draft", premise="舰队启航。")
        session.add_all([series, book])
        session.flush()
        chapter = Chapter(book_id=book.id, ordinal=1, title="启航", status="draft", summary=None)
        session.add(chapter)
        session.flush()
        scene = Scene(chapter_id=chapter.id, ordinal=1, title="灯塔港", status="planned", content=None)
        session.add(scene)
        session.commit()
        return {"series_id": series.id, "book_id": book.id, "scene_id": scene.id}


def test_create_update_apply_style_pack_and_read_effective_rules(
    client: TestClient,
    story_scope: dict[str, int],
) -> None:
    """风格包可创建、版本化更新，并按系列和作品范围合并生效规则。"""

    create_response = client.post(
        "/api/style-packs",
        json={
            "book_id": story_scope["book_id"],
            "name": "克制叙事",
            "payload": {
                "rules": ["保持克制", "减少解释性旁白"],
                "voice": "冷静、具画面感",
                "banned_phrases": ["作者直接解释"],
                "preferred_patterns": ["动作承载情绪"],
            },
        },
    )
    assert create_response.status_code == 201, create_response.text
    style_pack = create_response.json()
    assert style_pack["asset_type"] == "style_pack"
    assert style_pack["version"] == 1

    update_response = client.patch(
        f"/api/style-packs/{style_pack['id']}",
        json={"payload": {"rules": ["保持克制", "减少解释性旁白", "用动作承载情绪"]}},
    )
    assert update_response.status_code == 200, update_response.text
    updated_pack = update_response.json()
    assert updated_pack["lineage_key"] == style_pack["lineage_key"]
    assert updated_pack["version"] == 2

    series_apply_response = client.post(
        f"/api/style-packs/{updated_pack['id']}/applications",
        json={"style_pack_asset_id": updated_pack["id"], "series_id": story_scope["series_id"]},
    )
    assert series_apply_response.status_code == 201, series_apply_response.text
    assert series_apply_response.json()["series_id"] == story_scope["series_id"]

    book_apply_response = client.post(
        f"/api/style-packs/{updated_pack['id']}/applications",
        json={
            "style_pack_asset_id": updated_pack["id"],
            "book_id": story_scope["book_id"],
            "payload": {"rules": ["少用解释性旁白", "保留感官细节"]},
        },
    )
    assert book_apply_response.status_code == 201, book_apply_response.text
    assert book_apply_response.json()["book_id"] == story_scope["book_id"]

    rules_response = client.get(
        f"/api/style-packs/effective-rules?book_id={story_scope['book_id']}&scene_id={story_scope['scene_id']}"
    )
    assert rules_response.status_code == 200, rules_response.text
    rules = rules_response.json()
    assert rules["book_id"] == story_scope["book_id"]
    assert rules["rules"] == ["保持克制", "减少解释性旁白", "用动作承载情绪", "少用解释性旁白", "保留感官细节"]
    assert rules["voice"] == "冷静、具画面感"


def test_style_pack_application_requires_target_scope(client: TestClient, story_scope: dict[str, int]) -> None:
    """风格包应用必须至少选择系列、作品或场景范围之一。"""

    create_response = client.post(
        "/api/style-packs",
        json={"book_id": story_scope["book_id"], "name": "极简风格", "payload": {"rules": ["短句"]}},
    )
    assert create_response.status_code == 201, create_response.text
    style_pack = create_response.json()

    response = client.post(
        f"/api/style-packs/{style_pack['id']}/applications",
        json={"style_pack_asset_id": style_pack["id"]},
    )

    assert response.status_code == 422, response.text
    assert "至少选择一个应用范围" in response.text
