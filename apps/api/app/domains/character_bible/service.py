from __future__ import annotations

import json
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.common.exceptions import InputError, NotFoundError
from app.db.queries import latest_by_lineage
from app.domains.assets.models import Asset
from app.domains.books.models import Book
from app.domains.character_bible.models import CharacterBibleEntry
from app.domains.character_bible.schemas import CharacterBibleCreate, CharacterBibleUpdate
from app.domains.story_memory.schemas import MemoryAtom
from app.domains.story_memory.service import create_memory_atom


class CharacterBibleInputError(InputError):
    """角色规范输入不满足作品或角色归属约束。"""


class CharacterBibleNotFoundError(NotFoundError):
    """角色规范不存在时由路由层转换为 404。"""


def create_character_bible_entry(session: Session, payload: CharacterBibleCreate) -> CharacterBibleEntry:
    """创建角色规范，确保作品和可选角色资产归属有效。"""

    _ensure_book_exists(session, payload.book_id)
    _ensure_character_asset(session, payload.book_id, payload.character_id)
    entry = CharacterBibleEntry(
        book_id=payload.book_id,
        character_id=payload.character_id,
        lineage_key=str(uuid4()),
        canonical_name=payload.canonical_name,
        aliases=payload.aliases,
        voice_traits=payload.voice_traits,
        forbidden_traits=payload.forbidden_traits,
        version=1,
        sync_status="pending",
    )
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return _sync_character_bible_memory(session, entry)


def list_character_bible_entries(session: Session, *, book_id: int) -> list[CharacterBibleEntry]:
    """按作品读取角色规范，供后续 Judge 一致性检查使用。"""

    _ensure_book_exists(session, book_id)
    latest_versions = latest_by_lineage(CharacterBibleEntry, filters=[CharacterBibleEntry.book_id == book_id])
    statement = (
        select(CharacterBibleEntry)
        .join(
            latest_versions,
            (CharacterBibleEntry.lineage_key == latest_versions.c.lineage_key)
            & (CharacterBibleEntry.version == latest_versions.c.latest_version),
        )
        .where(CharacterBibleEntry.book_id == book_id)
        .order_by(CharacterBibleEntry.canonical_name, CharacterBibleEntry.id)
    )
    return list(session.scalars(statement).all())


def get_character_bible_entry(session: Session, entry_id: int) -> CharacterBibleEntry:
    """按主键读取角色规范。"""

    entry = session.get(CharacterBibleEntry, entry_id)
    if entry is None:
        raise CharacterBibleNotFoundError("Character Bible 不存在。")
    return entry


def update_character_bible_entry(session: Session, entry_id: int, payload: CharacterBibleUpdate) -> CharacterBibleEntry:
    """复制最新角色规范并插入新版本，保留历史不可覆盖。"""

    source = get_character_bible_entry(session, entry_id)
    changes = payload.model_dump(exclude_unset=True)
    if "character_id" in changes:
        _ensure_character_asset(session, source.book_id, changes["character_id"])
    latest = session.scalars(
        select(CharacterBibleEntry)
        .where(CharacterBibleEntry.lineage_key == source.lineage_key)
        .order_by(CharacterBibleEntry.version.desc(), CharacterBibleEntry.id.desc())
        .limit(1)
    ).one()
    entry = CharacterBibleEntry(
        book_id=latest.book_id,
        character_id=changes.get("character_id", latest.character_id),
        lineage_key=latest.lineage_key,
        canonical_name=changes.get("canonical_name", latest.canonical_name),
        aliases=changes.get("aliases", latest.aliases),
        voice_traits=changes.get("voice_traits", latest.voice_traits),
        forbidden_traits=changes.get("forbidden_traits", latest.forbidden_traits),
        version=latest.version + 1,
        sync_status="pending",
    )
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return _sync_character_bible_memory(session, entry)


def get_character_bible_history(session: Session, entry_id: int) -> list[CharacterBibleEntry]:
    """按版本升序读取同一角色规范谱系。"""

    entry = get_character_bible_entry(session, entry_id)
    statement = (
        select(CharacterBibleEntry)
        .where(CharacterBibleEntry.lineage_key == entry.lineage_key)
        .order_by(CharacterBibleEntry.version, CharacterBibleEntry.id)
    )
    return list(session.scalars(statement).all())


def delete_character_bible_entry(session: Session, entry_id: int) -> None:
    """删除角色规范；后续审计页若需要历史再引入版本表。"""

    entry = get_character_bible_entry(session, entry_id)
    entries = session.scalars(
        select(CharacterBibleEntry).where(CharacterBibleEntry.lineage_key == entry.lineage_key)
    ).all()
    for version in entries:
        session.delete(version)
    session.commit()


def _sync_character_bible_memory(session: Session, entry: CharacterBibleEntry) -> CharacterBibleEntry:
    """把角色规范版本同步为 Story Memory 角色规则事实。"""

    atom = create_memory_atom(
        session,
        MemoryAtom(
            memory_id=f"character_bible:{entry.lineage_key}:{entry.version}",
            novel_id=entry.book_id,
            entity_type="character",
            entity_id=entry.canonical_name,
            fact_type="rule",
            value=_character_bible_memory_value(entry),
            source_ref=f"character_bible:{entry.id}:v{entry.version}",
            immutable=True,
            revision=entry.version,
        ),
    )
    entry.memory_atom_id = atom.memory_id
    entry.sync_status = "synced"
    session.commit()
    session.refresh(entry)
    return entry


def _character_bible_memory_value(entry: CharacterBibleEntry) -> str:
    """生成可审计的角色规则摘要，避免把无关运行配置写入记忆。"""

    return json.dumps(
        {
            "kind": "character_bible",
            "canonical_name": entry.canonical_name,
            "aliases": entry.aliases,
            "voice_traits": entry.voice_traits,
            "forbidden_traits": entry.forbidden_traits,
            "version": entry.version,
        },
        ensure_ascii=False,
        sort_keys=True,
    )


def _ensure_book_exists(session: Session, book_id: int) -> None:
    if session.get(Book, book_id) is None:
        raise CharacterBibleInputError("作品不存在，无法创建 Character Bible。")


def _ensure_character_asset(session: Session, book_id: int, character_id: int | None) -> None:
    if character_id is None:
        return
    asset = session.get(Asset, character_id)
    if asset is None or asset.book_id != book_id or asset.asset_type != "character":
        raise CharacterBibleInputError("角色资产不存在或不属于当前作品。")
