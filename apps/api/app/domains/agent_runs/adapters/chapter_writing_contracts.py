from __future__ import annotations

import json
import re
import uuid
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from app.domains.agent_runs import fs_tools, serial_plan
from app.domains.agent_runs.errors import AgentOrchestrationError

CHAPTER_BRIEF_ARTIFACT_KIND = "chapter_brief"
CHAPTER_CHECK_ARTIFACT_KIND = "chapter_check"
CHAPTER_WRITE_INTENT = "chapter.write"

_MAX_LIST_ITEMS = 12
_MAX_ITEM_CHARS = 300
_HARD_RULES = frozenset(
    {
        "draft_empty",
        "draft_truncated",
        "word_count_out_of_range",
        "missing_required_beat",
        "forbidden_content",
        "continuity_violation",
        "checker_failure",
    }
)
_REPAIRABLE_HARD_RULES = frozenset(
    {
        "draft_truncated",
        "word_count_out_of_range",
        "missing_required_beat",
        "forbidden_content",
        "continuity_violation",
    }
)


def resolve_target(project_root: str, requested_path: object) -> tuple[str, str, serial_plan.PlannedChapter | None]:
    root = fs_tools.resolve_project_root(project_root)
    relative = _relative_path(root, requested_path)
    plan = serial_plan.build_plan(project_root)
    planned = plan.next_chapter if plan is not None else None
    if relative is None and planned is not None:
        relative = planned.declared_path or f"正文/第{planned.ordinal:03d}章.md"
    if relative is None:
        raise AgentOrchestrationError("写一章需要目标文件：请先打开空章节文件，或在连载计划中声明下一章。")
    try:
        absolute = fs_tools.resolve_new_project_file(project_root, relative)
    except fs_tools.FsToolError as exc:
        raise AgentOrchestrationError(str(exc)) from exc
    return relative, absolute, planned


def build_brief_seed(
    *,
    user_message: str,
    target_path: str,
    planned: serial_plan.PlannedChapter | None,
    plan: serial_plan.SerialPlan | None,
) -> dict[str, Any]:
    minimum = plan.chapter_word_count_min if plan is not None else None
    maximum = plan.chapter_word_count_max if plan is not None else None
    return {
        "target_path": target_path,
        "chapter_ordinal": planned.ordinal if planned is not None else None,
        "chapter_title": planned.title if planned is not None else None,
        "goal": planned.goal if planned is not None and planned.goal else user_message,
        "pov": None,
        "setting": None,
        "required_beats": [],
        "forbidden_items": [],
        "continuity_constraints": [],
        "target_chars_min": minimum or 1600,
        "target_chars_max": maximum or 2600,
    }


def brief_prompt(seed: Mapping[str, Any], user_message: str) -> str:
    return (
        "把作者的写章要求整理成 Chapter Brief。只输出 JSON 对象，不要代码块。"
        "字段必须是 target_path, chapter_ordinal, chapter_title, goal, pov, setting, "
        "required_beats, forbidden_items, continuity_constraints, target_chars_min, target_chars_max。"
        "不得更改 target_path/chapter_ordinal；缺少信息用 null 或空数组，不得编造项目事实。\n"
        f"后端确定种子：{json.dumps(dict(seed), ensure_ascii=False)}\n作者要求：{user_message}"
    )


