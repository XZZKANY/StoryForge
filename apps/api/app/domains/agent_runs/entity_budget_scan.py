"""长篇实体预算静态检查：对单章结构化观察值产出 advisory 信号。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.domains.agent_runs.fs_tools import (
    FsToolError,
    _iter_project_files,
    _read_text,
    _resolve_root,
    _resolve_scoped,
)

_MAX_FILE_BYTES = 512_000

_DEFAULT_KEY_CHARACTERS = 5
_DEFAULT_CORE_LOCATIONS = 3
_DEFAULT_CORE_EVIDENCE = 3
_DEFAULT_MAJOR_REVERSALS = 2
_DEFAULT_NEW_CORE_ENTITIES_AFTER_CHAPTER_20 = 0
_DEFAULT_NEW_MYSTERIES_AFTER_CHAPTER_25 = 0


def _issue(rule: str, detail: str, *, snippet: str = "") -> dict[str, str]:
    return {
        "rule": rule,
        "severity": "高",
        "detail": detail,
        "snippet": snippet,
    }


def _chapter_ordinal(root: Path, target: Path, path: str) -> int:
    try:
        return _iter_project_files(root).index(target) + 1
    except ValueError as exc:
        raise FsToolError(f"文件不在项目阅读序中，无法推断章节序号：{path}") from exc


def _summary(chapter: int, issues: list[dict[str, str]]) -> str:
    if not issues:
        return f"第 {chapter} 章实体预算检查未发现风险信号；这是 advisory 参考，不是质量判定。"
    signals = "、".join(f"{item['rule']}（{item['severity']}）" for item in issues)
    return (
        f"第 {chapter} 章实体预算检查发现 {len(issues)} 个 advisory 信号：{signals}；"
        "请结合原文核实，不是质量判定。"
    )


def entity_budget_scan(
    project_root: str,
    path: str,
    *,
    chapter: int | None = None,
    new_key_characters: list[str] | None = None,
    new_core_locations: list[str] | None = None,
    new_core_evidence: list[str] | None = None,
    new_major_reversals: list[str] | None = None,
    new_mysteries: list[str] | None = None,
    new_equipment: list[str] | None = None,
    budget_key_characters: int = _DEFAULT_KEY_CHARACTERS,
    budget_core_locations: int = _DEFAULT_CORE_LOCATIONS,
    budget_core_evidence: int = _DEFAULT_CORE_EVIDENCE,
    budget_major_reversals: int = _DEFAULT_MAJOR_REVERSALS,
    budget_new_core_entities_after_chapter_20: int = _DEFAULT_NEW_CORE_ENTITIES_AFTER_CHAPTER_20,
    budget_new_mysteries_after_chapter_25: int = _DEFAULT_NEW_MYSTERIES_AFTER_CHAPTER_25,
) -> dict[str, Any]:
    """忠实执行 workflow EntityBudgetGate.validate 的阈值与数量预算规则。"""

    root = _resolve_root(project_root)
    target = _resolve_scoped(root, path)
    if not target.is_file():
        raise FsToolError(f"不是文件：{path}")
    target_relative = target.relative_to(root).as_posix()
    content = _read_text(target, max_bytes=_MAX_FILE_BYTES)
    if not content.strip():
        raise FsToolError(f"文件没有可检查的内容：{path}")

    resolved_chapter = chapter if chapter is not None else _chapter_ordinal(root, target, path)
    issues: list[dict[str, str]] = []

    if resolved_chapter >= 20 and new_core_locations:
        issues.append(
            _issue(
                "late_core_locations",
                f"chapter 20+新增核心地点: {', '.join(new_core_locations)}",
                snippet=", ".join(new_core_locations),
            )
        )
    if resolved_chapter >= 25 and new_mysteries:
        issues.append(
            _issue(
                "late_mysteries",
                f"chapter 25+新增新谜题: {', '.join(new_mysteries)}",
                snippet=", ".join(new_mysteries),
            )
        )
    late_evidence_or_equipment = [
        *(new_core_evidence or []),
        *(new_equipment or []),
    ]
    if resolved_chapter >= 30 and late_evidence_or_equipment:
        issues.append(
            _issue(
                "late_core_evidence_or_equipment",
                f"chapter 30新增设备型号/core evidence: {', '.join(late_evidence_or_equipment)}",
                snippet=", ".join(late_evidence_or_equipment),
            )
        )
    if new_key_characters is not None and len(new_key_characters) > budget_key_characters:
        issues.append(
            _issue(
                "key_characters_over_budget",
                "新增关键人物超过默认预算。",
                snippet=", ".join(new_key_characters),
            )
        )
    if new_core_locations is not None and len(new_core_locations) > budget_core_locations:
        issues.append(
            _issue(
                "core_locations_over_budget",
                "新增核心地点超过默认预算。",
                snippet=", ".join(new_core_locations),
            )
        )
    if new_core_evidence is not None and len(new_core_evidence) > budget_core_evidence:
        issues.append(
            _issue(
                "core_evidence_over_budget",
                "新增核心证据超过默认预算。",
                snippet=", ".join(new_core_evidence),
            )
        )
    if new_major_reversals is not None and len(new_major_reversals) > budget_major_reversals:
        issues.append(
            _issue(
                "major_reversals_over_budget",
                "重大反转超过默认预算。",
                snippet=", ".join(new_major_reversals),
            )
        )

    # EntityBudgetGate.validate 当前不消费这两个字段；保留参数面但不发明新规则。
    _ = budget_new_core_entities_after_chapter_20, budget_new_mysteries_after_chapter_25

    status = "warn" if issues else "pass"
    return {
        "path": target_relative,
        "chapter": resolved_chapter,
        "verdict": {"status": status, "issues": issues},
        "summary": _summary(resolved_chapter, issues),
    }
