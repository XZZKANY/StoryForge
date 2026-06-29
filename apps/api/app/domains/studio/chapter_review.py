from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domains.books.models import Chapter, Scene
from app.domains.continuity.models import ScenePacket
from app.domains.judge.models import JudgeIssue, RepairPatch
from app.domains.judge.schemas import JudgeIssueCreate
from app.domains.judge.service import JudgeInputError, create_judge_issues
from app.domains.repair.schemas import RepairPatchCreate
from app.domains.repair.service import RepairInputError, create_repair_patch
from app.domains.studio.approval import read_studio_approval_summary
from app.domains.studio.review_reads import (
    StudioChapterReviewInputError,
    StudioJudgeReviewNotFoundError,
    _highest_severity,
    _judge_review_score,
    _judge_review_status,
    _studio_judge_issue,
    _studio_repair_patch,
)
from app.domains.studio.schemas import StudioChapterReviewRunRead, StudioJudgeReviewRead


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
