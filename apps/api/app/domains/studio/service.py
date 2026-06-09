from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.common.exceptions import InputError, NotFoundError
from app.domains.book_runs.book_context import clear_book_context_cache
from app.domains.books.models import Book, Chapter, Scene
from app.domains.continuity.models import ContinuityRecord, ScenePacket
from app.domains.jobs.models import JobRun
from app.domains.judge.models import JudgeIssue, RepairPatch
from app.domains.judge.schemas import JudgeIssueCreate
from app.domains.judge.service import JudgeInputError, create_judge_issues
from app.domains.repair.schemas import RepairPatchCreate
from app.domains.repair.service import RepairInputError, create_repair_patch
from app.domains.studio.schemas import (
    StudioApprovalExecuteRead,
    StudioApprovalExecuteRequest,
    StudioApprovalObjectRead,
    StudioApprovalSummaryRead,
    StudioApprovalTargetChapterRead,
    StudioBookListItem,
    StudioChapterGoalRead,
    StudioChapterReviewRunRead,
    StudioJudgeIssueRead,
    StudioJudgeReviewRead,
    StudioRecoverySummaryRead,
    StudioRepairPatchRead,
    StudioScenePacketRead,
)


def list_studio_books(session: Session, workspace_id: int | None = None) -> list[StudioBookListItem]:
    """读取 Studio 首个真实数据源所需的作品列表摘要。"""

    latest_chapters = (
        select(Chapter.book_id, func.max(Chapter.ordinal).label("recent_chapter_ordinal"))
        .group_by(Chapter.book_id)
        .subquery()
    )
    statement = (
        select(Book.id, Book.title, latest_chapters.c.recent_chapter_ordinal)
        .outerjoin(latest_chapters, Book.id == latest_chapters.c.book_id)
        .order_by(Book.id)
    )
    if workspace_id is not None:
        statement = statement.where(Book.workspace_id == workspace_id)

    rows = session.execute(statement).all()
    return [
        StudioBookListItem(
            id=row.id,
            title=row.title,
            recent_chapter_ordinal=row.recent_chapter_ordinal,
        )
        for row in rows
    ]


class StudioChapterGoalNotFoundError(NotFoundError):
    """章节目标不存在时由路由层转换为可重试的 HTTP 响应。"""


class StudioScenePacketNotFoundError(NotFoundError):
    """Scene Packet 不存在时由路由层转换为可重试的 HTTP 响应。"""


def read_studio_chapter_goal(session: Session, *, book_id: int, target_ordinal: int) -> StudioChapterGoalRead:
    """读取 Studio 章节目标数据源，不触发生成或跨页面执行流。"""

    target_chapter = session.scalar(
        select(Chapter)
        .where(Chapter.book_id == book_id, Chapter.ordinal == target_ordinal)
        .order_by(Chapter.id)
        .limit(1)
    )
    if target_chapter is None:
        raise StudioChapterGoalNotFoundError("章节目标不存在，无法读取 Studio 章节目标。")

    previous_chapter = session.scalar(
        select(Chapter)
        .where(Chapter.book_id == book_id, Chapter.ordinal < target_ordinal)
        .order_by(Chapter.ordinal.desc(), Chapter.id.desc())
        .limit(1)
    )
    constraints = _next_chapter_constraints(session, book_id=book_id, previous_chapter_id=previous_chapter.id if previous_chapter else None)

    return StudioChapterGoalRead(
        book_id=book_id,
        target_chapter_id=target_chapter.id,
        target_chapter_ordinal=target_chapter.ordinal,
        target_chapter_title=target_chapter.title,
        chapter_goal=target_chapter.summary or target_chapter.title,
        previous_chapter_summary=previous_chapter.summary if previous_chapter else None,
        continuity_constraints=constraints,
    )

def _next_chapter_constraints(session: Session, *, book_id: int, previous_chapter_id: int | None) -> list[str]:
    """从上一章批准回写事实中读取下一章继承约束。"""

    if previous_chapter_id is None:
        return []
    rows = session.scalars(
        select(ContinuityRecord)
        .where(
            ContinuityRecord.book_id == book_id,
            ContinuityRecord.record_type == "next_chapter_constraints",
            ContinuityRecord.status == "active",
        )
        .order_by(ContinuityRecord.id)
    ).all()
    constraints: list[str] = []
    for record in rows:
        if record.payload.get("chapter_id") != previous_chapter_id:
            continue
        value = record.payload.get("value")
        if isinstance(value, list):
            constraints.extend(str(item) for item in value)
        elif value is not None:
            constraints.append(str(value))
    return constraints



