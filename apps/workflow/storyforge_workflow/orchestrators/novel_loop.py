from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol


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
    skill_runs: tuple[dict[str, Any], ...] = ()


def _skip_memory_extraction(request: NovelLoopRequest, draft: str, approved_scene_id: int) -> list[str]:
    """默认不抽取记忆，生产 adapter 或测试可注入真实实现。"""

    return []


def _skip_static_quality_check(draft: str) -> list[dict[str, Any]]:
    """????????????????????????"""

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
    check_static_quality: Callable[[str], Sequence[dict[str, Any] | object]] = _skip_static_quality_check


class NovelSkillRunnerPort(Protocol):
    """NovelLoop 所需的技能 runner 最小协议，避免与 skills.runner 形成循环导入。"""

    def run_generate(
        self,
        *,
        request: NovelLoopRequest,
        context_id: str,
        generate_scene: Callable[[NovelLoopRequest, str], str],
        record_model_run: Callable[[NovelLoopRequest, str], int],
    ) -> tuple[str, int]: ...

    def run_judge(
        self,
        *,
        draft: str,
        attempt: int,
        judge_scene: Callable[[str, int], dict[str, Any]],
    ) -> dict[str, Any]: ...

    def run_repair(
        self,
        *,
        draft: str,
        report: Mapping[str, Any],
        attempt: int,
        repair_scene: Callable[[str, Mapping[str, Any], int], str],
    ) -> str: ...

    def run_approve(
        self,
        *,
        request: NovelLoopRequest,
        draft: str,
        refs: Mapping[str, Any],
        approve_scene: Callable[[NovelLoopRequest, str, dict[str, Any]], int],
    ) -> int: ...

    def run_memory_extract(
        self,
        *,
        request: NovelLoopRequest,
        draft: str,
        approved_scene_id: int,
        extract_memory: Callable[[NovelLoopRequest, str, int], list[str]],
    ) -> list[str]: ...


def run_single_chapter_loop(
    request: NovelLoopRequest,
    ports: NovelLoopPorts,
    *,
    max_repairs: int = 1,
    skill_runner: NovelSkillRunnerPort | None = None,
) -> NovelLoopResult:
    """执行单章 compile -> generate -> judge -> repair -> approve 闭环。"""

    context_id = ports.compile_context(request)
    if skill_runner is None:
        draft = ports.generate_scene(request, context_id)
        model_run_id = ports.record_model_run(request, draft)
    else:
        draft, model_run_id = skill_runner.run_generate(
            request=request,
            context_id=context_id,
            generate_scene=ports.generate_scene,
            record_model_run=ports.record_model_run,
        )
    latest_report: dict[str, Any] = {}
    latest_repair_patch_id: int | None = None

    for attempt in range(max_repairs + 1):
        static_issues = [_issue_to_dict(issue) for issue in ports.check_static_quality(draft)]
        if _has_high_severity(static_issues):
            latest_report = {"status": "awaiting_review", "static_quality_issues": static_issues}
            break
        if static_issues and attempt < max_repairs:
            latest_report = {"status": "repair", "static_quality_issues": static_issues}
            draft = _run_repair(skill_runner, ports, draft, latest_report, attempt + 1)
            continue

        if skill_runner is None:
            latest_report = ports.judge_scene(draft, attempt)
        else:
            latest_report = skill_runner.run_judge(draft=draft, attempt=attempt, judge_scene=ports.judge_scene)
        judge_report_id = _optional_int(latest_report.get("judge_report_id"))
        if latest_report.get("status") == "pass":
            refs = {"source_model_run_id": model_run_id, "judge_report_id": judge_report_id}
            if skill_runner is None:
                approved_scene_id = ports.approve_scene(request, draft, refs)
                memory_atom_ids = ports.extract_memory(request, draft, approved_scene_id)
            else:
                approved_scene_id = skill_runner.run_approve(
                    request=request,
                    draft=draft,
                    refs=refs,
                    approve_scene=ports.approve_scene,
                )
                memory_atom_ids = skill_runner.run_memory_extract(
                    request=request,
                    draft=draft,
                    approved_scene_id=approved_scene_id,
                    extract_memory=ports.extract_memory,
                )
            return NovelLoopResult(
                status="approved",
                final_draft=draft,
                source_model_run_id=model_run_id,
                judge_report_id=judge_report_id,
                repair_patch_id=latest_repair_patch_id,
                approved_scene_id=approved_scene_id,
                memory_atom_ids=list(memory_atom_ids),
                skill_runs=_skill_run_audit(skill_runner),
            )
        latest_repair_patch_id = _optional_int(latest_report.get("repair_patch_id"))
        if attempt < max_repairs:
            draft = _run_repair(skill_runner, ports, draft, latest_report, attempt + 1)

    return NovelLoopResult(
        status="awaiting_review",
        final_draft=draft,
        source_model_run_id=model_run_id,
        judge_report_id=_optional_int(latest_report.get("judge_report_id")),
        repair_patch_id=latest_repair_patch_id,
        approved_scene_id=None,
        skill_runs=_skill_run_audit(skill_runner),
    )


def _optional_int(value: Any) -> int | None:
    if value is None:
        return None
    return int(value)


def _run_repair(
    skill_runner: NovelSkillRunnerPort | None,
    ports: NovelLoopPorts,
    draft: str,
    report: dict[str, Any],
    attempt: int,
) -> str:
    if skill_runner is None:
        return ports.repair_scene(draft, report, attempt)
    return skill_runner.run_repair(draft=draft, report=report, attempt=attempt, repair_scene=ports.repair_scene)


def _skill_run_audit(skill_runner: NovelSkillRunnerPort | None) -> tuple[dict[str, Any], ...]:
    if skill_runner is None or not hasattr(skill_runner, "runs"):
        return ()
    return tuple(run.to_audit_dict() for run in skill_runner.runs)


def _issue_to_dict(issue: dict[str, Any] | object) -> dict[str, Any]:
    if isinstance(issue, dict):
        return dict(issue)
    return {
        "dimension": getattr(issue, "dimension", ""),
        "severity": getattr(issue, "severity", ""),
        "snippet": getattr(issue, "snippet", ""),
        "message": getattr(issue, "message", ""),
        "suggestion": getattr(issue, "suggestion", ""),
        "revision_strategy": getattr(issue, "revision_strategy", "line_edit"),
    }


def _has_high_severity(issues: Sequence[dict[str, Any]]) -> bool:
    high = {"\u9ad8", "high", "critical", "severe"}
    return any(str(issue.get("severity", "")).strip().lower() in high or issue.get("revision_strategy") == "regenerate" for issue in issues)
