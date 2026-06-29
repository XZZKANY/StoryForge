from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.common.exceptions import NotFoundError
from app.domains.book_runs.book_context import clear_book_context_cache
from app.domains.books.models import Chapter, Scene
from app.domains.continuity.models import ContinuityRecord, ScenePacket
from app.domains.judge.models import JudgeIssue, RepairPatch
from app.domains.studio.schemas import (
    StudioApprovalExecuteRead,
    StudioApprovalExecuteRequest,
    StudioApprovalObjectRead,
    StudioApprovalSummaryRead,
    StudioApprovalTargetChapterRead,
)


class StudioApprovalSummaryNotFoundError(NotFoundError):
    """批准摘要目标不存在时由路由层转换为可重试的 HTTP 响应。"""


def read_studio_approval_summary(
    session: Session,
    *,
    scene_packet_id: int | None = None,
    repair_patch_id: int | None = None,
) -> StudioApprovalSummaryRead:
    """读取批准回写资格摘要，不执行审批或章节写回。"""

    if scene_packet_id is None and repair_patch_id is None:
        return _unavailable_approval_summary("需要提供 Scene Packet ID 或 Repair Patch ID。")
    if scene_packet_id is not None and repair_patch_id is not None:
        return _unavailable_approval_summary("Scene Packet ID 与 Repair Patch ID 只能提供一个。")

    if repair_patch_id is not None:
        return _approval_summary_from_repair_patch(session, repair_patch_id=repair_patch_id)
    assert scene_packet_id is not None
    return _approval_summary_from_scene_packet(session, scene_packet_id=scene_packet_id)


def approve_studio_writeback(session: Session, payload: StudioApprovalExecuteRequest) -> StudioApprovalExecuteRead:
    """执行 Studio 批准写回，真实更新章节、场景和连续性记录。"""

    if payload.scene_packet_id is None and payload.repair_patch_id is None:
        return _unavailable_approval_execution("需要提供 Scene Packet ID 或 Repair Patch ID。")
    if payload.scene_packet_id is not None and payload.repair_patch_id is not None:
        return _unavailable_approval_execution("Scene Packet ID 与 Repair Patch ID 只能提供一个。")
    if payload.repair_patch_id is not None:
        return _approve_repair_patch(session, repair_patch_id=payload.repair_patch_id)
    assert payload.scene_packet_id is not None
    return _approve_scene_packet(session, scene_packet_id=payload.scene_packet_id)


def _approve_scene_packet(session: Session, *, scene_packet_id: int) -> StudioApprovalExecuteRead:
    row = session.execute(
        select(ScenePacket, Scene, Chapter)
        .join(Scene, ScenePacket.scene_id == Scene.id)
        .join(Chapter, Scene.chapter_id == Chapter.id)
        .where(ScenePacket.id == scene_packet_id)
        .limit(1)
    ).first()
    if row is None:
        raise StudioApprovalSummaryNotFoundError("Scene Packet 不存在，无法执行批准写回。")

    scene_packet, scene, chapter = row
    unavailable_reason = _scene_packet_unavailable_reason(scene_packet, chapter)
    if unavailable_reason is not None:
        return _approval_execution(
            object_type="scene_packet",
            object_id=scene_packet.id,
            object_status=scene_packet.status,
            scene_id=scene.id,
            chapter=chapter,
            writeback_status="未执行",
            approved_chapter_id=None,
            continuity_update_summary=None,
            unavailable_reason=unavailable_reason,
        )

    scene.status = "approved"
    chapter.status = "approved"
    scene_packet.status = "approved"
    continuity_summary = _record_chapter_approval(session, chapter=chapter, scene=scene, source_type="scene_packet", source_id=scene_packet.id)
    session.commit()
    clear_book_context_cache(chapter.book_id)
    return _approval_execution(
        object_type="scene_packet",
        object_id=scene_packet.id,
        object_status=scene_packet.status,
        scene_id=scene.id,
        chapter=chapter,
        writeback_status="已回写",
        approved_chapter_id=chapter.id,
        continuity_update_summary=continuity_summary,
        unavailable_reason=None,
    )


