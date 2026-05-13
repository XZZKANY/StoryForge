from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.domains.assets.service import AssetNotFoundError, BookNotFoundError, EmptyAssetUpdateError
from app.domains.worldbuilding.schemas import (
    WorldbuildingEntryCreate,
    WorldbuildingEntryRead,
    WorldbuildingEntryUpdate,
)
from app.domains.worldbuilding.service import (
    WorldbuildingInputError,
    create_worldbuilding_entry,
    list_worldbuilding_entries,
    update_worldbuilding_entry,
)

router = APIRouter(prefix="/api/worldbuilding", tags=["世界观中心"])
SessionDependency = Annotated[Session, Depends(get_session)]


@router.post("/entries", response_model=WorldbuildingEntryRead, status_code=status.HTTP_201_CREATED)
def create_worldbuilding_entry_endpoint(
    payload: WorldbuildingEntryCreate,
    session: SessionDependency,
) -> WorldbuildingEntryRead:
    """创建世界观中心条目。"""

    try:
        return create_worldbuilding_entry(session, payload)
    except (BookNotFoundError, WorldbuildingInputError) as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.patch("/entries/{asset_id}", response_model=WorldbuildingEntryRead)
def update_worldbuilding_entry_endpoint(
    asset_id: int,
    payload: WorldbuildingEntryUpdate,
    session: SessionDependency,
) -> WorldbuildingEntryRead:
    """更新世界观条目并创建新版本。"""

    try:
        return update_worldbuilding_entry(session, asset_id, payload)
    except (AssetNotFoundError, WorldbuildingInputError) as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except EmptyAssetUpdateError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/entries", response_model=list[WorldbuildingEntryRead])
def list_worldbuilding_entries_endpoint(
    session: SessionDependency,
    book_id: Annotated[int, Query(gt=0)],
) -> list[WorldbuildingEntryRead]:
    """列出指定作品下世界观条目的最新版本。"""

    return list(list_worldbuilding_entries(session, book_id=book_id))
