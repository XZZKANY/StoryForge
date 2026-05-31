from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class NovelLoopRequest:
    """单章 NovelLoop 的最小输入，引用 API 真相源中的章节目标。"""

    book_id: int
    chapter_id: int
    chapter_index: int
    chapter_goal: str


@dataclass(frozen=True)
class NovelLoopResult:
    """单章生成结果，保留 9A 审计链所需的关键引用。"""

    status: str
    final_draft: str
    source_model_run_id: int | None
    judge_report_id: int | None
    repair_patch_id: int | None
    approved_scene_id: int | None
    token_usage: int = 0
    elapsed_time_sec: int = 0
    cost_estimate: float = 0.0
    fallback_metadata: dict[str, object] | None = None
    memory_atom_ids: list[str] = field(default_factory=list)


def _skip_memory_extraction(request: NovelLoopRequest, draft: str, approved_scene_id: int) -> list[str]:
    """默认不抽取记忆，生产 adapter 或测试可注入真实实现。"""

    return []


def _skip_static_quality(draft: str) -> list[Any]:
    """默认不做静态质量检查，保持旧调用方无需改造。"""

    return []


@dataclass(frozen=True)
class NovelLoopPorts:
    """NovelLoop 外部依赖端口，测试和生产 adapter 都可注入。"""

    compile_context: Callable[[NovelLoopRequest], str]
    generate_scene: Callable[[NovelLoopRequest, str], str]
    judge_scene: Callable[[str, int], dict[str, Any]]
    repair_scene: Callable[[str, dict[str, Any], int], str]
    approve_scene: Callable[[NovelLoopRequest, str, dict[str, Any]], int]
    record_model_run: Callable[[NovelLoopRequest, str], int]
    extract_memory: Callable[[NovelLoopRequest, str, int], list[str]] = _skip_memory_extraction
    check_static_quality: Callable[[str], list[Any]] = _skip_static_quality


def run_single_chapter_loop(
    request: NovelLoopRequest,
    ports: NovelLoopPorts,
    *,
    max_repairs: int = 1,
) -> NovelLoopResult:
    """执行单章 compile -> generate -> judge -> repair -> approve 闭环。"""

    context_id = ports.compile_context(request)
    draft = ports.generate_scene(request, context_id)
    model_run_id = ports.record_model_run(request, draft)
    latest_report: dict[str, Any] = {}
    latest_repair_patch_id: int | None = None
    static_quality_checked = False

    for attempt in range(max_repairs + 1):
        latest_report = ports.judge_scene(draft, attempt)
        judge_report_id = _optional_int(latest_report.get("judge_report_id"))
        static_issues = [] if static_quality_checked else _static_issues(ports.check_static_quality(draft))
        static_quality_checked = True
        if _has_severe_static_issue(static_issues):
            latest_report = {
                **latest_report,
                "status": "awaiting_review",
                "static_quality_issues": static_issues,
            }
            break
        if latest_report.get("status") == "pass" and not static_issues:
            approved_scene_id = ports.approve_scene(
                request,
                draft,
                {"source_model_run_id": model_run_id, "judge_report_id": judge_report_id},
            )
            memory_atom_ids = ports.extract_memory(request, draft, approved_scene_id)
            return NovelLoopResult(
                status="approved",
                final_draft=draft,
                source_model_run_id=model_run_id,
                judge_report_id=judge_report_id,
                repair_patch_id=latest_repair_patch_id,
                approved_scene_id=approved_scene_id,
                memory_atom_ids=list(memory_atom_ids),
            )
        latest_repair_patch_id = _optional_int(latest_report.get("repair_patch_id"))
        if attempt < max_repairs:
            repair_report = latest_report
            if static_issues:
                repair_report = {
                    **latest_report,
                    "status": "repair",
                    "static_quality_issues": static_issues,
                    "issues": [*_issue_lines(latest_report), *_static_issue_lines(static_issues)],
                }
            draft = ports.repair_scene(draft, repair_report, attempt + 1)

    return NovelLoopResult(
        status="awaiting_review",
        final_draft=draft,
        source_model_run_id=model_run_id,
        judge_report_id=_optional_int(latest_report.get("judge_report_id")),
        repair_patch_id=latest_repair_patch_id,
        approved_scene_id=None,
    )


def _static_issues(raw_issues: list[Any]) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    for issue in raw_issues or []:
        if isinstance(issue, dict):
            issues.append(dict(issue))
        elif hasattr(issue, "as_report_item"):
            issues.append(dict(issue.as_report_item()))
        else:
            issues.append(
                {
                    "dimension": str(getattr(issue, "dimension", "质量")),
                    "severity": str(getattr(issue, "severity", "中")),
                    "snippet": str(getattr(issue, "snippet", "")),
                    "message": str(getattr(issue, "message", "")),
                    "suggestion": str(getattr(issue, "suggestion", "")),
                    "revision_strategy": str(getattr(issue, "revision_strategy", "scene_patch")),
                }
            )
    return issues


def _has_severe_static_issue(issues: list[dict[str, Any]]) -> bool:
    return any(str(issue.get("severity")) in {"高", "严重"} for issue in issues)


def _static_issue_lines(issues: list[dict[str, Any]]) -> list[str]:
    return [
        "｜".join(
            (
                str(issue.get("dimension", "质量")),
                str(issue.get("severity", "中")),
                str(issue.get("snippet", "")),
                str(issue.get("message", "")),
                str(issue.get("revision_strategy", "scene_patch")),
                "",
                "",
                str(issue.get("suggestion", "")),
            )
        )
        for issue in issues
    ]


def _issue_lines(report: dict[str, Any]) -> list[str]:
    raw = report.get("issues")
    if isinstance(raw, list):
        return [str(item) for item in raw if str(item)]
    return []


def _optional_int(value: Any) -> int | None:
    if value is None:
        return None
    return int(value)