def _approve_repair_patch(session: Session, *, repair_patch_id: int) -> StudioApprovalExecuteRead:
    row = session.execute(
        select(RepairPatch, JudgeIssue, Scene, Chapter)
        .join(JudgeIssue, RepairPatch.judge_issue_id == JudgeIssue.id)
        .join(Scene, RepairPatch.scene_id == Scene.id)
        .join(Chapter, Scene.chapter_id == Chapter.id)
        .where(RepairPatch.id == repair_patch_id)
        .limit(1)
    ).first()
    if row is None:
        raise StudioApprovalSummaryNotFoundError("Repair Patch 不存在，无法执行批准写回。")

    repair_patch, issue, scene, chapter = row
    unavailable_reason = _repair_patch_unavailable_reason(repair_patch, chapter)
    if unavailable_reason is not None:
        return _approval_execution(
            object_type="repair_patch",
            object_id=repair_patch.id,
            object_status=repair_patch.status,
            scene_id=scene.id,
            chapter=chapter,
            writeback_status="未执行",
            approved_chapter_id=None,
            continuity_update_summary=None,
            unavailable_reason=unavailable_reason,
        )

    scene.content = _apply_repair_patch(scene.content or "", repair_patch.patch or {})
    scene.status = "approved"
    chapter.status = "approved"
    repair_patch.status = "accepted"
    issue.status = "closed"
    continuity_summary = _record_chapter_approval(session, chapter=chapter, scene=scene, source_type="repair_patch", source_id=repair_patch.id)
    session.commit()
    clear_book_context_cache(chapter.book_id)
    return _approval_execution(
        object_type="repair_patch",
        object_id=repair_patch.id,
        object_status=repair_patch.status,
        scene_id=scene.id,
        chapter=chapter,
        writeback_status="已回写",
        approved_chapter_id=chapter.id,
        continuity_update_summary=continuity_summary,
        unavailable_reason=None,
    )


def _approval_summary_from_scene_packet(session: Session, *, scene_packet_id: int) -> StudioApprovalSummaryRead:
    row = session.execute(
        select(ScenePacket, Scene, Chapter)
        .join(Scene, ScenePacket.scene_id == Scene.id)
        .join(Chapter, Scene.chapter_id == Chapter.id)
        .where(ScenePacket.id == scene_packet_id)
        .limit(1)
    ).first()
    if row is None:
        raise StudioApprovalSummaryNotFoundError("Scene Packet 不存在，无法读取批准回写摘要。")

    scene_packet, scene, chapter = row
    unavailable_reason = _scene_packet_unavailable_reason(scene_packet, chapter)
    return _approval_summary(
        object_type="scene_packet",
        object_id=scene_packet.id,
        object_status=scene_packet.status,
        scene_id=scene.id,
        chapter=chapter,
        unavailable_reason=unavailable_reason,
    )


def _approval_summary_from_repair_patch(session: Session, *, repair_patch_id: int) -> StudioApprovalSummaryRead:
    row = session.execute(
        select(RepairPatch, Scene, Chapter)
        .join(Scene, RepairPatch.scene_id == Scene.id)
        .join(Chapter, Scene.chapter_id == Chapter.id)
        .where(RepairPatch.id == repair_patch_id)
        .limit(1)
    ).first()
    if row is None:
        raise StudioApprovalSummaryNotFoundError("Repair Patch 不存在，无法读取批准回写摘要。")

    repair_patch, scene, chapter = row
    unavailable_reason = _repair_patch_unavailable_reason(repair_patch, chapter)
    return _approval_summary(
        object_type="repair_patch",
        object_id=repair_patch.id,
        object_status=repair_patch.status,
        scene_id=scene.id,
        chapter=chapter,
        unavailable_reason=unavailable_reason,
    )


