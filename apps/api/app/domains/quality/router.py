from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.domains.quality.schemas import QualityDashboardQuery, QualityDashboardRead
from app.domains.quality.service import QualityDashboardInputError, build_quality_dashboard

router = APIRouter(prefix="/api/quality", tags=["质量看板"])
SessionDependency = Annotated[Session, Depends(get_session)]


@router.get("/dashboard", response_model=QualityDashboardRead)
def read_quality_dashboard(
    session: SessionDependency,
    book_id: Annotated[int | None, Query(gt=0)] = None,
    series_id: Annotated[int | None, Query(gt=0)] = None,
) -> QualityDashboardRead:
    """读取指定作品或系列范围下的质量看板。"""

    try:
        query = QualityDashboardQuery(book_id=book_id, series_id=series_id)
        return build_quality_dashboard(session, query)
    except ValueError as exc:
        status_code = status.HTTP_404_NOT_FOUND if isinstance(exc, QualityDashboardInputError) else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc
