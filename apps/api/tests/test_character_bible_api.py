from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import inspect
from sqlalchemy.orm import Session, sessionmaker

import app.models  # noqa: F401
from app.domains.assets.models import Asset
from app.domains.books.models import Book
from app.domains.story_memory.service import list_memory_atoms


def seed_book(session_factory: sessionmaker[Session], title: str = "雾港角色规则") -> int:
    """创建 Character Bible API 所需作品。"""

    with session_factory() as session:
        book = Book(title=title, status="draft", premise="验证角色硬规则。")
        session.add(book)
        session.commit()
        session.refresh(book)
        return book.id


def seed_character_asset(session_factory: sessionmaker[Session], book_id: int, name: str = "林岚") -> int:
    """创建角色资产，供 Character Bible 绑定 character_id。"""

    with session_factory() as session:
        asset = Asset(
            book_id=book_id,
            scene_id=None,
            asset_type="character",
            lineage_key=f"char-{book_id}-{name}",
            name=name,
            status="active",
            payload={"身份": "调查员"},
            version=1,
        )
        session.add(asset)
        session.commit()
        session.refresh(asset)
        return asset.id


def test_character_bible_table_has_required_fields(session: Session) -> None:
    """character_bible_entries 表必须包含 9C-2a 要求的最小字段。"""

    columns = inspect(session.bind).get_columns("character_bible_entries")
    column_names = {column["name"] for column in columns}

    assert {
        "book_id",
        "character_id",
        "canonical_name",
        "aliases",
        "voice_traits",
        "forbidden_traits",
        "lineage_key",
        "version",
        "sync_status",
        "memory_atom_id",
    }.issubset(column_names)


def test_character_bible_crud_flow(client: TestClient, session_factory: sessionmaker[Session]) -> None:
    """Character Bible API 应支持创建、列表、读取、更新和删除。"""

    book_id = seed_book(session_factory)
    character_id = seed_character_asset(session_factory, book_id)
    create_response = client.post(
        "/api/character-bible",
        json={
            "book_id": book_id,
            "character_id": character_id,
            "canonical_name": "林岚",
            "aliases": ["林调查员", "雾港来客"],
            "voice_traits": {"语气": "克制", "句式": ["短句", "少解释"]},
            "forbidden_traits": {"禁止": ["突然健谈", "忘记左臂旧伤"]},
        },
    )

    assert create_response.status_code == 201, create_response.text
    created = create_response.json()
    assert created["book_id"] == book_id
    assert created["character_id"] == character_id
    assert created["canonical_name"] == "林岚"
    assert created["aliases"] == ["林调查员", "雾港来客"]
    assert created["voice_traits"]["语气"] == "克制"
    assert created["forbidden_traits"]["禁止"] == ["突然健谈", "忘记左臂旧伤"]
    assert created["lineage_key"]
    assert created["version"] == 1
    assert created["sync_status"] == "synced"
    assert created["memory_atom_id"].startswith("memory:")

    list_response = client.get(f"/api/character-bible?book_id={book_id}")
    assert list_response.status_code == 200, list_response.text
    assert [item["id"] for item in list_response.json()] == [created["id"]]

    read_response = client.get(f"/api/character-bible/{created['id']}")
    assert read_response.status_code == 200, read_response.text
    assert read_response.json()["canonical_name"] == "林岚"

    update_response = client.patch(
        f"/api/character-bible/{created['id']}",
        json={
            "aliases": ["林岚"],
            "voice_traits": {"语气": "冷静", "禁忌": "自我解释"},
            "forbidden_traits": {"禁止": ["忘记旧伤"]},
        },
    )
    assert update_response.status_code == 200, update_response.text
    updated = update_response.json()
    assert updated["aliases"] == ["林岚"]
    assert updated["voice_traits"]["语气"] == "冷静"
    assert updated["forbidden_traits"]["禁止"] == ["忘记旧伤"]
    assert updated["id"] != created["id"]
    assert updated["lineage_key"] == created["lineage_key"]
    assert updated["version"] == 2
    assert updated["memory_atom_id"].startswith("memory:")
    assert updated["memory_atom_id"] != created["memory_atom_id"]

    delete_response = client.delete(f"/api/character-bible/{updated['id']}")
    assert delete_response.status_code == 204, delete_response.text

    missing_response = client.get(f"/api/character-bible/{updated['id']}")
    assert missing_response.status_code == 404, missing_response.text


