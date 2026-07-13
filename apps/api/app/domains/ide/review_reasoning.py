from __future__ import annotations

import json
from collections.abc import Mapping
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any, Protocol

from app.domains.book_runs.book_generation import (
    BookGenerationError,
)
from app.domains.book_runs.book_generation import (
    call_llm as _call_llm,
)
from app.domains.book_runs.book_generation import (
    missing_book_generation_env as _missing_book_generation_env,
)
from app.domains.book_runs.book_generation import (
    resolved_llm_env as _resolved_llm_env,
)
from app.domains.ide.review_skills import (
    REVIEW_SKILLS,
    character_agent_issues,
    plot_agent_issues,
    prose_agent_issues,
)

REVIEW_AGENT_KEYS = ("plot", "character", "prose")
_VALID_SEVERITIES = {"high", "medium", "low"}
_MAX_LLM_ISSUES_PER_AGENT = 6
_CONTENT_PROMPT_CHAR_BUDGET = 3000


@dataclass(frozen=True)
class ReviewSubagentResult:
    agent: str
    mode: str
    issues: list[dict[str, str]]
    model: str | None = None
    latency_ms: int | None = None
    degraded_reason: str | None = None


class ReviewReasoner(Protocol):
    def review_all(
        self, *, content: str, paragraphs: list[str], context_bundle: dict[str, Any] | None
    ) -> list[ReviewSubagentResult]: ...


class HeuristicReviewReasoner:
    def review_all(
        self, *, content: str, paragraphs: list[str], context_bundle: dict[str, Any] | None
    ) -> list[ReviewSubagentResult]:
        return [
            _heuristic_result("plot", content, paragraphs, context_bundle),
            _heuristic_result("character", content, paragraphs, context_bundle),
            _heuristic_result("prose", content, paragraphs, context_bundle),
        ]


class LlmReviewReasoner:
    def __init__(self, source: Mapping[str, str | None]) -> None:
        self._source = source

    def review_all(
        self, *, content: str, paragraphs: list[str], context_bundle: dict[str, Any] | None
    ) -> list[ReviewSubagentResult]:
        with ThreadPoolExecutor(max_workers=len(REVIEW_AGENT_KEYS)) as executor:
            futures = {
                key: executor.submit(self._review_one, key, content, paragraphs, context_bundle)
                for key in REVIEW_AGENT_KEYS
            }
            return [futures[key].result() for key in REVIEW_AGENT_KEYS]

    def _review_one(
        self,
        key: str,
        content: str,
        paragraphs: list[str],
        context_bundle: dict[str, Any] | None,
    ) -> ReviewSubagentResult:
        try:
            result = _call_llm(
                self._source,
                system_prompt=_review_system_prompt(key),
                user_prompt=_review_user_prompt(key, content, context_bundle),
            )
            issues = _parse_llm_issues(key, result.get("content"))
            return ReviewSubagentResult(
                agent=REVIEW_SKILLS[key].agent,
                mode="llm",
                issues=issues,
                model=_source_model(self._source),
                latency_ms=_optional_int(result.get("latency_ms")),
            )
        except (BookGenerationError, ValueError, TypeError, KeyError) as exc:
            fallback = _heuristic_result(key, content, paragraphs, context_bundle)
            return ReviewSubagentResult(
                agent=fallback.agent,
                mode="heuristic",
                issues=fallback.issues,
                degraded_reason=f"LLM 子代理降级：{_compact_text(str(exc), limit=240)}",
            )


def missing_book_generation_env(env: Mapping[str, str | None] | None = None) -> list[str]:
    return _missing_book_generation_env(env)


def resolved_llm_env(env: Mapping[str, str | None] | None = None) -> Mapping[str, str | None]:
    return _resolved_llm_env(env)


def _heuristic_result(
    key: str,
    content: str,
    paragraphs: list[str],
    context_bundle: dict[str, Any] | None,
) -> ReviewSubagentResult:
    if key == "plot":
        issues = plot_agent_issues(content, paragraphs)
    elif key == "character":
        issues = character_agent_issues(content, context_bundle)
    elif key == "prose":
        issues = prose_agent_issues(content, paragraphs)
    else:
        raise ValueError(f"未知审稿代理：{key}")
    return ReviewSubagentResult(agent=REVIEW_SKILLS[key].agent, mode="heuristic", issues=issues)


