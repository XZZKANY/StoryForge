from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status

from app.db.deps import SessionDependency
from app.domains.timeline.schemas import TimelineEventCreate, TimelineEventRead
from app.domains.timeline.service import TimelineEventError, create_timeline_event, list_timeline_events

router = APIRouter(prefix="/api/timeline-events", tags=["时间线事件"])


@router.post(
    "",
    response_model=TimelineEventRead,
    status_code=status.HTTP_201_CREATED,
    summary="创建时间线事件",
)
def create_timeline_event_endpoint(
    payload: TimelineEventCreate,
    session: SessionDependency,
) -> TimelineEventRead:
    """创建可排序、可追溯的作品时间线事件。"""

    try:
        return create_timeline_event(session, payload)
    except TimelineEventError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get(
    "",
    response_model=list[TimelineEventRead],
    summary="读取时间线事件列表",
)
def list_timeline_events_endpoint(
    session: SessionDependency,
    project_id: Annotated[int | None, Query(gt=0)] = None,
    book_id: Annotated[int | None, Query(gt=0)] = None,
    volume_id: Annotated[int | None, Query(gt=0)] = None,
    chapter_id: Annotated[int | None, Query(gt=0)] = None,
) -> list[TimelineEventRead]:
    """按项目、作品、卷或章节过滤时间线事件。"""

    return list(
        list_timeline_events(
            session,
            project_id=project_id,
            book_id=book_id,
            volume_id=volume_id,
            chapter_id=chapter_id,
        )
    )