def test_character_bible_keeps_history_and_syncs_story_memory(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """Character Bible 更新必须保留版本历史，并同步为 Story Memory 角色规则事实。"""

    book_id = seed_book(session_factory)
    create_response = client.post(
        "/api/character-bible",
        json={
            "book_id": book_id,
            "canonical_name": "林岚",
            "aliases": ["林调查员"],
            "voice_traits": {"语气": "克制"},
            "forbidden_traits": {"禁止": ["突然健谈"]},
        },
    )
    assert create_response.status_code == 201, create_response.text
    created = create_response.json()

    update_response = client.patch(
        f"/api/character-bible/{created['id']}",
        json={
            "voice_traits": {"语气": "冷静", "句式": ["短句"]},
            "forbidden_traits": {"禁止": ["突然健谈", "忘记旧伤"]},
        },
    )
    assert update_response.status_code == 200, update_response.text
    updated = update_response.json()

    latest_response = client.get("/api/character-bible", params={"book_id": book_id})
    assert latest_response.status_code == 200, latest_response.text
    latest = latest_response.json()
    assert [item["id"] for item in latest] == [updated["id"]]
    assert latest[0]["version"] == 2

    history_response = client.get(f"/api/character-bible/{created['id']}/history")
    assert history_response.status_code == 200, history_response.text
    history = history_response.json()
    assert [item["version"] for item in history] == [1, 2]
    assert [item["id"] for item in history] == [created["id"], updated["id"]]

    with session_factory() as session:
        atoms = list_memory_atoms(session, book_id=book_id, entity_type="character", entity_id="林岚")

    assert [atom.revision for atom in atoms] == [1, 2]
    assert atoms[-1].memory_id == updated["memory_atom_id"]
    assert atoms[-1].fact_type == "rule"
    assert "突然健谈" in atoms[-1].value
    assert "STORYFORGE_LLM_API_KEY" not in atoms[-1].value


def test_character_bible_rejects_missing_book(client: TestClient) -> None:
    """Character Bible 必须绑定已存在作品。"""

    response = client.post(
        "/api/character-bible",
        json={
            "book_id": 999,
            "canonical_name": "不存在角色",
            "aliases": [],
            "voice_traits": {},
            "forbidden_traits": {},
        },
    )

    assert response.status_code == 400, response.text
    assert response.json() == {"detail": "作品不存在，无法创建 Character Bible。"}


def test_character_bible_rejects_asset_from_other_book(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """character_id 必须引用同作品角色资产。"""

    book_id = seed_book(session_factory, "目标作品")
    other_book_id = seed_book(session_factory, "其他作品")
    other_character_id = seed_character_asset(session_factory, other_book_id, "异书角色")

    response = client.post(
        "/api/character-bible",
        json={
            "book_id": book_id,
            "character_id": other_character_id,
            "canonical_name": "林岚",
            "aliases": [],
            "voice_traits": {},
            "forbidden_traits": {},
        },
    )

    assert response.status_code == 400, response.text
    assert response.json() == {"detail": "角色资产不存在或不属于当前作品。"}


def test_character_bible_rejects_non_character_asset(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """character_id 不能绑定地点或风格等非角色资产。"""

    book_id = seed_book(session_factory)
    with session_factory() as session:
        location = Asset(
            book_id=book_id,
            scene_id=None,
            asset_type="location",
            lineage_key=f"location-{book_id}",
            name="雾港",
            status="active",
            payload={},
            version=1,
        )
        session.add(location)
        session.commit()
        session.refresh(location)
        location_id = location.id

    response = client.post(
        "/api/character-bible",
        json={
            "book_id": book_id,
            "character_id": location_id,
            "canonical_name": "林岚",
            "aliases": [],
            "voice_traits": {},
            "forbidden_traits": {},
        },
    )

    assert response.status_code == 400, response.text
    assert response.json() == {"detail": "角色资产不存在或不属于当前作品。"}
