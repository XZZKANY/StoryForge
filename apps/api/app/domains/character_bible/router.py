from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response, status

from app.db.deps import SessionDependency
from app.domains.character_bible.schemas import CharacterBibleCreate, CharacterBibleRead, CharacterBibleUpdate
from app.domains.character_bible.service import (
    CharacterBibleInputError,
    CharacterBibleNotFoundError,
    create_character_bible_entry,
    delete_character_bible_entry,
    get_character_bible_entry,
    get_character_bible_history,
    list_character_bible_entries,
    update_character_bible_entry,
)

router = APIRouter(prefix="/api/character-bible", tags=["角色规范"])


@router.post(
    "",
    response_model=CharacterBibleRead,
    status_code=status.HTTP_201_CREATED,
    summary="创建 Character Bible 条目",
)
def create_character_bible_endpoint(payload: CharacterBibleCreate, session: SessionDependency) -> CharacterBibleRead:
    """创建角色规范硬规则，供后续一致性检查读取。"""

    try:
        return create_character_bible_entry(session, payload)
    except CharacterBibleInputError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get(
    "",
    response_model=list[CharacterBibleRead],
    summary="读取作品 Character Bible 列表",
)
def list_character_bible_endpoint(
    session: SessionDependency,
    book_id: Annotated[int, Query(gt=0)],
) -> list[CharacterBibleRead]:
    """读取指定作品的角色规范列表。"""

    try:
        return list_character_bible_entries(session, book_id=book_id)
    except CharacterBibleInputError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get(
    "/{entry_id}",
    response_model=CharacterBibleRead,
    summary="读取 Character Bible 条目",
)
def get_character_bible_endpoint(entry_id: int, session: SessionDependency) -> CharacterBibleRead:
    """按主键读取角色规范。"""

    try:
        return get_character_bible_entry(session, entry_id)
    except CharacterBibleNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.patch(
    "/{entry_id}",
    response_model=CharacterBibleRead,
    summary="更新 Character Bible 条目",
)
def update_character_bible_endpoint(
    entry_id: int,
    payload: CharacterBibleUpdate,
    session: SessionDependency,
) -> CharacterBibleRead:
    """更新角色规范字段。"""

    try:
        return update_character_bible_entry(session, entry_id, payload)
    except CharacterBibleNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except CharacterBibleInputError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get(
    "/{entry_id}/history",
    response_model=list[CharacterBibleRead],
    summary="读取 Character Bible 版本历史",
)
def get_character_bible_history_endpoint(entry_id: int, session: SessionDependency) -> list[CharacterBibleRead]:
    """读取同一角色规范谱系的全部版本历史。"""

    try:
        return get_character_bible_history(session, entry_id)
    except CharacterBibleNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.delete(
    "/{entry_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除 Character Bible 条目",
)
def delete_character_bible_endpoint(entry_id: int, session: SessionDependency) -> Response:
    """删除角色规范条目。"""

    try:
        delete_character_bible_entry(session, entry_id)
    except CharacterBibleNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)