def parse_brief(raw: object, *, seed: Mapping[str, Any], provenance: Mapping[str, Any]) -> dict[str, Any]:
    payload = _json_object(raw)
    minimum = _positive_int(payload.get("target_chars_min")) or int(seed["target_chars_min"])
    maximum = _positive_int(payload.get("target_chars_max")) or int(seed["target_chars_max"])
    if minimum > maximum:
        minimum, maximum = maximum, minimum
    brief = {
        "brief_id": f"chapter-brief-{uuid.uuid4().hex}",
        "revision": 1,
        "target_path": str(seed["target_path"]),
        "chapter_ordinal": seed.get("chapter_ordinal"),
        "chapter_title": _text(payload.get("chapter_title"), 100) or seed.get("chapter_title"),
        "goal": _text(payload.get("goal"), 1000) or str(seed["goal"]),
        "pov": _text(payload.get("pov"), 100),
        "setting": _text(payload.get("setting"), 200),
        "required_beats": _text_list(payload.get("required_beats")),
        "forbidden_items": _text_list(payload.get("forbidden_items")),
        "continuity_constraints": _text_list(payload.get("continuity_constraints")),
        "target_chars_min": minimum,
        "target_chars_max": maximum,
        "context_provenance": dict(provenance),
    }
    return brief


def confirm_brief(candidate: object, pending: Mapping[str, Any]) -> dict[str, Any]:
    if not isinstance(candidate, Mapping):
        raise AgentOrchestrationError("确认写章前需要提交结构化 Chapter Brief。")
    if candidate.get("brief_id") != pending.get("brief_id") or candidate.get("revision") != pending.get("revision"):
        raise AgentOrchestrationError("Chapter Brief 已过期，请重新生成后再确认。")
    confirmed = dict(pending)
    for key, limit in (("chapter_title", 100), ("goal", 1000), ("pov", 100), ("setting", 200)):
        confirmed[key] = _text(candidate.get(key), limit)
    for key in ("required_beats", "forbidden_items", "continuity_constraints"):
        confirmed[key] = _text_list(candidate.get(key))
    minimum = _positive_int(candidate.get("target_chars_min"))
    maximum = _positive_int(candidate.get("target_chars_max"))
    if minimum is None or maximum is None or minimum > maximum:
        raise AgentOrchestrationError("Chapter Brief 字数范围无效。")
    confirmed["target_chars_min"] = minimum
    confirmed["target_chars_max"] = maximum
    confirmed["revision"] = int(pending["revision"]) + 1
    confirmed["status"] = "confirmed"
    return confirmed


def draft_instruction(brief: Mapping[str, Any]) -> str:
    lines = [
        f"章节目标：{brief.get('goal') or '按已确认 brief 写作'}",
        f"目标字数：{brief['target_chars_min']}–{brief['target_chars_max']} 字",
    ]
    for label, key in (
        ("视角", "pov"),
        ("场景", "setting"),
        ("必达节拍", "required_beats"),
        ("禁写事项", "forbidden_items"),
        ("连续性约束", "continuity_constraints"),
    ):
        value = brief.get(key)
        if isinstance(value, list) and value:
            lines.append(f"{label}：{'；'.join(str(item) for item in value)}")
        elif isinstance(value, str) and value:
            lines.append(f"{label}：{value}")
    return "\n".join(lines)


def check_prompt(brief: Mapping[str, Any], content: str) -> str:
    contract = {key: brief.get(key) for key in ("required_beats", "forbidden_items", "continuity_constraints")}
    return (
        "检查正文是否满足已确认 brief。只输出 JSON：{\"findings\":[...]}。"
        "finding 字段为 rule,severity,message,line,evidence；rule 只允许 "
        "missing_required_beat, forbidden_content, continuity_violation, advisory。"
        "只有能引用正文证据的明确违反才用 hard；不确定的一律 advisory。\n"
        f"brief：{json.dumps(contract, ensure_ascii=False)}\n正文：\n{content}"
    )


