from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.common.exceptions import InputError, NotFoundError
from app.domains.assets.models import Asset
from app.domains.books.models import Book
from app.domains.character_bible.models import CharacterBibleEntry
from app.domains.character_bible.schemas import CharacterBibleCreate, CharacterBibleUpdate


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
        canonical_name=payload.canonical_name,
        aliases=payload.aliases,
        voice_traits=payload.voice_traits,
        forbidden_traits=payload.forbidden_traits,
    )
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return entry


def list_character_bible_entries(session: Session, *, book_id: int) -> list[CharacterBibleEntry]:
    """按作品读取角色规范，供后续 Judge 一致性检查使用。"""

    _ensure_book_exists(session, book_id)
    statement = (
        select(CharacterBibleEntry)
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
    """更新角色规范的可变字段。"""

    entry = get_character_bible_entry(session, entry_id)
    changes = payload.model_dump(exclude_unset=True)
    if "character_id" in changes:
        _ensure_character_asset(session, entry.book_id, changes["character_id"])
    for key, value in changes.items():
        setattr(entry, key, value)
    session.commit()
    session.refresh(entry)
    return entry


def delete_character_bible_entry(session: Session, entry_id: int) -> None:
    """删除角色规范；后续审计页若需要历史再引入版本表。"""

    entry = get_character_bible_entry(session, entry_id)
    session.delete(entry)
    session.commit()


def _ensure_book_exists(session: Session, book_id: int) -> None:
    if session.get(Book, book_id) is None:
        raise CharacterBibleInputError("作品不存在，无法创建 Character Bible。")


def _ensure_character_asset(session: Session, book_id: int, character_id: int | None) -> None:
    if character_id is None:
        return
    asset = session.get(Asset, character_id)
    if asset is None or asset.book_id != book_id or asset.asset_type != "character":
        raise CharacterBibleInputError("角色资产不存在或不属于当前作品。")
