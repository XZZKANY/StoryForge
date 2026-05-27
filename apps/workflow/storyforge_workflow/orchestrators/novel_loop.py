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

    for attempt in range(max_repairs + 1):
        latest_report = ports.judge_scene(draft, attempt)
        judge_report_id = _optional_int(latest_report.get("judge_report_id"))
        if latest_report.get("status") == "pass":
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
            draft = ports.repair_scene(draft, latest_report, attempt + 1)

    return NovelLoopResult(
        status="awaiting_review",
        final_draft=draft,
        source_model_run_id=model_run_id,
        judge_report_id=_optional_int(latest_report.get("judge_report_id")),
        repair_patch_id=latest_repair_patch_id,
        approved_scene_id=None,
    )


def _optional_int(value: Any) -> int | None:
    if value is None:
        return None
    return int(value)