def read_studio_scene_packet(session: Session, *, book_id: int, target_ordinal: int) -> StudioScenePacketRead:
    """读取 Studio Scene Packet 摘要，不重新触发上下文包组装。"""

    row = session.execute(
        select(ScenePacket, Scene, Chapter)
        .join(Scene, ScenePacket.scene_id == Scene.id)
        .join(Chapter, Scene.chapter_id == Chapter.id)
        .where(Chapter.book_id == book_id, Chapter.ordinal == target_ordinal)
        .order_by(ScenePacket.id.desc())
        .limit(1)
    ).first()
    if row is None:
        raise StudioScenePacketNotFoundError("Scene Packet 不存在，无法读取 Studio Scene Packet。")

    scene_packet, scene, chapter = row
    packet = scene_packet.packet or {}
    evidence_links = packet.get("证据链接")
    budget_summary = packet.get("上下文预算")
    return StudioScenePacketRead(
        book_id=book_id,
        target_chapter_ordinal=chapter.ordinal,
        scene_id=scene.id,
        scene_packet_id=scene_packet.id,
        job_run_id=scene_packet.job_run_id,
        status=scene_packet.status,
        chapter_goal=packet.get("章节目标") if isinstance(packet.get("章节目标"), str) else None,
        evidence_count=len(evidence_links) if isinstance(evidence_links, list) else 0,
        compiled_context_id=packet.get("compiled_context_id") if isinstance(packet.get("compiled_context_id"), str) else None,
        budget_summary=budget_summary if isinstance(budget_summary, dict) else {},
    )


class StudioJudgeReviewNotFoundError(NotFoundError):
    """Judge 评审不存在时由路由层转换为可重试的 HTTP 响应。"""


class StudioRepairPatchesNotFoundError(NotFoundError):
    """Repair 修订补丁不存在时由路由层转换为可重试的 HTTP 响应。"""


class StudioChapterReviewInputError(InputError):
    """章节审阅主动创建缺少正文或上下文包状态不满足时抛出。"""


def read_studio_judge_review(session: Session, *, scene_packet_id: int) -> StudioJudgeReviewRead:
    """读取 Studio Judge 评审摘要，不触发 Repair 修订流程。"""

    if session.get(ScenePacket, scene_packet_id) is None:
        raise StudioJudgeReviewNotFoundError("Scene Packet 不存在，无法读取 Studio Judge 评审。")

    issues = session.scalars(
        select(JudgeIssue)
        .where(JudgeIssue.scene_packet_id == scene_packet_id)
        .order_by(JudgeIssue.id)
    ).all()
    if not issues:
        raise StudioJudgeReviewNotFoundError("Judge 评审不存在，无法读取 Studio Judge 评审。")

    return StudioJudgeReviewRead(
        scene_packet_id=scene_packet_id,
        status=_judge_review_status(issues),
        issue_count=len(issues),
        highest_severity=_highest_severity(issues),
        score=_judge_review_score(issues),
        issues=[_studio_judge_issue(issue) for issue in issues],
    )


def _studio_judge_issue(issue: JudgeIssue) -> StudioJudgeIssueRead:
    """从 JudgeIssue payload 展开 Studio 页面需要的最小定位字段。"""

    payload = issue.payload or {}
    return StudioJudgeIssueRead(
        id=issue.id,
        category=issue.issue_type,
        severity=issue.severity,
        summary=issue.description,
        span_start=int(payload.get("span_start", 0)),
        span_end=int(payload.get("span_end", 0)),
        recommended_repair_mode=str(payload.get("recommended_repair_mode", "replace_span")),
    )


def _judge_review_status(issues: list[JudgeIssue]) -> str:
    """用最严重未关闭状态概括当前评审阶段。"""

    if any(issue.status == "open" for issue in issues):
        return "open"
    if any(issue.status == "requires_rejudge" for issue in issues):
        return "requires_rejudge"
    return issues[0].status


