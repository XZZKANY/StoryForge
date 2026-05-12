from __future__ import annotations

from collections.abc import Sequence
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.domains.assets.models import Asset
from app.domains.assets.schemas import AssetCreate, AssetUpdate
from app.domains.books.models import Book, Chapter, Scene


class AssetNotFoundError(ValueError):
    """资产不存在时由服务层抛出，路由层负责转换为 HTTP 响应。"""


class BookNotFoundError(ValueError):
    """作品不存在时由服务层抛出，避免产生孤立资产。"""


class EmptyAssetUpdateError(ValueError):
    """空更新无法形成有意义的新版本。"""


def create_asset(session: Session, payload: AssetCreate) -> Asset:
    """创建资产首个版本，并为后续版本历史分配稳定谱系键。"""

    if session.get(Book, payload.book_id) is None:
        raise BookNotFoundError("作品不存在，无法创建资产。")

    if payload.scene_id is not None:
        scene_id = session.scalar(
            select(Scene.id)
            .join(Chapter, Scene.chapter_id == Chapter.id)
            .where(Scene.id == payload.scene_id, Chapter.book_id == payload.book_id)
        )
        if scene_id is None:
            raise BookNotFoundError("场景不存在或不属于该作品，无法创建资产。")

    asset = Asset(
        book_id=payload.book_id,
        scene_id=payload.scene_id,
        asset_type=payload.asset_type,
        lineage_key=str(uuid4()),
        name=payload.name,
        status=payload.status,
        payload=payload.payload,
        version=1,
    )
    session.add(asset)
    session.commit()
    session.refresh(asset)
    return asset


def list_assets(session: Session, book_id: int, asset_type: str | None = None) -> Sequence[Asset]:
    """列出作品下每条资产谱系的最新版本。"""

    latest_versions = (
        select(Asset.lineage_key, func.max(Asset.version).label("latest_version"))
        .where(Asset.book_id == book_id)
        .group_by(Asset.lineage_key)
        .subquery()
    )
    statement = (
        select(Asset)
        .join(
            latest_versions,
            (Asset.lineage_key == latest_versions.c.lineage_key)
            & (Asset.version == latest_versions.c.latest_version),
        )
        .where(Asset.book_id == book_id)
        .order_by(Asset.id)
    )
    if asset_type is not None:
        statement = statement.where(Asset.asset_type == asset_type)
    return session.scalars(statement).all()


def update_asset(session: Session, asset_id: int, payload: AssetUpdate) -> Asset:
    """复制上一版本并插入新版本，保证历史记录不可被覆盖。"""

    source_asset = session.get(Asset, asset_id)
    if source_asset is None:
        raise AssetNotFoundError("资产不存在，无法更新版本。")

    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        raise EmptyAssetUpdateError("资产更新内容不能为空。")

    latest_asset = session.scalars(
        select(Asset)
        .where(Asset.lineage_key == source_asset.lineage_key)
        .order_by(Asset.version.desc(), Asset.id.desc())
        .limit(1)
    ).one()
    next_version = latest_asset.version + 1

    new_asset = Asset(
        book_id=latest_asset.book_id,
        scene_id=changes.get("scene_id", latest_asset.scene_id),
        asset_type=changes.get("asset_type", latest_asset.asset_type),
        lineage_key=latest_asset.lineage_key,
        name=changes.get("name", latest_asset.name),
        status=changes.get("status", latest_asset.status),
        payload=changes.get("payload", latest_asset.payload),
        version=next_version,
    )
    session.add(new_asset)
    session.commit()
    session.refresh(new_asset)
    return new_asset


def get_asset_history(session: Session, asset_id: int) -> Sequence[Asset]:
    """按版本升序读取同一谱系的完整资产历史。"""

    asset = session.get(Asset, asset_id)
    if asset is None:
        raise AssetNotFoundError("资产不存在，无法读取历史。")

    statement = (
        select(Asset)
        .where(Asset.lineage_key == asset.lineage_key)
        .order_by(Asset.version, Asset.id)
    )
    return session.scalars(statement).all()
