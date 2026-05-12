from __future__ import annotations

from sqlalchemy.orm import Session

from app.domains.judge.models import JudgeIssue, RepairPatch
from app.domains.repair.schemas import RepairPatchCreate


class RepairInputError(ValueError):
    """修复请求无法定位问题单或原文片段时抛出。"""


def create_repair_patch(session: Session, payload: RepairPatchCreate) -> RepairPatch:
    """为命中的问题 span 生成定向补丁，并要求修复后重新评审。"""

    issue = session.get(JudgeIssue, payload.issue_id)
    if issue is None:
        raise RepairInputError("评审问题单不存在，无法生成修复补丁。")

    issue_payload = issue.payload or {}
    span_start = int(issue_payload.get("span_start", 0))
    span_end = int(issue_payload.get("span_end", 0))
    if span_start < 0 or span_end < span_start or span_end > len(payload.content):
        raise RepairInputError("问题单 span 已无法匹配当前正文，无法生成定向修复。")

    target_span = payload.content[span_start:span_end]
    expected_span = str(issue_payload.get("matched_text", target_span))
    if expected_span and target_span != expected_span:
        raise RepairInputError("当前正文与问题单记录的命中片段不一致，无法安全修复。")

    replacement_text = _replacement_for_issue(issue, target_span)
    reason = _repair_reason(issue, target_span, replacement_text)
    issue.status = "requires_rejudge"
    repair_patch = RepairPatch(
        judge_issue_id=issue.id,
        scene_id=issue.scene_id,
        job_run_id=issue.job_run_id,
        status="requires_rejudge",
        patch={
            "target_span": target_span,
            "replacement_text": replacement_text,
            "requires_rejudge": True,
            "span_start": span_start,
            "span_end": span_end,
        },
        rationale=reason,
        version=1,
    )
    session.add(repair_patch)
    session.commit()
    session.refresh(issue)
    session.refresh(repair_patch)
    return repair_patch


def _replacement_for_issue(issue: JudgeIssue, target_span: str) -> str:
    """根据问题单 payload 生成只覆盖 target_span 的替换文本。"""

    issue_payload = issue.payload or {}
    replacement = str(issue_payload.get("replacement_text", "")).strip()
    if replacement:
        return replacement
    expected_text = str(issue_payload.get("expected_text", "")).strip()
    if issue.issue_type == "setting_conflict" and expected_text:
        return expected_text
    if issue.issue_type == "style_drift":
        return "她把解释压回沉默里"
    return target_span


def _repair_reason(issue: JudgeIssue, target_span: str, replacement_text: str) -> str:
    """生成中文修复理由，便于人工审查补丁意图。"""

    if issue.issue_type == "setting_conflict":
        return f"将“{target_span}”替换为“{replacement_text}”，使正文回到必含事实约束。"
    if issue.issue_type == "style_drift":
        return f"将解释性短语“{target_span}”替换为更克制的描写。"
    return f"根据问题单建议替换“{target_span}”。"