def _highest_severity(issues: list[JudgeIssue]) -> str | None:
    """按项目已有 severity 字符串选出最需要展示的严重级别。"""

    severity_order = {"high": 3, "medium": 2, "low": 1}
    return max((issue.severity for issue in issues), key=lambda severity: severity_order.get(severity, 0), default=None)


def _judge_review_score(issues: list[JudgeIssue]) -> int:
    """把问题数量和严重级别压缩成 Studio 可展示的最小评审分数。"""

    penalties = {"high": 40, "medium": 20, "low": 10}
    score = 100 - sum(penalties.get(issue.severity, 15) for issue in issues)
    return max(score, 0)


def read_studio_repair_patches(session: Session, *, scene_packet_id: int) -> list[StudioRepairPatchRead]:
    """读取已生成的 Repair 补丁摘要，不触发新的修复生成。"""

    if session.get(ScenePacket, scene_packet_id) is None:
        raise StudioRepairPatchesNotFoundError("Scene Packet 不存在，无法读取 Studio Repair 修订。")

    patches = session.scalars(
        select(RepairPatch)
        .join(JudgeIssue, RepairPatch.judge_issue_id == JudgeIssue.id)
        .where(JudgeIssue.scene_packet_id == scene_packet_id)
        .order_by(RepairPatch.id)
    ).all()
    if not patches:
        raise StudioRepairPatchesNotFoundError("Repair 修订补丁不存在，无法读取 Studio Repair 修订。")

    return [_studio_repair_patch(patch) for patch in patches]


def _studio_repair_patch(patch: RepairPatch) -> StudioRepairPatchRead:
    """从 RepairPatch payload 展开 Studio 页面需要的最小差异摘要。"""

    patch_payload = patch.patch or {}
    return StudioRepairPatchRead(
        id=patch.id,
        issue_id=patch.judge_issue_id,
        status=patch.status,
        target_span=str(patch_payload.get("target_span", "")),
        replacement_text=str(patch_payload.get("replacement_text", "")),
        reason=patch.rationale or "",
        requires_rejudge=bool(patch_payload.get("requires_rejudge", True)),
    )


def run_studio_chapter_review(session: Session, *, scene_packet_id: int) -> StudioChapterReviewRunRead:
    """为 Assistant 主动串联章节评审、修复建议和批准摘要。"""

    row = session.execute(
        select(ScenePacket, Scene, Chapter)
        .join(Scene, ScenePacket.scene_id == Scene.id)
        .join(Chapter, Scene.chapter_id == Chapter.id)
        .where(ScenePacket.id == scene_packet_id)
        .limit(1)
    ).first()
    if row is None:
        raise StudioJudgeReviewNotFoundError("Scene Packet 不存在，无法执行章节审阅。")

    scene_packet, scene, _chapter = row
    content = (scene.content or "").strip()
    if not content:
        raise StudioChapterReviewInputError("场景正文为空，无法执行章节审阅。")
    if scene_packet.status != "assembled":
        raise StudioChapterReviewInputError("Scene Packet 尚未完成组装，无法执行章节审阅。")

    packet = scene_packet.packet or {}
    try:
        issues = create_judge_issues(
            session,
            JudgeIssueCreate(
                scene_id=scene.id,
                scene_packet_id=scene_packet.id,
                content=content,
                required_facts=_packet_string_list(packet.get("必须包含事实")),
                style_rules=_packet_style_rules(packet.get("风格规则")),
                evidence_links=_packet_evidence_links(packet.get("证据链接")),
            ),
        )
    except JudgeInputError as exc:
        raise StudioJudgeReviewNotFoundError(str(exc)) from exc

    patches: list[RepairPatch] = []
    for issue in issues:
        if not _is_repairable_issue(issue, content):
            continue
        try:
            patches.append(create_repair_patch(session, RepairPatchCreate(issue_id=issue.id, content=content)))
        except RepairInputError:
            continue

    repair_patch_id = patches[0].id if patches else None
    approval_summary = read_studio_approval_summary(
        session,
        repair_patch_id=repair_patch_id,
        scene_packet_id=None if repair_patch_id else scene_packet.id,
    )
    return StudioChapterReviewRunRead(
        scene_packet_id=scene_packet.id,
        judge_review=_studio_chapter_review_from_issues(scene_packet.id, issues),
        repair_patches=[_studio_repair_patch(patch) for patch in patches],
        approval_summary=approval_summary,
    )


