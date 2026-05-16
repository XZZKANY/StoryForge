from __future__ import annotations

from collections.abc import Sequence
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.domains.assets.models import Asset
from app.domains.books.models import Book, Chapter, Scene
from app.domains.style_packs.schemas import StylePackApplyCreate, StylePackCreate, StylePackUpdate


class StylePackNotFoundError(ValueError):
    """风格包不存在或类型不匹配时抛出。"""


class StylePackInputError(ValueError):
    """风格包创建、更新或应用的输入不合法时抛出。"""


class StylePackBookNotFoundError(ValueError):
    """目标作品不存在时抛出。"""


STYLE_RULE_KEYS = ("规则", "禁用表达", "示例句")


def create_style_pack(session: Session, payload: StylePackCreate) -> Asset:
    """创建 style_pack 资产首版本。"""

    if session.get(Book, payload.book_id) is None:
        raise StylePackBookNotFoundError("作品不存在，无法创建风格包。")
    style_pack = Asset(
        book_id=payload.book_id,
        scene_id=None,
        asset_type="style_pack",
        lineage_key=str(uuid4()),
        name=payload.name,
        status=payload.status,
        payload=payload.payload,
        version=1,
    )
    session.add(style_pack)
    session.commit()
    session.refresh(style_pack)
    return style_pack


def list_style_packs(session: Session, book_id: int) -> Sequence[Asset]:
    """列出作品下每条风格包谱系的最新版本。"""

    latest_versions = (
        select(Asset.lineage_key, func.max(Asset.version).label("latest_version"))
        .where(Asset.book_id == book_id, Asset.asset_type == "style_pack")
        .group_by(Asset.lineage_key)
        .subquery()
    )
    return session.scalars(
        select(Asset)
        .join(
            latest_versions,
            (Asset.lineage_key == latest_versions.c.lineage_key) & (Asset.version == latest_versions.c.latest_version),
        )
        .where(Asset.book_id == book_id, Asset.asset_type == "style_pack")
        .order_by(Asset.id)
    ).all()


def update_style_pack(session: Session, asset_id: int, payload: StylePackUpdate) -> Asset:
    """复制上一版本并插入新的 style_pack 版本。"""

    source = _get_style_pack(session, asset_id)
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        raise StylePackInputError("风格包更新内容不能为空。")
    latest = session.scalars(
        select(Asset)
        .where(Asset.lineage_key == source.lineage_key)
        .order_by(Asset.version.desc(), Asset.id.desc())
        .limit(1)
    ).one()
    new_pack = Asset(
        book_id=latest.book_id,
        scene_id=None,
        asset_type="style_pack",
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


def apply_style_pack(session: Session, asset_id: int, payload: StylePackApplyCreate) -> Asset:
    """把风格包应用到作品，生成 style_rule 资产。"""

    style_pack = _get_latest_style_pack(session, asset_id)
    if session.get(Book, payload.book_id) is None:
        raise StylePackBookNotFoundError("目标作品不存在，无法应用风格包。")
    if payload.scene_id is not None:
        scene_id = session.scalar(
            select(Scene.id)
            .join(Chapter, Scene.chapter_id == Chapter.id)
            .where(Scene.id == payload.scene_id, Chapter.book_id == payload.book_id)
        )
        if scene_id is None:
            raise StylePackInputError("场景不存在或不属于该作品，无法应用风格包。")

    style_payload = {key: style_pack.payload.get(key) for key in STYLE_RULE_KEYS if key in style_pack.payload}
    style_payload["style_pack_id"] = asset_id
    style_payload["style_pack_lineage_key"] = style_pack.lineage_key
    applied_asset = Asset(
        book_id=payload.book_id,
        scene_id=payload.scene_id,
        asset_type="style_rule",
        lineage_key=str(uuid4()),
        name=payload.name or f"{style_pack.name} 应用规则",
        status=payload.status,
        payload=style_payload,
        version=1,
    )
    session.add(applied_asset)
    session.commit()
    session.refresh(applied_asset)
    return applied_asset


def _get_style_pack(session: Session, asset_id: int) -> Asset:
    asset = session.get(Asset, asset_id)
    if asset is None or asset.asset_type != "style_pack":
        raise StylePackNotFoundError("风格包不存在。")
    return asset


def _get_latest_style_pack(session: Session, asset_id: int) -> Asset:
    """根据任一版本 id 读取该风格包谱系的最新版本。"""

    source = _get_style_pack(session, asset_id)
    return session.scalars(
        select(Asset)
        .where(Asset.lineage_key == source.lineage_key, Asset.asset_type == "style_pack")
        .order_by(Asset.version.desc(), Asset.id.desc())
        .limit(1)
    ).one()
