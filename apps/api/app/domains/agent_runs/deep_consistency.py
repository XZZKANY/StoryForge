"""深度一致性评审：语义 judge 对照本地 Character Bible 检查单个稿件。

project.consistency 只报机械观察；本模块是语义线——把目标稿件与项目内
人物 / 设定文件（本地 Character Bible）喂给 judge 域语义评审，产出结构化
issue 信号。信号是 advisory：不写盘、不落 judge DB 实体，结论由循环 LLM
结合原文复核后再回给作者。未配置 LLM 或远程失败时显式报错，不伪造「无问题」。
路径边界复用 fs_tools（同包私有复用，先例见 consistency_scan）。
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from typing import Any

from app.common.llm_env import resolved_llm_env
from app.common.llm_http import env_value
from app.domains.agent_runs.fs_tools import (
    FsToolError,
    _iter_project_files,
    _read_text,
    _resolve_root,
    _resolve_scoped,
)
from app.domains.judge.schemas import JudgeIssueCreate
from app.domains.judge.semantic import semantic_judge_with_status

# 人物目录喂「角色声音约束」槽位，其余设定文件喂「必含事实」槽位，对齐 judge prompt 的类别触发条件。
_CHARACTER_DIR = "人物"
_DEFAULT_BIBLE_DIRS = ("人物", "设定")
_MAX_BIBLE_FILES = 12
_BIBLE_FILE_CHAR_BUDGET = 2_000
_BIBLE_TOTAL_CHAR_BUDGET = 12_000
_CONTENT_CHAR_BUDGET = 24_000
_MAX_FACTS = 40
_MAX_FILE_BYTES = 512_000


def _line_of(content: str, span: int) -> int:
    return content.count("\n", 0, max(0, min(span, len(content)))) + 1


def _clean_facts(facts: list[str] | None) -> tuple[list[str], bool]:
    if not facts:
        return [], False
    cleaned: list[str] = []
    for fact in facts:
        if not isinstance(fact, str):
            continue
        stripped = fact.strip()
        if stripped and stripped not in cleaned:
            cleaned.append(stripped)
    return cleaned[:_MAX_FACTS], len(cleaned) > _MAX_FACTS


def deep_consistency_review(
    project_root: str,
    path: str,
    *,
    bible_paths: list[str] | None = None,
    facts: list[str] | None = None,
    llm_env: Mapping[str, str | None] | None = None,
) -> dict[str, Any]:
    """对单个稿件执行语义一致性评审，返回 advisory issue 信号。"""

    root = _resolve_root(project_root)
    target = _resolve_scoped(root, path)
    if not target.is_file():
        raise FsToolError(f"不是文件：{path}")
    target_relative = target.relative_to(root).as_posix()

    source = resolved_llm_env(llm_env)
    if not (os.getenv("STORYFORGE_JUDGE_LLM_API_KEY") or env_value(source, "STORYFORGE_LLM_API_KEY")):
        raise FsToolError("语义评审未配置 LLM（缺 API key）：请先在设置里配置模型服务，再做深度一致性检查。")

    raw_content = _read_text(target, max_bytes=_MAX_FILE_BYTES)
    if not raw_content.strip():
        raise FsToolError(f"文件没有可评审的内容：{path}")
    content = raw_content[:_CONTENT_CHAR_BUDGET]
    content_truncated = len(raw_content) > _CONTENT_CHAR_BUDGET

    bible_files, bible_truncated = _collect_bible_files(root, bible_paths, exclude=target_relative)

    required_facts, facts_truncated = _clean_facts(facts)
    voice_constraints: list[dict[str, Any]] = []
    for entry in bible_files:
        if entry["path"].split("/", 1)[0] == _CHARACTER_DIR:
            voice_constraints.append({"name": entry["name"], "path": entry["path"], "notes": entry["excerpt"]})
        elif len(required_facts) < 100:
            required_facts.append(f"《{entry['path']}》设定：{entry['excerpt']}")

    payload = JudgeIssueCreate(
        scene_id=1,
        scene_packet_id=None,
        content=content,
        required_facts=required_facts,
        style_rules=[],
        evidence_links=[{"source": "project_file", "path": entry["path"]} for entry in bible_files[:50]],
    )
    outcome = semantic_judge_with_status(
        payload,
        character_voice_constraints=voice_constraints or None,
        llm_env=source,
    )
    if outcome.failed:
        raise FsToolError("语义评审模型调用失败（网络 / 超时 / 响应异常），本轮没有产出结论；可稍后重试。")

    issues = [
        {
            "category": issue.category,
            "severity": issue.severity,
            "line_start": _line_of(content, issue.span_start),
            "line_end": _line_of(content, issue.span_end),
            "span_start": issue.span_start,
            "span_end": issue.span_end,
            "summary": issue.summary,
            "matched_text": issue.matched_text,
            "expected_text": issue.expected_text,
            "replacement_text": issue.replacement_text,
        }
        for issue in outcome.issues
    ]
    return {
        "path": target_relative,
        "content_chars": len(content),
        "content_truncated": content_truncated,
        "bible_files": [
            {"path": entry["path"], "chars": entry["chars"], "truncated": entry["truncated"]}
            for entry in bible_files
        ],
        "bible_truncated": bible_truncated,
        "fact_count": len(required_facts),
        "facts_truncated": facts_truncated,
        "issue_count": len(issues),
        "issues": issues,
        "note": "语义评审是参考信号：回给作者前请抽读对应行核实；修改仍需走待确认补丁流程。",
    }


def _collect_bible_files(
    root: Any,
    bible_paths: list[str] | None,
    *,
    exclude: str,
) -> tuple[list[dict[str, Any]], bool]:
    """收集 Character Bible 文件摘录：显式路径优先，否则扫默认 人物/ 设定/ 目录。"""

    candidates: list[Any] = []
    truncated = False
    if bible_paths:
        for raw in bible_paths:
            if not isinstance(raw, str) or not raw.strip():
                continue
            resolved = _resolve_scoped(root, raw.strip())
            if not resolved.is_file():
                raise FsToolError(f"不是文件：{raw.strip()}")
            candidates.append(resolved)
    else:
        for candidate in _iter_project_files(root):
            relative = candidate.relative_to(root)
            if relative.parts and relative.parts[0] in _DEFAULT_BIBLE_DIRS and candidate.match("*.md"):
                candidates.append(candidate)

    entries: list[dict[str, Any]] = []
    total_chars = 0
    for candidate in candidates:
        relative = candidate.relative_to(root).as_posix()
        if relative == exclude:
            continue
        if len(entries) >= _MAX_BIBLE_FILES or total_chars >= _BIBLE_TOTAL_CHAR_BUDGET:
            truncated = True
            break
        try:
            text = _read_text(candidate, max_bytes=_MAX_FILE_BYTES)
        except FsToolError:
            if bible_paths:
                raise
            continue
        budget = min(_BIBLE_FILE_CHAR_BUDGET, _BIBLE_TOTAL_CHAR_BUDGET - total_chars)
        excerpt = text[:budget]
        entries.append(
            {
                "name": candidate.stem,
                "path": relative,
                "excerpt": excerpt,
                "chars": len(excerpt),
                "truncated": len(text) > budget,
            }
        )
        total_chars += len(excerpt)
    return entries, truncated