def _studio_chapter_review_from_issues(
    scene_packet_id: int,
    issues: list[JudgeIssue],
) -> StudioJudgeReviewRead:
    """主动评审允许零问题成功态，避免把 clean 误判成缺失评审。"""

    if not issues:
        return StudioJudgeReviewRead(
            scene_packet_id=scene_packet_id,
            status="clean",
            issue_count=0,
            highest_severity=None,
            score=100,
            issues=[],
        )
    return StudioJudgeReviewRead(
        scene_packet_id=scene_packet_id,
        status=_judge_review_status(issues),
        issue_count=len(issues),
        highest_severity=_highest_severity(issues),
        score=_judge_review_score(issues),
        issues=[_studio_judge_issue(issue) for issue in issues],
    )


def _is_repairable_issue(issue: JudgeIssue, content: str) -> bool:
    payload = issue.payload or {}
    if issue.status != "open":
        return False
    if str(payload.get("recommended_repair_mode", "replace_span")) == "none":
        return False
    span_start = payload.get("span_start")
    span_end = payload.get("span_end")
    if not isinstance(span_start, int) or not isinstance(span_end, int):
        return False
    if span_start < 0 or span_end <= span_start or span_end > len(content):
        return False
    matched_text = str(payload.get("matched_text", content[span_start:span_end]))
    return content[span_start:span_end] == matched_text


def _packet_string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]


def _packet_style_rules(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    rules: list[str] = []
    for item in value:
        if isinstance(item, str) and item.strip():
            rules.append(item.strip())
        elif isinstance(item, dict):
            rule = item.get("rule")
            if isinstance(rule, str) and rule.strip():
                rules.append(rule.strip())
    return rules


def _packet_evidence_links(value: object) -> list[dict]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


class StudioApprovalSummaryNotFoundError(NotFoundError):
    """批准摘要目标不存在时由路由层转换为可重试的 HTTP 响应。"""


class StudioRecoverySummaryNotFoundError(NotFoundError):
    """恢复摘要目标不存在时由路由层转换为可重试的 HTTP 响应。"""


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


def read_studio_recovery_summary(session: Session, *, job_run_id: int) -> StudioRecoverySummaryRead:
    """读取失败恢复资格摘要，不触发重试或运行时续跑。"""

    job = session.get(JobRun, job_run_id)
    if job is None:
        raise StudioRecoverySummaryNotFoundError("任务不存在，无法读取失败恢复摘要。")

    progress = dict(job.progress or {})
    checkpoint = {
        key: progress[key]
        for key in ("thread_id", "current_node", "approval_status")
        if key in progress
    }
    failed_node = _first_string(progress, "failed_node", "current_node")
    recoverable_steps = _recoverable_steps(progress, failed_node=failed_node)
    error_summary = job.error_message or _first_string(progress, "error_summary", "error_message")

    unrecoverable_reason = None
    if job.status != "failed":
        unrecoverable_reason = "任务尚未失败，无需执行失败恢复。"
    elif not checkpoint:
        unrecoverable_reason = "缺少 checkpoint，无法定位恢复入口。"
    elif not recoverable_steps:
        unrecoverable_reason = "缺少可恢复步骤，无法生成恢复摘要。"
    elif not error_summary:
        unrecoverable_reason = "缺少错误摘要，无法判断恢复风险。"

    return StudioRecoverySummaryRead(
        can_recover=unrecoverable_reason is None,
        failed_node=failed_node,
        checkpoint=checkpoint or None,
        recoverable_steps=recoverable_steps,
        error_summary=error_summary,
        unrecoverable_reason=unrecoverable_reason,
    )


def _first_string(payload: dict, *keys: str) -> str | None:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, str) and value:
            return value
    return None


def _recoverable_steps(progress: dict, *, failed_node: str | None) -> list[str]:
    steps = progress.get("recoverable_steps")
    if isinstance(steps, list):
        return [str(step) for step in steps if str(step)]
    if failed_node:
        return [f"从 {failed_node} 重新读取 checkpoint 后继续执行"]
    return []
