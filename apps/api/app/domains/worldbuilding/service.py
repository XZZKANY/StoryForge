from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy.orm import Session

from app.domains.assets.models import Asset
from app.domains.assets.schemas import AssetCreate, AssetUpdate
from app.domains.assets.service import create_asset, list_assets, update_asset
from app.domains.worldbuilding.schemas import WorldbuildingEntryCreate, WorldbuildingEntryUpdate

ALLOWED_ENTRY_TYPES = {"world_rule", "term", "organization", "object", "location", "subplot"}


class WorldbuildingInputError(ValueError):
    """世界观条目请求无效时抛出。"""


def create_worldbuilding_entry(session: Session, payload: WorldbuildingEntryCreate) -> Asset:
    """创建世界观条目，底层复用资产真相源。"""

    _validate_entry_type(payload.entry_type)
    return create_asset(
        session,
        AssetCreate(
            book_id=payload.book_id,
            asset_type=f"worldbuilding:{payload.entry_type}",
            name=payload.name,
            payload=payload.payload,
        ),
    )


def update_worldbuilding_entry(session: Session, asset_id: int, payload: WorldbuildingEntryUpdate) -> Asset:
    """更新世界观条目并保留资产类型和谱系。"""

    source = session.get(Asset, asset_id)
    if source is None or not source.asset_type.startswith("worldbuilding:"):
        raise WorldbuildingInputError("世界观条目不存在，无法更新。")
    changes = payload.model_dump(exclude_unset=True)
    return update_asset(session, asset_id, AssetUpdate(**changes))


def list_worldbuilding_entries(session: Session, book_id: int) -> Sequence[Asset]:
    """列出作品下所有世界观条目的最新版本。"""

    return [
        asset
        for asset in list_assets(session, book_id=book_id)
        if asset.asset_type.startswith("worldbuilding:")
    ]


def _validate_entry_type(entry_type: str) -> None:
    if entry_type not in ALLOWED_ENTRY_TYPES:
        allowed = "、".join(sorted(ALLOWED_ENTRY_TYPES))
        raise WorldbuildingInputError(f"世界观条目类型必须是：{allowed}。")
