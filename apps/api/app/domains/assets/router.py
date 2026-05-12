from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.domains.assets.schemas import AssetCreate, AssetRead, AssetUpdate
from app.domains.assets.service import (
    AssetNotFoundError,
    BookNotFoundError,
    EmptyAssetUpdateError,
    create_asset,
    get_asset_history,
    list_assets,
    update_asset,
)

router = APIRouter(prefix="/api/assets", tags=["资产中心"])
SessionDependency = Annotated[Session, Depends(get_session)]


@router.post("", response_model=AssetRead, status_code=status.HTTP_201_CREATED)
def create_asset_endpoint(payload: AssetCreate, session: SessionDependency) -> AssetRead:
    """创建角色、地点、风格规则等资产的首个版本。"""

    try:
        return create_asset(session, payload)
    except BookNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("", response_model=list[AssetRead])
def list_assets_endpoint(
    session: SessionDependency,
    book_id: Annotated[int, Query(gt=0)],
    asset_type: Annotated[str | None, Query(min_length=1, max_length=80)] = None,
) -> list[AssetRead]:
    """查询指定作品下每条资产谱系的最新版本列表。"""

    return list(list_assets(session, book_id=book_id, asset_type=asset_type))


@router.patch("/{asset_id}", response_model=AssetRead)
def update_asset_endpoint(asset_id: int, payload: AssetUpdate, session: SessionDependency) -> AssetRead:
    """更新资产并创建新版本，旧版本保留在历史中。"""

    try:
        return update_asset(session, asset_id, payload)
    except AssetNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except EmptyAssetUpdateError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/{asset_id}/history", response_model=list[AssetRead])
def read_asset_history_endpoint(asset_id: int, session: SessionDependency) -> list[AssetRead]:
    """读取资产同一谱系的全部版本历史。"""

    try:
        return list(get_asset_history(session, asset_id))
    except AssetNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
