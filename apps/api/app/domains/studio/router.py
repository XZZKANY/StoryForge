from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status

from app.db.deps import SessionDependency
from app.domains.studio.schemas import (
    StudioApprovalExecuteRead,
    StudioApprovalExecuteRequest,
    StudioApprovalSummaryRead,
    StudioBookListItem,
    StudioChapterGoalRead,
    StudioChapterReviewRunRead,
    StudioChapterReviewRunRequest,
    StudioJudgeReviewRead,
    StudioRecoverySummaryRead,
    StudioRepairPatchRead,
    StudioScenePacketRead,
)
from app.domains.studio.service import (
    StudioApprovalSummaryNotFoundError,
    StudioChapterGoalNotFoundError,
    StudioChapterReviewInputError,
    StudioJudgeReviewNotFoundError,
    StudioRecoverySummaryNotFoundError,
    StudioRepairPatchesNotFoundError,
    StudioScenePacketNotFoundError,
    approve_studio_writeback,
    list_studio_books,
    read_studio_approval_summary,
    read_studio_chapter_goal,
    read_studio_judge_review,
    read_studio_recovery_summary,
    read_studio_repair_patches,
    read_studio_scene_packet,
    run_studio_chapter_review,
)

router = APIRouter(prefix="/api/studio", tags=["Studio 创作工作台"])


@router.get(
    "/books",
    response_model=list[StudioBookListItem],
    summary="读取 Studio 作品列表",
)
def list_studio_books_endpoint(
    session: SessionDependency,
    workspace_id: Annotated[int | None, Query(gt=0)] = None,
) -> list[StudioBookListItem]:
    """读取 Studio 首个数据源：作品 ID、标题和最近章节编号。"""

    return list_studio_books(session, workspace_id=workspace_id)


@router.get(
    "/chapter-goals",
    response_model=StudioChapterGoalRead,
    summary="读取 Studio 章节目标",
)
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


@router.get(
    "/scene-packets",
    response_model=StudioScenePacketRead,
    summary="读取 Studio Scene Packet",
)
def read_studio_scene_packet_endpoint(
    session: SessionDependency,
    book_id: Annotated[int, Query(gt=0)],
    target_ordinal: Annotated[int, Query(gt=0)],
) -> StudioScenePacketRead:
    """读取 Studio Scene Packet 数据源:证据数量和上下文预算摘要。"""

    try:
        return read_studio_scene_packet(session, book_id=book_id, target_ordinal=target_ordinal)
    except StudioScenePacketNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get(
    "/judge-reviews",
    response_model=StudioJudgeReviewRead,
    summary="读取 Studio Judge 评审",
)
def read_studio_judge_review_endpoint(
    session: SessionDependency,
    scene_packet_id: Annotated[int, Query(gt=0)],
) -> StudioJudgeReviewRead:
    """读取 Studio Judge 评审数据源：状态、分数和关键问题。"""

    try:
        return read_studio_judge_review(session, scene_packet_id=scene_packet_id)
    except StudioJudgeReviewNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get(
    "/repair-patches",
    response_model=list[StudioRepairPatchRead],
    summary="读取 Studio 修复补丁",
)
def read_studio_repair_patches_endpoint(
    session: SessionDependency,
    scene_packet_id: Annotated[int, Query(gt=0)],
) -> list[StudioRepairPatchRead]:
    """读取 Studio Repair 修订数据源：补丁摘要、修订文本和重评状态。"""

    try:
        return read_studio_repair_patches(session, scene_packet_id=scene_packet_id)
    except StudioRepairPatchesNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get(
    "/approval-summary",
    response_model=StudioApprovalSummaryRead,
    summary="读取 Studio 批准摘要",
)
def read_studio_approval_summary_endpoint(
    session: SessionDependency,
    scene_packet_id: Annotated[int | None, Query(gt=0)] = None,
    repair_patch_id: Annotated[int | None, Query(gt=0)] = None,
) -> StudioApprovalSummaryRead:
    """读取 Studio 批准回写摘要：只返回资格、目标章节和阻塞原因。"""

    try:
        return read_studio_approval_summary(
            session,
            scene_packet_id=scene_packet_id,
            repair_patch_id=repair_patch_id,
        )
    except StudioApprovalSummaryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post(
    "/chapter-review",
    response_model=StudioChapterReviewRunRead,
    summary="主动执行 Studio 章节审阅",
)
def run_studio_chapter_review_endpoint(
    payload: StudioChapterReviewRunRequest,
    session: SessionDependency,
) -> StudioChapterReviewRunRead:
    """Assistant 通过 Scene Packet 主动创建 Judge 问题和 Repair 建议。"""

    try:
        return run_studio_chapter_review(session, scene_packet_id=payload.scene_packet_id)
    except StudioJudgeReviewNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except StudioChapterReviewInputError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post(
    "/approve",
    response_model=StudioApprovalExecuteRead,
    summary="执行 Studio 批准写回",
)
def approve_studio_writeback_endpoint(
    payload: StudioApprovalExecuteRequest,
    session: SessionDependency,
) -> StudioApprovalExecuteRead:
    """执行 Studio 批准写回：更新章节、场景和连续性记录。"""

    try:
        return approve_studio_writeback(session, payload)
    except StudioApprovalSummaryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get(
    "/recovery-summary",
    response_model=StudioRecoverySummaryRead,
    summary="读取 Studio 失败恢复摘要",
)
def read_studio_recovery_summary_endpoint(
    session: SessionDependency,
    job_run_id: Annotated[int, Query(gt=0)],
) -> StudioRecoverySummaryRead:
    """读取 Studio 失败恢复摘要：只返回 checkpoint、可恢复步骤和阻塞原因。"""

    try:
        return read_studio_recovery_summary(session, job_run_id=job_run_id)
    except StudioRecoverySummaryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
