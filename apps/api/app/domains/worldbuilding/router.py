from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.domains.worldbuilding.schemas import WorldbuildingCenterRead
from app.domains.worldbuilding.service import WorldbuildingNotFoundError, build_worldbuilding_center

router = APIRouter(prefix="/api/worldbuilding", tags=["世界观中心"])
SessionDependency = Annotated[Session, Depends(get_session)]


@router.get("/center", response_model=WorldbuildingCenterRead)
def read_worldbuilding_center_endpoint(
    session: SessionDependency,
    series_id: Annotated[int, Query(gt=0)],
    book_id: Annotated[int | None, Query(gt=0)] = None,
) -> WorldbuildingCenterRead:
    """读取系列与作品范围下的世界观中心聚合结果。"""

    try:
        return build_worldbuilding_center(session, series_id=series_id, book_id=book_id)
    except WorldbuildingNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
