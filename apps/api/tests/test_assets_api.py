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
from app.main import app


@pytest.fixture()
def session_factory() -> Generator[sessionmaker[Session], None, None]:
    """每个测试使用独立内存数据库，避免污染其他任务数据。"""

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
    """覆盖应用数据库依赖，使 API 测试完全本地可重复。"""

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
    """准备资产 API 所需的作品根实体。"""

    with session_factory() as session:
        book = Book(title="星海纪元", status="draft", premise="远航舰队寻找新家园。")
        session.add(book)
        session.commit()
        session.refresh(book)
        return book.id


def create_asset(client: TestClient, book_id: int, asset_type: str, name: str, payload: dict) -> dict:
    response = client.post(
        "/api/assets",
        json={
            "book_id": book_id,
            "asset_type": asset_type,
            "name": name,
            "payload": payload,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def create_scene(session_factory: sessionmaker[Session], book_id: int, title: str = "启航") -> int:
    """创建属于指定作品的章节和场景，供资产场景归属校验使用。"""

    with session_factory() as session:
        chapter = Chapter(book_id=book_id, ordinal=1, title=f"{title}章", status="draft", summary=None)
        session.add(chapter)
        session.flush()
        scene = Scene(chapter_id=chapter.id, ordinal=1, title=title, status="planned", content=None)
        session.add(scene)
        session.commit()
        session.refresh(scene)
        return scene.id


def test_create_character_asset(client: TestClient, book_id: int) -> None:
    """创建角色资产时返回首个版本和稳定谱系键。"""

    asset = create_asset(
        client,
        book_id,
        "character",
        "林岚",
        {"身份": "领航员", "目标": "找到宜居星球"},
    )

    assert asset["book_id"] == book_id
    assert asset["asset_type"] == "character"
    assert asset["name"] == "林岚"
    assert asset["version"] == 1
    assert asset["lineage_key"]


def test_create_location_asset(client: TestClient, book_id: int) -> None:
    """创建地点资产时保留结构化地点信息。"""

    asset = create_asset(
        client,
        book_id,
        "location",
        "灯塔港",
        {"地貌": "轨道港", "危险": "海盗巡航"},
    )

    assert asset["asset_type"] == "location"
    assert asset["payload"]["地貌"] == "轨道港"


def test_create_style_rule_asset(client: TestClient, book_id: int) -> None:
    """创建风格规则时使用同一资产契约承载规则内容。"""

    asset = create_asset(
        client,
        book_id,
        "style_rule",
        "叙事语气",
        {"规则": "保持克制而具画面感"},
    )

    assert asset["asset_type"] == "style_rule"
    assert asset["payload"]["规则"] == "保持克制而具画面感"


def test_list_book_assets_returns_latest_versions(client: TestClient, book_id: int) -> None:
    """查询作品资产列表时仅返回每条谱系的最新版本。"""

    character = create_asset(client, book_id, "character", "林岚", {"阶段": "初始"})
    location = create_asset(client, book_id, "location", "灯塔港", {"阶段": "初始"})

    response = client.patch(f"/api/assets/{character['id']}", json={"payload": {"阶段": "成长"}})
    assert response.status_code == 200, response.text

    list_response = client.get(f"/api/assets?book_id={book_id}")
    assert list_response.status_code == 200, list_response.text
    assets = list_response.json()

    assert len(assets) == 2
    assert {asset["name"] for asset in assets} == {"林岚", "灯塔港"}
    latest_character = next(asset for asset in assets if asset["lineage_key"] == character["lineage_key"])
    assert latest_character["version"] == 2
    assert latest_character["payload"]["阶段"] == "成长"
    assert location["lineage_key"] in {asset["lineage_key"] for asset in assets}


def test_update_asset_creates_new_version(client: TestClient, book_id: int) -> None:
    """更新资产版本时插入新记录并保持同一谱系。"""

    original = create_asset(client, book_id, "character", "林岚", {"阶段": "初始"})

    response = client.patch(
        f"/api/assets/{original['id']}",
        json={"name": "林岚·觉醒", "payload": {"阶段": "觉醒"}},
    )

    assert response.status_code == 200, response.text
    updated = response.json()
    assert updated["id"] != original["id"]
    assert updated["lineage_key"] == original["lineage_key"]
    assert updated["version"] == 2
    assert updated["name"] == "林岚·觉醒"


def test_read_asset_change_history(client: TestClient, book_id: int) -> None:
    """读取资产变更历史时按版本顺序返回全部记录。"""

    original = create_asset(client, book_id, "style_rule", "叙事语气", {"规则": "克制"})
    second_response = client.patch(f"/api/assets/{original['id']}", json={"payload": {"规则": "克制且具画面感"}})
    assert second_response.status_code == 200, second_response.text
    second = second_response.json()
    third_response = client.patch(f"/api/assets/{second['id']}", json={"payload": {"规则": "克制、具画面感、少用解释"}})
    assert third_response.status_code == 200, third_response.text

    history_response = client.get(f"/api/assets/{original['id']}/history")

    assert history_response.status_code == 200, history_response.text
    history = history_response.json()
    assert [item["version"] for item in history] == [1, 2, 3]
    assert [item["payload"]["规则"] for item in history] == [
        "克制",
        "克制且具画面感",
        "克制、具画面感、少用解释",
    ]
    assert len({item["id"] for item in history}) == 3


def test_patch_rejects_explicit_null_core_fields(client: TestClient, book_id: int) -> None:
    """显式传入 null 的核心字段必须由请求契约拒绝，不能落到数据库异常。"""

    original = create_asset(client, book_id, "character", "林岚", {"阶段": "初始"})

    for field_name in ("name", "status", "asset_type", "payload"):
        response = client.patch(f"/api/assets/{original['id']}", json={field_name: None})

        assert response.status_code == 422, response.text
        assert "不允许显式传入 null" in response.text


def test_update_from_historical_version_inherits_latest_fields(client: TestClient, book_id: int) -> None:
    """使用历史版本 id 更新时，新版本必须从谱系最新版本继承未改字段。"""

    original = create_asset(client, book_id, "character", "林岚", {"阶段": "初始"})
    second_response = client.patch(
        f"/api/assets/{original['id']}",
        json={"name": "林岚·觉醒", "payload": {"阶段": "觉醒"}},
    )
    assert second_response.status_code == 200, second_response.text

    third_response = client.patch(f"/api/assets/{original['id']}", json={"status": "archived"})

    assert third_response.status_code == 200, third_response.text
    third = third_response.json()
    assert third["version"] == 3
    assert third["name"] == "林岚·觉醒"
    assert third["payload"] == {"阶段": "觉醒"}
    assert third["status"] == "archived"


def test_create_asset_rejects_scene_from_other_book(
    client: TestClient,
    session_factory: sessionmaker[Session],
    book_id: int,
) -> None:
    """创建资产时 scene_id 必须存在且归属同一作品。"""

    with session_factory() as session:
        other_book = Book(title="边境纪事", status="draft", premise="另一条故事线。")
        session.add(other_book)
        session.commit()
        session.refresh(other_book)
        other_book_id = other_book.id
    other_scene_id = create_scene(session_factory, other_book_id, "边境")

    response = client.post(
        "/api/assets",
        json={
            "book_id": book_id,
            "scene_id": other_scene_id,
            "asset_type": "location",
            "name": "灯塔港",
            "payload": {"地貌": "轨道港"},
        },
    )

    assert response.status_code == 404, response.text
    assert response.json()["detail"] == "场景不存在或不属于该作品，无法创建资产。"


def test_create_asset_rejects_missing_scene(client: TestClient, book_id: int) -> None:
    """不存在的 scene_id 必须得到清晰响应，避免依赖外键异常。"""

    response = client.post(
        "/api/assets",
        json={
            "book_id": book_id,
            "scene_id": 999999,
            "asset_type": "location",
            "name": "灯塔港",
            "payload": {"地貌": "轨道港"},
        },
    )

    assert response.status_code == 404, response.text
    assert response.json()["detail"] == "场景不存在或不属于该作品，无法创建资产。"


def test_patch_rejects_empty_payload(client: TestClient, book_id: int) -> None:
    """空 PATCH 不会创建无意义版本。"""

    original = create_asset(client, book_id, "character", "林岚", {"阶段": "初始"})

    response = client.patch(f"/api/assets/{original['id']}", json={})

    assert response.status_code == 400, response.text
    assert response.json()["detail"] == "资产更新内容不能为空。"


def test_list_assets_filters_by_asset_type(client: TestClient, book_id: int) -> None:
    """asset_type 查询参数只返回匹配类型的最新资产。"""

    character = create_asset(client, book_id, "character", "林岚", {"阶段": "初始"})
    create_asset(client, book_id, "location", "灯塔港", {"地貌": "轨道港"})

    response = client.get(f"/api/assets?book_id={book_id}&asset_type=character")

    assert response.status_code == 200, response.text
    assets = response.json()
    assert len(assets) == 1
    assert assets[0]["id"] == character["id"]
    assert assets[0]["asset_type"] == "character"