def _approval_summary(
    *,
    object_type: str,
    object_id: int,
    object_status: str,
    scene_id: int,
    chapter: Chapter,
    unavailable_reason: str | None,
) -> StudioApprovalSummaryRead:
    writeback_status = "已回写" if chapter.status == "approved" else "未回写"
    if unavailable_reason is None and writeback_status == "已回写":
        unavailable_reason = "目标章节已处于批准状态，无需重复回写。"

    return StudioApprovalSummaryRead(
        can_approve=unavailable_reason is None,
        approvable_object=StudioApprovalObjectRead(
            object_type=object_type,
            id=object_id,
            status=object_status,
            scene_id=scene_id,
        ),
        target_chapter=StudioApprovalTargetChapterRead(
            id=chapter.id,
            ordinal=chapter.ordinal,
            title=chapter.title,
            status=chapter.status,
        ),
        writeback_status=writeback_status,
        unavailable_reason=unavailable_reason,
    )


def _unavailable_approval_summary(reason: str) -> StudioApprovalSummaryRead:
    return StudioApprovalSummaryRead(
        can_approve=False,
        approvable_object=None,
        target_chapter=None,
        writeback_status="不可判定",
        unavailable_reason=reason,
    )


def _scene_packet_unavailable_reason(scene_packet: ScenePacket, chapter: Chapter) -> str | None:
    if chapter.status == "approved":
        return "目标章节已处于批准状态，无需重复回写。"
    if scene_packet.status != "assembled":
        return "Scene Packet 尚未完成组装，暂不可批准。"
    return None


def _repair_patch_unavailable_reason(repair_patch: RepairPatch, chapter: Chapter) -> str | None:
    if chapter.status == "approved":
        return "目标章节已处于批准状态，无需重复回写。"
    if repair_patch.status not in {"proposed", "requires_rejudge"}:
        return "Repair Patch 状态暂不可批准。"
    return None


def _unavailable_approval_execution(reason: str) -> StudioApprovalExecuteRead:
    return StudioApprovalExecuteRead(
        approved_object=None,
        target_chapter=None,
        writeback_status="未执行",
        approved_chapter_id=None,
        continuity_update_summary=None,
        unavailable_reason=reason,
    )


def _approval_execution(
    *,
    object_type: str,
    object_id: int,
    object_status: str,
    scene_id: int,
    chapter: Chapter,
    writeback_status: str,
    approved_chapter_id: int | None,
    continuity_update_summary: str | None,
    unavailable_reason: str | None,
) -> StudioApprovalExecuteRead:
    return StudioApprovalExecuteRead(
        approved_object=StudioApprovalObjectRead(
            object_type=object_type,
            id=object_id,
            status=object_status,
            scene_id=scene_id,
        ),
        target_chapter=StudioApprovalTargetChapterRead(
            id=chapter.id,
            ordinal=chapter.ordinal,
            title=chapter.title,
            status=chapter.status,
        ),
        writeback_status=writeback_status,
        approved_chapter_id=approved_chapter_id,
        continuity_update_summary=continuity_update_summary,
        unavailable_reason=unavailable_reason,
    )


def _apply_repair_patch(content: str, patch_payload: dict) -> str:
    target_span = str(patch_payload.get("target_span", ""))
    replacement_text = str(patch_payload.get("replacement_text", ""))
    if target_span:
        return content.replace(target_span, replacement_text, 1)
    span_start = patch_payload.get("span_start")
    span_end = patch_payload.get("span_end")
    if isinstance(span_start, int) and isinstance(span_end, int) and 0 <= span_start <= span_end <= len(content):
        return f"{content[:span_start]}{replacement_text}{content[span_end:]}"
    return content


def _record_chapter_approval(
    session: Session,
    *,
    chapter: Chapter,
    scene: Scene,
    source_type: str,
    source_id: int,
) -> str:
    approved_content = scene.content or ""
    record = ContinuityRecord(
        book_id=chapter.book_id,
        scene_id=scene.id,
        record_type="chapter_approval",
        subject=f"chapter:{chapter.id}",
        status="active",
        payload={
            "chapter_id": chapter.id,
            "scene_id": scene.id,
            "source_type": source_type,
            "source_id": source_id,
            "approved_content": approved_content,
            "chapter_status": chapter.status,
        },
    )
    session.add(record)
    return f"章节批准连续性记录已创建：chapter:{chapter.id}"
