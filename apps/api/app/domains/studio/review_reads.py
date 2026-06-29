from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.common.exceptions import InputError, NotFoundError
from app.domains.continuity.models import ScenePacket
from app.domains.judge.models import JudgeIssue, RepairPatch
from app.domains.studio.schemas import StudioJudgeIssueRead, StudioJudgeReviewRead, StudioRepairPatchRead


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
