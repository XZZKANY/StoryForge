from __future__ import annotations

from sqlalchemy import inspect
from sqlalchemy.orm import Session, sessionmaker

import app.models  # noqa: F401
from app.domains.assets.models import Asset
from app.domains.books.models import Book


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