def build_check(content: str, brief: Mapping[str, Any], raw: object) -> dict[str, Any]:
    findings: list[dict[str, Any]] = []
    if not content.strip():
        findings.append(_finding("draft_empty", "正文为空。"))
    minimum = int(brief["target_chars_min"])
    maximum = int(brief["target_chars_max"])
    if len(content) < int(minimum * 0.7) or len(content) > int(maximum * 1.3):
        findings.append(_finding("word_count_out_of_range", f"正文 {len(content)} 字，严重偏离 {minimum}–{maximum} 字。"))
    try:
        payload = _json_object(raw)
    except AgentOrchestrationError as exc:
        findings.append(_finding("checker_failure", str(exc)))
        payload = {}
    raw_findings = payload.get("findings") if isinstance(payload.get("findings"), list) else []
    for item in raw_findings[:30]:
        if not isinstance(item, Mapping):
            continue
        rule = item.get("rule")
        if rule not in {"missing_required_beat", "forbidden_content", "continuity_violation", "advisory"}:
            continue
        evidence = _text(item.get("evidence"), 500)
        severity = "hard" if item.get("severity") == "hard" and evidence and rule != "advisory" else "advisory"
        findings.append(
            {
                "rule": rule,
                "severity": severity,
                "message": _text(item.get("message"), 500) or str(rule),
                "line": _positive_int(item.get("line")),
                "evidence": evidence,
            }
        )
    hard_count = sum(1 for item in findings if item["severity"] == "hard")
    repairable = hard_count > 0 and all(item["rule"] in _REPAIRABLE_HARD_RULES for item in findings if item["severity"] == "hard")
    return {
        "status": "repairable" if repairable else "blocked" if hard_count else "pass",
        "content_chars": len(content),
        "hard_failure_count": hard_count,
        "advisory_count": sum(1 for item in findings if item["severity"] == "advisory"),
        "findings": findings,
    }


def repair_instruction(check: Mapping[str, Any], brief: Mapping[str, Any]) -> str:
    issues = [item for item in check.get("findings", []) if isinstance(item, Mapping) and item.get("severity") == "hard"]
    return "按已确认 Chapter Brief 修复以下硬失败，只改必要处并输出完整正文：\n" + "\n".join(
        f"- {item.get('rule')}: {item.get('message')}" for item in issues
    ) + "\n\n" + draft_instruction(brief)


def _relative_path(root: Path, value: object) -> str | None:
    text = _text(value, 1024)
    if text is None:
        return None
    candidate = Path(text)
    if candidate.is_absolute():
        try:
            return candidate.resolve().relative_to(root).as_posix()
        except (OSError, ValueError) as exc:
            raise AgentOrchestrationError("目标章节不在当前项目内。") from exc
    return candidate.as_posix()


def _json_object(raw: object) -> dict[str, Any]:
    if isinstance(raw, Mapping):
        return dict(raw)
    if not isinstance(raw, str):
        raise AgentOrchestrationError("模型未返回可解析的结构化结果。")
    text = raw.strip()
    fence = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", text, flags=re.DOTALL | re.IGNORECASE)
    if fence:
        text = fence.group(1)
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise AgentOrchestrationError("模型返回的结构化结果不是有效 JSON。") from exc
    if not isinstance(parsed, dict):
        raise AgentOrchestrationError("模型返回的结构化结果必须是 JSON 对象。")
    return parsed


def _finding(rule: str, message: str) -> dict[str, Any]:
    return {"rule": rule, "severity": "hard", "message": message, "line": None, "evidence": None}


def _text(value: object, limit: int) -> str | None:
    return value.strip()[:limit] if isinstance(value, str) and value.strip() else None


def _text_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    result: list[str] = []
    for item in value:
        text = _text(item, _MAX_ITEM_CHARS)
        if text and text not in result:
            result.append(text)
        if len(result) >= _MAX_LIST_ITEMS:
            break
    return result


def _positive_int(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else None


__all__ = [
    "CHAPTER_BRIEF_ARTIFACT_KIND",
    "CHAPTER_CHECK_ARTIFACT_KIND",
    "CHAPTER_WRITE_INTENT",
    "brief_prompt",
    "build_brief_seed",
    "build_check",
    "check_prompt",
    "confirm_brief",
    "draft_instruction",
    "parse_brief",
    "repair_instruction",
    "resolve_target",
]