def _review_system_prompt(key: str) -> str:
    skill = REVIEW_SKILLS[key]
    return (
        f"你是 StoryForge 的 {skill.agent} 审稿代理，只评估：{skill.focus}。"
        "你必须只输出 JSON 数组，不要解释，不要 Markdown，不要代码块标记。"
    )


def _review_user_prompt(key: str, content: str, context_bundle: dict[str, Any] | None) -> str:
    return "\n".join(
        [
            f"审稿视角：{REVIEW_SKILLS[key].focus}",
            "",
            _context_prompt_block(context_bundle),
            "",
            "当前正文（可能已截断）：",
            "<<<FILE",
            _truncate_text(content, limit=_CONTENT_PROMPT_CHAR_BUDGET),
            "FILE>>>",
            "",
            "只输出 JSON 数组，每项必须是：",
            '{"severity":"high|medium|low","code":"短问题码","message":"问题说明","evidence":"原文片段"}',
            f"最多输出 {_MAX_LLM_ISSUES_PER_AGENT} 项；没有明确问题时输出 []。",
        ]
    )


def _context_prompt_block(context_bundle: dict[str, Any] | None) -> str:
    files = context_bundle.get("files") if isinstance(context_bundle, dict) else None
    context_files = [item for item in files if isinstance(item, dict)] if isinstance(files, list) else []
    if not context_files:
        return "项目上下文摘录：无。"

    entries = []
    for item in context_files[:6]:
        path = item.get("relative_path") or item.get("relativePath") or item.get("path") or "未命名文件"
        kind = item.get("kind") or "unknown"
        title = item.get("title") or ""
        excerpt = _compact_text(item.get("excerpt"), limit=300) or "无摘录。"
        entries.append(f"- {path}｜{kind}｜{title}\n  {excerpt}".strip())
    return "项目上下文摘录：\n" + "\n".join(entries)


def _parse_llm_issues(key: str, raw_content: object) -> list[dict[str, str]]:
    if not isinstance(raw_content, str) or not raw_content.strip():
        raise ValueError("LLM 返回内容为空。")
    parsed = _loads_json_array(raw_content)
    if not isinstance(parsed, list):
        raise ValueError("LLM 返回 JSON 不是数组。")

    issues: list[dict[str, str]] = []
    for item in parsed[:_MAX_LLM_ISSUES_PER_AGENT]:
        if isinstance(item, dict):
            issues.append(_normalize_issue(key, item))
    return issues


def _loads_json_array(raw_content: str) -> Any:
    """容忍模型把 JSON 数组裹进 ``` 代码块或夹在解释文字里。"""
    text = _strip_code_fence(raw_content.strip())
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        snippet = _extract_first_json_array(text)
        if snippet is None:
            raise
        return json.loads(snippet)


def _strip_code_fence(text: str) -> str:
    if not text.startswith("```"):
        return text
    lines = text.splitlines()
    if lines and lines[0].startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].strip().startswith("```"):
        lines = lines[:-1]
    return "\n".join(lines).strip()


def _extract_first_json_array(text: str) -> str | None:
    start = text.find("[")
    end = text.rfind("]")
    if start == -1 or end == -1 or end <= start:
        return None
    return text[start : end + 1]


def _normalize_issue(key: str, item: dict[str, Any]) -> dict[str, str]:
    severity = item.get("severity")
    severity_text = severity.strip().lower() if isinstance(severity, str) else ""
    if severity_text not in _VALID_SEVERITIES:
        severity_text = "medium"

    code = _compact_text(item.get("code"), limit=80) or f"{key}.llm_observation"
    message = _compact_text(item.get("message"), limit=240) or "LLM 审稿代理返回了未命名问题。"
    evidence = _compact_text(item.get("evidence"), limit=240) or "未提供原文证据。"
    return {
        "agent": REVIEW_SKILLS[key].agent,
        "severity": severity_text,
        "code": code,
        "message": message,
        "evidence": evidence,
    }


def _source_model(source: Mapping[str, str | None]) -> str | None:
    model = source.get("STORYFORGE_LLM_MODEL")
    return model.strip() if isinstance(model, str) and model.strip() else None


def _optional_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    return None


def _truncate_text(value: str, *, limit: int) -> str:
    text = value.strip()
    if len(text) <= limit:
        return text
    return f"{text[:limit].rstrip()}\n...[已截断]"


def _compact_text(value: object, *, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    text = " ".join(value.split())
    return text if len(text) <= limit else f"{text[:limit].rstrip()}..."
