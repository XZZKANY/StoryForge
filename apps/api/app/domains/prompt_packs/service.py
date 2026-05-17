from __future__ import annotations

from collections.abc import Sequence
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.domains.books.models import Book
from app.domains.prompt_packs.models import PromptPack
from app.domains.prompt_packs.schemas import PromptPackCreate, PromptPackUpdate
from app.domains.workspaces.models import Workspace


class PromptPackError(ValueError):
    """Prompt Pack 输入不合法或引用对象不存在。"""


def create_prompt_pack(session: Session, payload: PromptPackCreate) -> PromptPack:
    _require_scope(session, payload.workspace_id, payload.book_id)
    pack = PromptPack(
        workspace_id=payload.workspace_id,
        book_id=payload.book_id,
        pack_type=payload.pack_type,
        lineage_key=str(uuid4()),
        name=payload.name,
        status=payload.status,
        payload=payload.payload,
        version=1,
    )
    session.add(pack)
    session.commit()
    session.refresh(pack)
    return pack


def list_prompt_packs(session: Session, workspace_id: int | None = None, book_id: int | None = None) -> Sequence[PromptPack]:
    statement = (
        select(PromptPack.lineage_key, func.max(PromptPack.version).label("latest_version"))
        .group_by(PromptPack.lineage_key)
        .subquery()
    )
    query = (
        select(PromptPack)
        .join(
            statement,
            (PromptPack.lineage_key == statement.c.lineage_key) & (PromptPack.version == statement.c.latest_version),
        )
        .order_by(PromptPack.id)
    )
    if workspace_id is not None:
        query = query.where(PromptPack.workspace_id == workspace_id)
    if book_id is not None:
        query = query.where(PromptPack.book_id == book_id)
    return session.scalars(query).all()


def update_prompt_pack(session: Session, pack_id: int, payload: PromptPackUpdate) -> PromptPack:
    source = session.get(PromptPack, pack_id)
    if source is None:
        raise PromptPackError("Prompt Pack 不存在。")
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        raise PromptPackError("Prompt Pack 更新内容不能为空。")
    latest = session.scalars(
        select(PromptPack)
        .where(PromptPack.lineage_key == source.lineage_key)
        .order_by(PromptPack.version.desc(), PromptPack.id.desc())
        .limit(1)
    ).one()
    new_pack = PromptPack(
        workspace_id=latest.workspace_id,
        book_id=latest.book_id,
        pack_type=latest.pack_type,
        lineage_key=latest.lineage_key,
        name=changes.get("name", latest.name),
        status=changes.get("status", latest.status),
        payload=changes.get("payload", latest.payload),
        version=latest.version + 1,
    )
    session.add(new_pack)
    session.commit()
    session.refresh(new_pack)
    return new_pack


def get_prompt_pack_history(session: Session, pack_id: int) -> Sequence[PromptPack]:
    source = session.get(PromptPack, pack_id)
    if source is None:
        raise PromptPackError("Prompt Pack 不存在。")
    return session.scalars(
        select(PromptPack)
        .where(PromptPack.lineage_key == source.lineage_key)
        .order_by(PromptPack.version, PromptPack.id)
    ).all()


def _require_scope(session: Session, workspace_id: int | None, book_id: int | None) -> None:
    if workspace_id is not None and session.get(Workspace, workspace_id) is None:
        raise PromptPackError("工作区不存在，无法创建 Prompt Pack。")
    if book_id is not None and session.get(Book, book_id) is None:
        raise PromptPackError("作品不存在，无法创建 Prompt Pack。")

