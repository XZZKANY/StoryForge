from __future__ import annotations

from collections.abc import Generator

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.base import Base
from app.db.session import get_session
from app.domains.assets.models import Asset
from app.domains.books.models import Book, Chapter, Scene
from app.main import app


import pytest


@pytest.fixture()
def session_factory() -> Generator[sessionmaker[Session], None, None]:
    """每个风格包测试使用独立内存数据库。"""

    engine = create_engine("sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    try:
        yield factory
    finally:
        Base.metadata.drop_all(engine)
        engine.dispose()


@pytest.fixture()
def client(session_factory: sessionmaker[Session]) -> Generator[TestClient, None, None]:
    """覆盖数据库依赖，确保风格包 API 完全本地可重复。"""

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
def style_context(session_factory: sessionmaker[Session]) -> dict[str, int]:
    """准备作品、章节和场景，供风格包应用与 Scene Packet 验证。"""

    with session_factory() as session:
        book = Book(title="灯塔余烬", status="draft", premise="林岚追查信号。")
        session.add(book)
        session.flush()
        chapter = Chapter(book_id=book.id, ordinal=1, title="旧港", status="draft", summary="林岚抵达港口。")
        session.add(chapter)
        session.flush()
        scene = Scene(chapter_id=chapter.id, ordinal=1, title="谈判", status="draft", content="林岚走入港口。")
        session.add(scene)
        session.flush()
        character = Asset(
            book_id=book.id,
            scene_id=scene.id,
            asset_type="character",
            lineage_key="char-linlan",
            name="林岚",
            status="active",
            payload={"状态": "隐瞒伤势", "必须包含事实": ["左臂受伤"]},
            version=1,
        )
        session.add(character)
        session.commit()
        return {"book_id": book.id, "chapter_id": chapter.id, "scene_id": scene.id, "character_id": character.id}


def test_style_pack_versioning_apply_and_scene_packet_integration(
    client: TestClient,
    style_context: dict[str, int],
) -> None:
    """风格包支持版本化更新，并能应用为 Scene Packet 可消费的风格规则。"""

    create_response = client.post(
        "/api/style-packs",
        json={
            "book_id": style_context["book_id"],
            "name": "港口克制风格包",
            "payload": {
                "规则": "保持克制而具画面感",
                "禁用表达": ["作者直接解释"],
                "示例句": ["她把疼痛压回袖口。"],
            },
        },
    )
    assert create_response.status_code == 201, create_response.text
    style_pack = create_response.json()
    assert style_pack["asset_type"] == "style_pack"
    assert style_pack["version"] == 1

    update_response = client.patch(
        f"/api/style-packs/{style_pack['id']}",
        json={"payload": {"规则": "保持克制而具画面感", "禁用表达": ["旁白解释"], "示例句": ["她把解释压回沉默里。"]}},
    )
    assert update_response.status_code == 200, update_response.text
    updated = update_response.json()
    assert updated["version"] == 2

    apply_response = client.post(
        f"/api/style-packs/{style_pack['id']}/apply",
        json={"book_id": style_context["book_id"], "scene_id": style_context["scene_id"]},
    )
    assert apply_response.status_code == 201, apply_response.text
    applied_asset = apply_response.json()
    assert applied_asset["asset_type"] == "style_rule"
    assert applied_asset["payload"]["style_pack_id"] == style_pack["id"]
    assert applied_asset["payload"]["规则"] == "保持克制而具画面感"

    packet_response = client.post(
        "/api/scene-packets",
        json={
            "book_id": style_context["book_id"],
            "chapter_id": style_context["chapter_id"],
            "scene_goal": "林岚在谈判中隐藏伤势。",
            "active_asset_ids": [style_context["character_id"], applied_asset["id"]],
            "token_budget": 180,
            "user_intent": "保持克制且具画面感。",
            "retrieval_snippets": ["港口广播比平时更刺耳。"],
        },
    )
    assert packet_response.status_code == 201, packet_response.text
    packet = packet_response.json()
    assert packet["packet"]["风格规则"][0]["rule"] == "保持克制而具画面感"


def test_style_pack_listing_returns_latest_versions_only(client: TestClient, style_context: dict[str, int]) -> None:
    """风格包列表只返回每条谱系的最新版本。"""

    created = client.post(
        "/api/style-packs",
        json={"book_id": style_context["book_id"], "name": "章节风格", "payload": {"规则": "冷静"}},
    ).json()
    client.patch(f"/api/style-packs/{created['id']}", json={"payload": {"规则": "更冷静"}})

    response = client.get("/api/style-packs", params={"book_id": style_context["book_id"]})
    assert response.status_code == 200, response.text
    results = response.json()
    assert len(results) == 1
    assert results[0]["version"] == 2
