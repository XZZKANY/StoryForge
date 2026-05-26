from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status

from app.common.pagination import MAX_PAGE_LIMIT, paginate_by_id
from app.db.deps import SessionDependency
from app.domains.assets.models import Asset
from app.domains.assets.schemas import AssetCreate, AssetListPage, AssetRead, AssetUpdate
from app.domains.assets.service import (
    AssetNotFoundError,
    BookNotFoundError,
    EmptyAssetUpdateError,
    build_asset_list_query,
    create_asset,
    get_asset_history,
    list_assets,
    update_asset,
)

router = APIRouter(prefix="/api/assets", tags=["资产中心"])


@router.post(
    "",
    response_model=AssetRead,
    status_code=status.HTTP_201_CREATED,
    summary="创建资产",
)
def create_asset_endpoint(payload: AssetCreate, session: SessionDependency) -> AssetRead:
    """创建角色、地点、风格规则等资产的首个版本。"""

    try:
        return create_asset(session, payload)
    except BookNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get(
    "",
    response_model=list[AssetRead] | AssetListPage,
    summary="读取资产列表",
)
def list_assets_endpoint(
    session: SessionDependency,
    book_id: Annotated[int, Query(gt=0)],
    asset_type: Annotated[str | None, Query(min_length=1, max_length=80)] = None,
    cursor: Annotated[str | None, Query(max_length=64)] = None,
    limit: Annotated[int | None, Query(ge=1, le=MAX_PAGE_LIMIT)] = None,
) -> list[AssetRead] | AssetListPage:
    """查询指定作品下每条资产谱系的最新版本列表。"""

    if limit is None and cursor is None:
        return list(list_assets(session, book_id=book_id, asset_type=asset_type))
    query = build_asset_list_query(book_id=book_id, asset_type=asset_type)
    page = paginate_by_id(session, query, id_column=Asset.id, cursor=cursor, limit=limit)
    return AssetListPage(
        items=[AssetRead.model_validate(item) for item in page.items],
        next_cursor=page.next_cursor,
        has_more=page.has_more,
    )


@router.patch(
    "/{asset_id}",
    response_model=AssetRead,
    summary="更新资产并创建新版本",
)
def update_asset_endpoint(asset_id: int, payload: AssetUpdate, session: SessionDependency) -> AssetRead:
    """更新资产并创建新版本，旧版本保留在历史中。"""

    try:
        return update_asset(session, asset_id, payload)
    except AssetNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except EmptyAssetUpdateError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get(
    "/{asset_id}/history",
    response_model=list[AssetRead],
    summary="读取资产版本历史",
)
def read_asset_history_endpoint(asset_id: int, session: SessionDependency) -> list[AssetRead]:
    """读取资产同一谱系的全部版本历史。"""

    try:
        return list(get_asset_history(session, asset_id))
    except AssetNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
