from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.domains.studio.schemas import StudioBookListItem, StudioChapterGoalRead, StudioJudgeReviewRead, StudioScenePacketRead
from app.domains.studio.service import (
    StudioChapterGoalNotFoundError,
    StudioJudgeReviewNotFoundError,
    StudioScenePacketNotFoundError,
    list_studio_books,
    read_studio_chapter_goal,
    read_studio_judge_review,
    read_studio_scene_packet,
)

router = APIRouter(prefix="/api/studio", tags=["Studio 创作工作台"])
SessionDependency = Annotated[Session, Depends(get_session)]


@router.get("/books", response_model=list[StudioBookListItem])
def list_studio_books_endpoint(
    session: SessionDependency,
    workspace_id: Annotated[int | None, Query(gt=0)] = None,
) -> list[StudioBookListItem]:
    """读取 Studio 首个数据源：作品 ID、标题和最近章节编号。"""

    return list_studio_books(session, workspace_id=workspace_id)


@router.get("/chapter-goals", response_model=StudioChapterGoalRead)
def read_studio_chapter_goal_endpoint(
    session: SessionDependency,
    book_id: Annotated[int, Query(gt=0)],
    target_ordinal: Annotated[int, Query(gt=0)],
) -> StudioChapterGoalRead:
    """读取 Studio 章节目标数据源：目标、上章摘要和连续性约束。"""

    try:
        return read_studio_chapter_goal(session, book_id=book_id, target_ordinal=target_ordinal)
    except StudioChapterGoalNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/scene-packets", response_model=StudioScenePacketRead)
def read_studio_scene_packet_endpoint(
    session: SessionDependency,
    book_id: Annotated[int, Query(gt=0)],
    target_ordinal: Annotated[int, Query(gt=0)],
) -> StudioScenePacketRead:
    """读取 Studio Scene Packet 数据源：证据数量和上下文预算摘要。"""

    try:
        return read_studio_scene_packet(session, book_id=book_id, target_ordinal=target_ordinal)
    except StudioScenePacketNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/judge-reviews", response_model=StudioJudgeReviewRead)
def read_studio_judge_review_endpoint(
    session: SessionDependency,
    scene_packet_id: Annotated[int, Query(gt=0)],
) -> StudioJudgeReviewRead:
    """读取 Studio Judge 评审数据源：状态、分数和关键问题。"""

    try:
        return read_studio_judge_review(session, scene_packet_id=scene_packet_id)
    except StudioJudgeReviewNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
