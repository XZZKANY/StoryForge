from __future__ import annotations

import json
import os
from collections.abc import Callable, Sequence
from dataclasses import dataclass

import httpx
from sqlalchemy.orm import Session

from app.common.exceptions import InputError
from app.domains.books.models import Scene
from app.domains.continuity.models import ScenePacket
from app.domains.judge.models import JudgeIssue
from app.domains.judge.schemas import JudgeIssueCreate


class JudgeInputError(InputError):
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
JudgeProvider = Callable[[JudgeIssueCreate], Sequence[dict[str, object] | DetectedIssue]]


def create_judge_issues(session: Session, payload: JudgeIssueCreate) -> list[JudgeIssue]:
    """优先使用 LLM 语义评审，缺少配置时回退到确定性规则。"""

    _validate_scene_packet(session, payload.scene_id, payload.scene_packet_id)
    detected = semantic_judge(payload) or deterministic_judge_fallback(payload)
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


def deterministic_judge_fallback(payload: JudgeIssueCreate) -> list[DetectedIssue]:
    """无模型配置或模型未返回可用结构时，提供可复现的本地备用评审。"""

    return [
        *_detect_setting_conflicts(payload.content, payload.required_facts),
        *_detect_style_drift(payload.content, payload.style_rules),
    ]


def semantic_judge(payload: JudgeIssueCreate, *, provider: JudgeProvider | None = None) -> list[DetectedIssue]:
    """调用 OpenAI 兼容模型执行语义一致性评审。"""

    if provider is not None:
        return _issues_from_provider_items(provider(payload), payload.content)

    api_key = os.getenv("STORYFORGE_JUDGE_LLM_API_KEY") or os.getenv("STORYFORGE_LLM_API_KEY")
    if not api_key:
        return []
    base_url = os.getenv("STORYFORGE_JUDGE_LLM_BASE_URL") or os.getenv("STORYFORGE_LLM_BASE_URL", "https://api.openai.com/v1")
    model = os.getenv("STORYFORGE_JUDGE_LLM_MODEL") or os.getenv("STORYFORGE_LLM_MODEL", "gpt-4o-mini")
    prompt = (
        "你是 StoryForge 的结构化 Judge。请识别 setting_conflict、timeline_conflict、relationship_conflict、style_drift。"
        "仅返回 JSON 数组，每项包含 category、severity、span_start、span_end、summary、expected_text、replacement_text、matched_text。\n"
        f"正文：{payload.content}\n必含事实：{payload.required_facts}\n风格规则：{payload.style_rules}"
    )
    request_payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": "只返回 JSON，不要解释。"},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0,
    }
    try:
        with httpx.Client(timeout=float(os.getenv("STORYFORGE_JUDGE_LLM_TIMEOUT_SECONDS", "30"))) as client:
            response = client.post(
                f"{base_url.rstrip('/')}/chat/completions",
                json=request_payload,
                headers={"Authorization": f"Bearer {api_key}"},
            )
            data = response.json()
        raw_content = data["choices"][0]["message"]["content"]
        decoded = json.loads(raw_content)
    except Exception:
        return []
    if not isinstance(decoded, list):
        return []
    return _issues_from_provider_items(decoded, payload.content)


def _issues_from_provider_items(items: Sequence[dict[str, object] | DetectedIssue], content: str) -> list[DetectedIssue]:
    """规整 provider 返回值，让远程模型和本地测试替身走同一条解析路径。"""

    issues: list[DetectedIssue] = []
    for item in items:
        if isinstance(item, DetectedIssue):
            issues.append(item)
        elif isinstance(item, dict):
            issues.append(_issue_from_llm_item(item, content))
    return issues


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
    field_conflict = _find_field_conflict(content, fact)
    if field_conflict is not None:
        return field_conflict
    if fact.endswith("受伤"):
        subject = fact[: -len("受伤")]
        for suffix in ("完好无损", "没有受伤", "毫发无伤"):
            phrase = f"{subject}{suffix}"
            if subject and phrase in content:
                return phrase, f"{subject}仍然受伤"
    return None


def _find_field_conflict(content: str, fact: str) -> tuple[str, str] | None:
    """识别“字段：值”类事实在正文中的不同取值。"""

    separator = "：" if "：" in fact else ":"
    if separator not in fact:
        return None
    field, expected = [part.strip() for part in fact.split(separator, 1)]
    if not field or not expected:
        return None
    marker = f"{field}{separator}"
    start = content.find(marker)
    if start < 0:
        return None
    value_start = start + len(marker)
    value_end = value_start
    while value_end < len(content) and content[value_end] not in "，。；;,. \n\r\t":
        value_end += 1
    observed = content[value_start:value_end].strip()
    if observed and observed != expected:
        return f"{marker}{observed}", f"{marker}{expected}"
    return None


def _issue_from_llm_item(item: dict, content: str) -> DetectedIssue:
    """把模型 JSON 条目规整为内部问题对象，防止越界位置污染响应。"""

    span_start = max(0, min(int(item.get("span_start", 0)), len(content)))
    span_end = max(span_start, min(int(item.get("span_end", span_start)), len(content)))
    category = str(item.get("category", "setting_conflict"))
    severity = str(item.get("severity", "medium"))
    matched_text = str(item.get("matched_text") or content[span_start:span_end])
    expected_text = str(item.get("expected_text", ""))
    return DetectedIssue(
        category=category,
        severity=severity if severity in {"low", "medium", "high"} else "medium",
        span_start=span_start,
        span_end=span_end,
        summary=str(item.get("summary") or f"模型发现 {category}。"),
        recommended_repair_mode="replace_span",
        expected_text=expected_text,
        replacement_text=str(item.get("replacement_text") or expected_text),
        matched_text=matched_text,
    )


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
