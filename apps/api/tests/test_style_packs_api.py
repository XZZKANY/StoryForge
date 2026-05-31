from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

import app.models  # noqa: F401
from app.domains.books.models import Book, Chapter, Scene


def _create_story_scope(session_factory: sessionmaker[Session]) -> dict[str, int]:
    """准备作品和场景，供风格包应用范围使用。"""

    with session_factory() as session:
        book = Book(title="群星第一部", status="draft", premise="舰队启航。")
        session.add(book)
        session.flush()
        chapter = Chapter(book_id=book.id, ordinal=1, title="启航", status="draft", summary=None)
        session.add(chapter)
        session.flush()
        scene = Scene(chapter_id=chapter.id, ordinal=1, title="灯塔港", status="planned", content=None)
        session.add(scene)
        session.commit()
        return {"book_id": book.id, "scene_id": scene.id}


def test_create_update_apply_style_pack_and_list_latest(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """风格包可创建、版本化更新、应用为规则，并只列出最新版本。"""

    story_scope = _create_story_scope(session_factory)
    create_response = client.post(
        "/api/style-packs",
        json={
            "book_id": story_scope["book_id"],
            "name": "克制叙事",
            "payload": {
                "规则": "保持克制",
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
        json={
            "payload": {
                "规则": "保持克制，用动作承载情绪",
                "禁用表达": ["作者直接解释"],
                "示例句": ["她把解释压回沉默里。"],
            }
        },
    )
    assert update_response.status_code == 200, update_response.text
    updated_pack = update_response.json()
    assert updated_pack["lineage_key"] == style_pack["lineage_key"]
    assert updated_pack["version"] == 2

    apply_response = client.post(
        f"/api/style-packs/{style_pack['id']}/apply",
        json={"book_id": story_scope["book_id"], "scene_id": story_scope["scene_id"]},
    )
    assert apply_response.status_code == 201, apply_response.text
    applied = apply_response.json()
    assert applied["asset_type"] == "style_rule"
    assert applied["scene_id"] == story_scope["scene_id"]
    assert applied["payload"]["style_pack_id"] == updated_pack["id"]
    assert applied["payload"]["规则"] == "保持克制，用动作承载情绪"

    list_response = client.get("/api/style-packs", params={"book_id": story_scope["book_id"]})
    assert list_response.status_code == 200, list_response.text
    packs = list_response.json()
    assert [pack["id"] for pack in packs] == [updated_pack["id"]]
    assert packs[0]["version"] == 2


def test_style_pack_apply_rejects_scene_from_another_book(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """风格包应用不能越过作品边界绑定场景。"""

    first_scope = _create_story_scope(session_factory)
    second_scope = _create_story_scope(session_factory)
    create_response = client.post(
        "/api/style-packs",
        json={"book_id": first_scope["book_id"], "name": "极简风格", "payload": {"规则": "短句"}},
    )
    assert create_response.status_code == 201, create_response.text
    style_pack = create_response.json()

    response = client.post(
        f"/api/style-packs/{style_pack['id']}/apply",
        json={"book_id": first_scope["book_id"], "scene_id": second_scope["scene_id"]},
    )

    assert response.status_code == 400, response.text
    assert "场景不存在或不属于该作品" in response.json()["detail"]
