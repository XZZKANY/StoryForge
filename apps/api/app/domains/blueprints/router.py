from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from app.db.deps import SessionDependency
from app.domains.blueprints.schemas import BookBlueprintCreate, BookBlueprintRead, ChapterPlanTriggerRead
from app.domains.blueprints.service import (
    BlueprintError,
    BlueprintNotFoundError,
    BlueprintPlanningBlockedError,
    create_book_blueprint,
    get_book_blueprint,
    list_book_blueprints,
    lock_book_blueprint,
    trigger_chapter_plan,
)

router = APIRouter(prefix="/api/blueprints", tags=["全书蓝图"])


@router.get(
    "",
    response_model=list[BookBlueprintRead],
    summary="列出所有 Blueprints",
)
def list_book_blueprints_endpoint(session: SessionDependency) -> list[BookBlueprintRead]:
    """列出所有 Blueprints，按创建时间倒序。"""

    return list_book_blueprints(session)


@router.post(
    "",
    response_model=BookBlueprintRead,
    status_code=status.HTTP_201_CREATED,
    summary="创建全书 Blueprint",
)
def create_book_blueprint_endpoint(payload: BookBlueprintCreate, session: SessionDependency) -> BookBlueprintRead:
    """创建 Phase 9A 最小全书蓝图，作为章节规划和 BookRun 的输入。"""

    try:
        return create_book_blueprint(session, payload)
    except BlueprintError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get(
    "/{blueprint_id}",
    response_model=BookBlueprintRead,
    summary="读取全书 Blueprint",
)
def get_book_blueprint_endpoint(blueprint_id: int, session: SessionDependency) -> BookBlueprintRead:
    """读取 Blueprint 详情，供 Web 和 Workflow 判断规划输入。"""

    try:
        return get_book_blueprint(session, blueprint_id)
    except BlueprintNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post(
    "/{blueprint_id}/lock",
    response_model=BookBlueprintRead,
    summary="锁定全书 Blueprint",
)
def lock_book_blueprint_endpoint(blueprint_id: int, session: SessionDependency) -> BookBlueprintRead:
    """锁定 Blueprint；只有 locked 状态才能进入章节规划器。"""

    try:
        return lock_book_blueprint(session, blueprint_id)
    except BlueprintNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post(
    "/{blueprint_id}/chapter-plan",
    response_model=ChapterPlanTriggerRead,
    summary="触发章节规划门禁",
)
def trigger_chapter_plan_endpoint(blueprint_id: int, session: SessionDependency) -> ChapterPlanTriggerRead:
    """校验 Blueprint 已锁定；实际章节写回由 Chapter Planner 步骤补齐。"""

    try:
        return trigger_chapter_plan(session, blueprint_id)
    except BlueprintNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except BlueprintPlanningBlockedError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
