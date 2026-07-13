"""跨章一致性审校:把若干**完整章节**喂给同一个 LLM 客户端,找跨章硬冲突。

与单章 review 的区别:review 只看当前章 + 300 字上下文摘录(`review_reasoning.py`),
结构上看不到跨章问题(时间线/称谓漂移/设定不一/伏笔)。本模块专做跨章,喂整章正文。
复用 book_generation 的 `call_llm` / `resolved_llm_env`(同一 STORYFORGE_LLM_* 客户端)。
"""
from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any

from app.domains.book_runs.book_generation import BookGenerationError
from app.domains.book_runs.book_generation import call_llm as _call_llm

PER_CHAPTER_CHAR_BUDGET = 4000
_MAX_FINDINGS = 12
_VALID_TYPES = {"timeline", "naming", "setting", "character_exit", "foreshadow", "other"}
_VALID_SEVERITIES = {"high", "medium", "low"}

_SYSTEM_PROMPT = (
    "你是 StoryForge 的跨章一致性审校。给你同一部小说的若干章节正文,"
    "只找它们**之间**的硬冲突:时间线矛盾、人物姓名/称谓漂移、设定或世界规则前后不一致、"
    "已死亡或已离场角色再次出场、前文埋下的伏笔后文未回收。"
    "不要报单章内的文风/节奏问题。每条冲突必须给出涉及的章节和各自的原文片段为证。"
    "只输出 JSON 数组,不要解释,不要 Markdown,不要代码块标记。"
)


def check_cross_chapter_consistency(
    source: Mapping[str, str | None],
    chapters: list[dict[str, str]],
    *,
    focus: str | None = None,
) -> dict[str, Any]:
    """chapters: [{"name": "第1章", "content": "..."}, ...](按叙事顺序)。

    返回 {"findings": [...], "model": str|None, "latency_ms": int|None}。
    findings 每项: {type, severity, chapters:[...], finding, evidence}。
    """
    if len([c for c in chapters if (c.get("content") or "").strip()]) < 2:
        raise ValueError("跨章一致性检查至少需要两章有正文的章节。")
    result = _call_llm(
        source,
        system_prompt=_SYSTEM_PROMPT,
        user_prompt=_build_user_prompt(chapters, focus),
    )
    findings = _parse_findings(result.get("content"))
    return {
        "findings": findings,
        "model": _model_name(source),
        "latency_ms": result.get("latency_ms"),
    }


def _build_user_prompt(chapters: list[dict[str, str]], focus: str | None) -> str:
    parts: list[str] = ["以下是同一部小说的若干章节(按顺序):", ""]
    for ch in chapters:
        name = (ch.get("name") or "未命名章").strip()
        parts.append(f"<<<{name}")
        parts.append(_truncate(ch.get("content") or "", PER_CHAPTER_CHAR_BUDGET))
        parts.append(f"{name}>>>")
        parts.append("")
    if focus and focus.strip():
        parts.append(f"作者特别关注:{focus.strip()}")
        parts.append("")
    parts.append("只输出 JSON 数组,每项必须是:")
    parts.append(
        '{"type":"timeline|naming|setting|character_exit|foreshadow|other",'
        '"severity":"high|medium|low","chapters":["第N章",...],'
        '"finding":"跨章冲突说明","evidence":"涉及各章的原文片段"}'
    )
    parts.append(f"最多 {_MAX_FINDINGS} 项;没有任何跨章冲突时输出 []。")
    return "\n".join(parts)


def _parse_findings(raw: object) -> list[dict[str, Any]]:
    if not isinstance(raw, str) or not raw.strip():
        raise BookGenerationError("跨章一致性 LLM 返回为空。")
    parsed = _loads_json_array(raw)
    if not isinstance(parsed, list):
        raise BookGenerationError("跨章一致性 LLM 返回的不是 JSON 数组。")
    out: list[dict[str, Any]] = []
    for item in parsed[:_MAX_FINDINGS]:
        if not isinstance(item, dict):
            continue
        ftype = str(item.get("type") or "other").strip().lower()
        if ftype not in _VALID_TYPES:
            ftype = "other"
        severity = str(item.get("severity") or "medium").strip().lower()
        if severity not in _VALID_SEVERITIES:
            severity = "medium"
        chapters = item.get("chapters")
        chapter_list = [str(c).strip() for c in chapters if str(c).strip()] if isinstance(chapters, list) else []
        out.append(
            {
                "type": ftype,
                "severity": severity,
                "chapters": chapter_list,
                "finding": _compact(item.get("finding"), 280) or "未命名跨章冲突。",
                "evidence": _compact(item.get("evidence"), 280) or "未提供原文证据。",
            }
        )
    return out


def _loads_json_array(raw: str) -> Any:
    text = _strip_code_fence(raw.strip())
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("["), text.rfind("]")
        if start == -1 or end <= start:
            raise
        return json.loads(text[start : end + 1])


def _strip_code_fence(text: str) -> str:
    if not text.startswith("```"):
        return text
    lines = text.splitlines()
    if lines and lines[0].startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].strip().startswith("```"):
        lines = lines[:-1]
    return "\n".join(lines).strip()


def _truncate(value: str, limit: int) -> str:
    text = value.strip()
    return text if len(text) <= limit else f"{text[:limit].rstrip()}\n...[已截断]"


def _compact(value: object, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    text = " ".join(value.split())
    return text if len(text) <= limit else f"{text[:limit].rstrip()}..."


def _model_name(source: Mapping[str, str | None]) -> str | None:
    model = source.get("STORYFORGE_LLM_MODEL")
    return model.strip() if isinstance(model, str) and model.strip() else None
