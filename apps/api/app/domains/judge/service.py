from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.domains.books.models import Scene
from app.domains.continuity.models import ScenePacket
from app.domains.judge.models import JudgeIssue
from app.domains.judge.schemas import JudgeIssueCreate


class JudgeInputError(ValueError):
    """评审请求无法定位场景或上下文包时抛出。"""


@dataclass(frozen=True)
class DetectedIssue:
    """服务内部的确定性命中结果，写库前先保持字段完整。"""

    category: str
    severity: str
    span_start: int
    span_end: int
    summary: str
    recommended_repair_mode: str
    expected_text: str
    replacement_text: str
    matched_text: str


STYLE_DRIFT_PHRASES = ("作者直接解释", "设定说明", "旁白解释", "直接说明设定", "作者在这里解释")


def create_judge_issues(session: Session, payload: JudgeIssueCreate) -> list[JudgeIssue]:
    """使用本地确定性规则生成结构化问题单并持久化。"""

    _validate_scene_packet(session, payload.scene_id, payload.scene_packet_id)
    detected = [
        *_detect_setting_conflicts(payload.content, payload.required_facts),
        *_detect_style_drift(payload.content, payload.style_rules),
    ]
    issues = [
        JudgeIssue(
            scene_id=payload.scene_id,
            scene_packet_id=payload.scene_packet_id,
            issue_type=item.category,
            severity=item.severity,
            status="open",
            description=item.summary,
            payload={
                "span_start": item.span_start,
                "span_end": item.span_end,
                "evidence_links": payload.evidence_links,
                "recommended_repair_mode": item.recommended_repair_mode,
                "expected_text": item.expected_text,
                "replacement_text": item.replacement_text,
                "matched_text": item.matched_text,
            },
        )
        for item in detected
    ]
    session.add_all(issues)
    session.commit()
    for issue in issues:
        session.refresh(issue)
    return issues


def _validate_scene_packet(session: Session, scene_id: int, scene_packet_id: int | None) -> None:
    """确认评审目标存在，并确保上下文包归属同一场景。"""

    if session.get(Scene, scene_id) is None:
        raise JudgeInputError("场景不存在，无法执行结构化评审。")
    if scene_packet_id is None:
        return
    scene_packet = session.get(ScenePacket, scene_packet_id)
    if scene_packet is None or scene_packet.scene_id != scene_id:
        raise JudgeInputError("Scene Packet 不存在或不属于指定场景，无法执行结构化评审。")


def _detect_setting_conflicts(content: str, required_facts: list[str]) -> list[DetectedIssue]:
    """识别必含事实的直接矛盾；未矛盾时再检查事实缺失。"""

    issues: list[DetectedIssue] = []
    for fact in required_facts:
        normalized_fact = fact.strip()
        if not normalized_fact:
            continue
        conflict = _find_conflict_phrase(content, normalized_fact)
        if conflict is not None:
            phrase, replacement = conflict
            start = content.index(phrase)
            issues.append(
                DetectedIssue(
                    category="setting_conflict",
                    severity="high",
                    span_start=start,
                    span_end=start + len(phrase),
                    summary=f"正文与必含事实“{normalized_fact}”冲突。",
                    recommended_repair_mode="replace_span",
                    expected_text=normalized_fact,
                    replacement_text=replacement,
                    matched_text=phrase,
                )
            )
        elif normalized_fact not in content:
            issues.append(_missing_fact_issue(content, normalized_fact))
    return issues


def _find_conflict_phrase(content: str, fact: str) -> tuple[str, str] | None:
    """按事实短语生成少量明确反义模板，确保定位结果可复现。"""

    replacements = {
        "左臂受伤": (("左臂完好无损", "左臂仍然受伤"), ("左臂没有受伤", "左臂仍然受伤")),
        "右臂受伤": (("右臂完好无损", "右臂仍然受伤"), ("右臂没有受伤", "右臂仍然受伤")),
    }
    for phrase, replacement in replacements.get(fact, ()):  # 项目早期先覆盖确定性高的硬约束。
        if phrase in content:
            return phrase, replacement
    if fact.endswith("受伤"):
        subject = fact[: -len("受伤")]
        for suffix in ("完好无损", "没有受伤", "毫发无伤"):
            phrase = f"{subject}{suffix}"
            if subject and phrase in content:
                return phrase, f"{subject}仍然受伤"
    return None


def _missing_fact_issue(content: str, fact: str) -> DetectedIssue:
    """必含事实缺失时锚定开头插入点，避免改写整章正文。"""

    span_end = 0 if not content else min(1, len(content))
    return DetectedIssue(
        category="setting_conflict",
        severity="medium",
        span_start=0,
        span_end=span_end,
        summary=f"正文缺少必含事实“{fact}”。",
        recommended_repair_mode="replace_span",
        expected_text=fact,
        replacement_text=(fact if span_end == 0 else f"{content[:span_end]}{fact}"),
        matched_text=content[:span_end],
    )


def _detect_style_drift(content: str, style_rules: list[str]) -> list[DetectedIssue]:
    """当克制文风下出现解释性短语时，生成文风漂移问题。"""

    if not any("克制" in rule for rule in style_rules):
        return []
    issues: list[DetectedIssue] = []
    for phrase in STYLE_DRIFT_PHRASES:
        if phrase not in content:
            continue
        start = content.index(phrase)
        issues.append(
            DetectedIssue(
                category="style_drift",
                severity="medium",
                span_start=start,
                span_end=start + len(phrase),
                summary=f"克制文风下不应出现“{phrase}”这类解释性短语。",
                recommended_repair_mode="replace_span",
                expected_text="克制",
                replacement_text="她把解释压回沉默里",
                matched_text=phrase,
            )
        )
    return issues
