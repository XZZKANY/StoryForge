from __future__ import annotations

import os
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from threading import Lock
from typing import Any, Protocol

from storyforge_workflow.orchestrators.book_loop import (
    BookLoopRequest,
    BookLoopResult,
    ChapterExecutionError,
    ConsistencyBarrier,
    run_book_loop,
)
from storyforge_workflow.orchestrators.novel_loop import (
    NovelLoopPorts,
    NovelLoopRequest,
    NovelLoopResult,
    run_single_chapter_loop,
)
from storyforge_workflow.quality.arc_consistency import ArcConsistencyBarrier
from storyforge_workflow.skills.runner import NovelSkillRunner

MemoryExtractor = Callable[[NovelLoopRequest, str, int], list[str]]
ContinuitySubmitter = Callable[[NovelLoopRequest, str, int], dict[str, Any]]


@dataclass(frozen=True)
class BookRunChapterRange:
    """卷计划中的章节范围。"""

    start: int
    end: int


@dataclass(frozen=True)
class BookRunVolumePlanItem:
    """workflow 消费的卷计划项。"""

    volume_index: int
    chapter_range: BookRunChapterRange


@dataclass(frozen=True)
class BookRunAdapterRequest:
    """workflow adapter 接收的 BookRun 执行输入，不包含 API ORM 对象。"""

    book_run_id: int
    book_id: int
    blueprint_id: int
    total_chapters: int
    start_chapter_index: int = 1
    existing_checkpoint: list[dict[str, Any]] = field(default_factory=list)
    token_budget: int | None = None
    time_budget_sec: int | None = None
    chapter_budget: int | None = None
    provider_fallback_pause_threshold: int | None = None
    chapter_parallelism: int = 1
    require_budget_guard_before_prefetch: bool = False
    volume_plan: list[BookRunVolumePlanItem | dict[str, Any]] = field(default_factory=list)
    narrative_plan: dict[str, Any] | None = None
    chapter_beats: list[dict[str, Any]] = field(default_factory=list)
    entity_budget: dict[str, Any] | None = None
    phase_policy: dict[str, Any] | None = None
    beat_sheet_gate: dict[str, Any] | None = None
    narrative_risk_summary: dict[str, Any] | None = None


class BookRunProgressSink(Protocol):
    """BookRun progress 回填边界，可由测试、本地 service adapter 或 HTTP adapter 实现。"""

    def emit(
        self,
        *,
        book_run_id: int,
        status: str,
        current_chapter_index: int,
        progress: dict[str, Any],
        volume_progress: dict[str, Any] | None = None,
    ) -> None: ...


@dataclass(frozen=True)
class BookRunAdapterPorts:
    """adapter 外部依赖端口，避免 workflow 直接依赖 API 数据库。"""

    chapter_goal: Callable[[int], str]
    chapter_id: Callable[[int], int]
    novel_loop_ports_factory: Callable[[NovelLoopRequest], NovelLoopPorts]
    progress_sink: BookRunProgressSink
    memory_extractor: MemoryExtractor | None = None
    continuity_submitter: ContinuitySubmitter | None = None
    consistency_barrier: ConsistencyBarrier | None = None
    chapter_planning_refs: Callable[[int], dict[str, Any] | None] | None = None


class CapturingProgressSink:
    """测试用 progress sink，记录 adapter 回填 payload。"""

    def __init__(self) -> None:
        self.payloads: list[dict[str, Any]] = []

    def emit(
        self,
        *,
        book_run_id: int,
        status: str,
        current_chapter_index: int,
        progress: dict[str, Any],
        volume_progress: dict[str, Any] | None = None,
    ) -> None:
        payload = {
            "book_run_id": book_run_id,
            "status": status,
            "current_chapter_index": current_chapter_index,
            "progress": progress,
        }
        if volume_progress is not None:
            payload["volume_progress"] = volume_progress
        self.payloads.append(payload)


class CallableProgressSink:
    """把标准 progress payload 转交给 HTTP、队列或本地 service adapter。"""

    def __init__(self, send: Callable[[dict[str, Any]], None]) -> None:
        self._send = send

    def emit(
        self,
        *,
        book_run_id: int,
        status: str,
        current_chapter_index: int,
        progress: dict[str, Any],
        volume_progress: dict[str, Any] | None = None,
    ) -> None:
        payload = {
            "book_run_id": book_run_id,
            "status": status,
            "current_chapter_index": current_chapter_index,
            "progress": progress,
        }
        if volume_progress is not None:
            payload["volume_progress"] = volume_progress
        self._send(payload)


def run_book_run_dispatch_payload(
    payload: Mapping[str, Any],
    novel_loop_ports_factory: Callable[[NovelLoopRequest], NovelLoopPorts],
    progress_sink: BookRunProgressSink,
    consistency_barrier: ConsistencyBarrier | None = None,
    memory_extractor: MemoryExtractor | None = None,
    continuity_submitter: ContinuitySubmitter | None = None,
) -> BookLoopResult:
    """消费 API 生成的 dispatch payload，运行 BookRun adapter 并回填 progress。"""

    narrative_plan = _locked_narrative_plan_or_raise(payload.get("narrative_plan"))
    entity_budget = _mapping_summary(payload.get("entity_budget")) or _mapping_summary(narrative_plan.get("entity_budget"))
    phase_policy = _mapping_summary(payload.get("phase_policy")) or _mapping_summary(narrative_plan.get("phase_policy"))
    beat_sheet_gate = _mapping_summary(payload.get("beat_sheet_gate")) or _mapping_summary(
        narrative_plan.get("beat_sheet_gate")
    )
    narrative_risk_summary = _mapping_summary(payload.get("narrative_risk_summary")) or _mapping_summary(
        narrative_plan.get("narrative_risk_summary")
    )
    chapters = _chapter_dispatch_map(payload.get("chapters"))
    request = BookRunAdapterRequest(
        book_run_id=_required_int(payload, "book_run_id"),
        book_id=_required_int(payload, "book_id"),
        blueprint_id=_required_int(payload, "blueprint_id"),
        total_chapters=_required_int(payload, "total_chapters"),
        start_chapter_index=_int_or_default(payload.get("start_chapter_index"), 1),
        existing_checkpoint=list(_list_or_empty(payload.get("existing_checkpoint"))),
        token_budget=_optional_positive_int(payload.get("token_budget")),
        time_budget_sec=_optional_positive_int(payload.get("time_budget_sec")),
        chapter_budget=_optional_positive_int(payload.get("chapter_budget")),
        provider_fallback_pause_threshold=_optional_positive_int(payload.get("provider_fallback_pause_threshold")),
        chapter_parallelism=_optional_positive_int(payload.get("chapter_parallelism")) or _env_chapter_parallelism(),
        require_budget_guard_before_prefetch=_bool_value(
            payload.get("require_budget_guard_before_prefetch"),
            default=_env_budget_guard_before_prefetch(),
        ),
        volume_plan=_volume_plan_or_single(payload.get("volume_plan"), _required_int(payload, "total_chapters")),
        narrative_plan=_narrative_plan_progress_summary(narrative_plan, beat_sheet_gate=beat_sheet_gate),
        chapter_beats=_chapter_beats_summary(narrative_plan),
        entity_budget=entity_budget,
        phase_policy=phase_policy,
        beat_sheet_gate=beat_sheet_gate,
        narrative_risk_summary=narrative_risk_summary,
    )
    required_indexes = range(request.start_chapter_index, request.total_chapters + 1)
    missing = [index for index in required_indexes if index not in chapters]
    if missing:
        raise ValueError("BookRun dispatch payload 缺少待执行章节映射。")
    barrier = consistency_barrier or _build_arc_barrier_if_planning_present(chapters)
    ports = BookRunAdapterPorts(
        chapter_goal=lambda chapter_index: chapters[chapter_index]["chapter_goal"],
        chapter_id=lambda chapter_index: chapters[chapter_index]["chapter_id"],
        novel_loop_ports_factory=novel_loop_ports_factory,
        progress_sink=progress_sink,
        memory_extractor=memory_extractor,
        continuity_submitter=continuity_submitter,
        consistency_barrier=barrier,
        chapter_planning_refs=lambda chapter_index: chapters[chapter_index].get("planning_refs"),
    )
    return run_book_run_with_skill_runner(request, ports)


def run_book_run_with_skill_runner(request: BookRunAdapterRequest, ports: BookRunAdapterPorts) -> BookLoopResult:
    """运行 BookLoop，并在每章 NovelLoop 中注入 NovelSkillRunner 记录真实技能运行。"""

    book_loop_request = BookLoopRequest(
        book_run_id=request.book_run_id,
        book_id=request.book_id,
        blueprint_id=request.blueprint_id,
        total_chapters=request.total_chapters,
        start_chapter_index=request.start_chapter_index,
        existing_checkpoint=list(request.existing_checkpoint),
        token_budget=request.token_budget,
        time_budget_sec=request.time_budget_sec,
        chapter_budget=request.chapter_budget,
        provider_fallback_pause_threshold=request.provider_fallback_pause_threshold,
        chapter_parallelism=request.chapter_parallelism,
        require_budget_guard_before_prefetch=request.require_budget_guard_before_prefetch,
    )
    _emit_result_progress(
        request,
        ports,
        BookLoopResult(
            status="running",
            current_chapter_index=request.start_chapter_index,
            progress={
                "completed_chapters": list(request.existing_checkpoint),
                "checkpoint": list(request.existing_checkpoint),
                "budget": _budget_from_checkpoint(request.existing_checkpoint),
                "dispatch": {"stage": "scheduled", "start_chapter_index": request.start_chapter_index},
            },
        ),
    )

    defer_commit_side_effects = ports.memory_extractor is not None or ports.continuity_submitter is not None
    novel_requests_by_chapter: dict[int, NovelLoopRequest] = {}
    novel_ports_by_chapter: dict[int, NovelLoopPorts] = {}
    novel_loop_cache_lock = Lock()

    def novel_request_for_chapter(chapter_index: int) -> NovelLoopRequest:
        return NovelLoopRequest(
            book_id=request.book_id,
            chapter_id=ports.chapter_id(chapter_index),
            chapter_index=chapter_index,
            chapter_goal=ports.chapter_goal(chapter_index),
            planning_refs=ports.chapter_planning_refs(chapter_index) if ports.chapter_planning_refs else None,
            current_chapter_beat=_chapter_beat_for_index(request, chapter_index),
            phase_policy_summary=dict(request.phase_policy) if request.phase_policy is not None else None,
            entity_budget_summary=dict(request.entity_budget) if request.entity_budget is not None else None,
        )

    def run_chapter(chapter_index: int):
        novel_request = novel_request_for_chapter(chapter_index)
        novel_ports = ports.novel_loop_ports_factory(novel_request)
        with novel_loop_cache_lock:
            novel_requests_by_chapter[chapter_index] = novel_request
            novel_ports_by_chapter[chapter_index] = novel_ports
        runner = NovelSkillRunner.default()
        return run_single_chapter_loop(
            novel_request,
            _novel_loop_ports_with_injected_ports(novel_ports, ports),
            skill_runner=runner,
            defer_commit_side_effects=defer_commit_side_effects,
        )

    latest_progress = BookLoopResult(
        status="running",
        current_chapter_index=max(1, request.start_chapter_index),
        progress={
            "completed_chapters": list(request.existing_checkpoint),
            "checkpoint": list(request.existing_checkpoint),
            "budget": _budget_from_checkpoint(request.existing_checkpoint),
        },
    )

    def emit_chapter_progress(progress_result: BookLoopResult) -> None:
        nonlocal latest_progress
        latest_progress = progress_result
        _emit_result_progress(
            request,
            ports,
            _with_dispatch(
                progress_result, {"stage": "chapter_completed", "chapter_index": progress_result.current_chapter_index}
            ),
        )

    def commit_chapter_side_effects(
        chapter_index: int,
        chapter_result: NovelLoopResult,
        committed_chapters: list[dict[str, Any]],
    ) -> NovelLoopResult:
        with novel_loop_cache_lock:
            novel_request = novel_requests_by_chapter.get(chapter_index)
            novel_ports = novel_ports_by_chapter.get(chapter_index)
        if novel_request is None:
            novel_request = novel_request_for_chapter(chapter_index)
        if novel_ports is None:
            novel_ports = ports.novel_loop_ports_factory(novel_request)
        injected_ports = _novel_loop_ports_with_injected_ports(novel_ports, ports)
        runner = NovelSkillRunner.default()
        memory_atom_ids = runner.run_memory_extract(
            request=novel_request,
            draft=chapter_result.final_draft,
            approved_scene_id=chapter_result.approved_scene_id or 0,
            extract_memory=injected_ports.extract_memory,
        )
        continuity_result = runner.run_submit_continuity(
            request=novel_request,
            draft=chapter_result.final_draft,
            approved_scene_id=chapter_result.approved_scene_id or 0,
            submit_continuity=injected_ports.submit_continuity,
        )
        return _with_committed_side_effects(chapter_result, memory_atom_ids, continuity_result, runner)

    try:
        result = run_book_loop(
            book_loop_request,
            run_chapter,
            progress_callback=emit_chapter_progress,
            consistency_barrier=ports.consistency_barrier,
            commit_chapter_side_effects=commit_chapter_side_effects if defer_commit_side_effects else None,
        )
    except ChapterExecutionError as exc:
        _emit_result_progress(
            request,
            ports,
            _failed_result_from_exception(request, latest_progress, exc.chapter_index, exc),
            suppress_errors=True,
        )
        raise exc.original from exc
    except Exception as exc:
        _emit_result_progress(
            request,
            ports,
            _failed_result_from_exception(request, latest_progress, latest_progress.current_chapter_index, exc),
            suppress_errors=True,
        )
        raise
    result = _with_dispatch(result, {"stage": result.status})
    _emit_result_progress(request, ports, result)
    return result


def _emit_result_progress(
    request: BookRunAdapterRequest,
    ports: BookRunAdapterPorts,
    result: BookLoopResult,
    *,
    suppress_errors: bool = False,
) -> None:
    try:
        progress = _with_narrative_progress(request, result.progress)
        ports.progress_sink.emit(
            book_run_id=request.book_run_id,
            status=result.status,
            current_chapter_index=result.current_chapter_index,
            progress=progress,
            volume_progress=_volume_progress_from_result(request, result),
        )
    except Exception:
        if suppress_errors:
            return
        raise


def _with_dispatch(result: BookLoopResult, dispatch: dict[str, Any]) -> BookLoopResult:
    progress = dict(result.progress)
    progress["dispatch"] = dispatch
    return BookLoopResult(status=result.status, current_chapter_index=result.current_chapter_index, progress=progress)


def _with_committed_side_effects(
    chapter_result: NovelLoopResult,
    memory_atom_ids: list[str],
    continuity_result: dict[str, Any],
    runner: NovelSkillRunner,
) -> NovelLoopResult:
    return NovelLoopResult(
        status=chapter_result.status,
        final_draft=chapter_result.final_draft,
        source_model_run_id=chapter_result.source_model_run_id,
        judge_report_id=chapter_result.judge_report_id,
        repair_patch_id=chapter_result.repair_patch_id,
        approved_scene_id=chapter_result.approved_scene_id,
        token_usage=chapter_result.token_usage,
        elapsed_time_sec=chapter_result.elapsed_time_sec,
        cost_estimate=chapter_result.cost_estimate,
        fallback_metadata=chapter_result.fallback_metadata,
        memory_atom_ids=list(memory_atom_ids),
        continuity_edge_count=_positive_int_or_zero(continuity_result.get("continuity_edge_count")),
        skill_runs=tuple([*chapter_result.skill_runs, *(run.to_audit_dict() for run in runner.runs)]),
    )


def _with_narrative_progress(request: BookRunAdapterRequest, progress: Mapping[str, Any]) -> dict[str, Any]:
    enriched = dict(progress)
    if request.narrative_plan is not None:
        enriched["narrative_plan"] = dict(request.narrative_plan)
    if request.entity_budget is not None:
        enriched["entity_usage"] = dict(request.entity_budget)
    if request.narrative_risk_summary is not None:
        enriched["narrative_risk_summary"] = dict(request.narrative_risk_summary)
    return enriched


def _novel_loop_ports_with_injected_ports(novel_ports: NovelLoopPorts, ports: BookRunAdapterPorts) -> NovelLoopPorts:
    if ports.memory_extractor is None and ports.continuity_submitter is None:
        return novel_ports
    return NovelLoopPorts(
        compile_context=novel_ports.compile_context,
        generate_scene=novel_ports.generate_scene,
        judge_scene=novel_ports.judge_scene,
        repair_scene=novel_ports.repair_scene,
        approve_scene=novel_ports.approve_scene,
        record_model_run=novel_ports.record_model_run,
        extract_memory=ports.memory_extractor or novel_ports.extract_memory,
        submit_continuity=ports.continuity_submitter or novel_ports.submit_continuity,
        check_static_quality=novel_ports.check_static_quality,
    )


def _failed_result_from_exception(
    request: BookRunAdapterRequest,
    latest_progress: BookLoopResult,
    failed_chapter_index: int,
    exc: Exception,
) -> BookLoopResult:
    progress = dict(latest_progress.progress)
    progress.setdefault("completed_chapters", list(request.existing_checkpoint))
    progress.setdefault("checkpoint", list(request.existing_checkpoint))
    progress.setdefault("budget", _budget_from_checkpoint(request.existing_checkpoint))
    failed_at_chapter_index = max(1, failed_chapter_index)
    progress["failure"] = {
        "kind": "workflow_execution_failed",
        "message": str(exc),
        "failed_at_chapter_index": failed_at_chapter_index,
        "recoverable": True,
    }
    progress["dispatch"] = {"stage": "failed", "failed_at_chapter_index": failed_at_chapter_index}
    return BookLoopResult(status="failed", current_chapter_index=failed_at_chapter_index, progress=progress)


def _volume_progress_from_result(request: BookRunAdapterRequest, result: BookLoopResult) -> dict[str, Any]:
    """生成 API 受控的卷级进度摘要，避免把卷字段塞入普通 progress。"""

    completed = result.progress.get("completed_chapters")
    completed_chapters = completed if isinstance(completed, list) else []
    last_completed = _latest_completed_chapter_index(completed_chapters)
    next_start = min(request.total_chapters + 1, max(result.current_chapter_index, last_completed + 1))
    volume = _volume_for_chapter(_normalized_volume_plan(request), min(next_start, request.total_chapters))
    return {
        "current_volume": volume.volume_index,
        "chapter_range": {"start": volume.chapter_range.start, "end": volume.chapter_range.end},
        "completed_chapter_count": len(completed_chapters),
        "next_batch_start_chapter_index": next_start,
    }


def _normalized_volume_plan(request: BookRunAdapterRequest) -> list[BookRunVolumePlanItem]:
    return _volume_plan_or_single(request.volume_plan, request.total_chapters)


def _volume_plan_or_single(value: object, total_chapters: int) -> list[BookRunVolumePlanItem]:
    if not isinstance(value, list):
        return [_single_volume_plan_item(total_chapters)]
    items: list[BookRunVolumePlanItem] = []
    for raw in value:
        item = _volume_plan_item(raw, total_chapters)
        if item is None:
            return [_single_volume_plan_item(total_chapters)]
        items.append(item)
    return items or [_single_volume_plan_item(total_chapters)]


def _volume_plan_item(value: object, total_chapters: int) -> BookRunVolumePlanItem | None:
    if isinstance(value, BookRunVolumePlanItem):
        return value
    if not isinstance(value, Mapping):
        return None
    chapter_range = value.get("chapter_range")
    if not isinstance(chapter_range, Mapping):
        return None
    volume_index = _optional_positive_int(value.get("volume_index"))
    start = _optional_positive_int(chapter_range.get("start"))
    end = _optional_positive_int(chapter_range.get("end"))
    if volume_index is None or start is None or end is None or start > end or start > total_chapters:
        return None
    return BookRunVolumePlanItem(
        volume_index=volume_index,
        chapter_range=BookRunChapterRange(start=start, end=min(end, total_chapters)),
    )


def _single_volume_plan_item(total_chapters: int) -> BookRunVolumePlanItem:
    return BookRunVolumePlanItem(
        volume_index=1,
        chapter_range=BookRunChapterRange(start=1, end=total_chapters),
    )


def _volume_for_chapter(volume_plan: list[BookRunVolumePlanItem], chapter_index: int) -> BookRunVolumePlanItem:
    for item in volume_plan:
        if item.chapter_range.start <= chapter_index <= item.chapter_range.end:
            return item
    return volume_plan[-1]


def _latest_completed_chapter_index(completed_chapters: list[object]) -> int:
    indexes = [
        item.get("chapter_index")
        for item in completed_chapters
        if isinstance(item, Mapping) and isinstance(item.get("chapter_index"), int)
    ]
    return max(indexes, default=0)


def _budget_from_checkpoint(checkpoint: list[dict[str, Any]]) -> dict[str, int | float]:
    return {
        "tokens_used": sum(_positive_int_or_zero(item.get("token_usage")) for item in checkpoint),
        "elapsed_time_sec": sum(_positive_int_or_zero(item.get("elapsed_time_sec")) for item in checkpoint),
        "estimated_cost": sum(_positive_float_or_zero(item.get("cost_estimate")) for item in checkpoint),
    }


def _positive_int_or_zero(value: object) -> int:
    return value if isinstance(value, int) and value > 0 else 0


def _positive_float_or_zero(value: object) -> float:
    return float(value) if isinstance(value, int | float) and value > 0 else 0.0


def _chapter_dispatch_map(value: object) -> dict[int, dict[str, Any]]:
    chapters: dict[int, dict[str, Any]] = {}
    if not isinstance(value, list):
        return chapters
    for item in value:
        if not isinstance(item, Mapping):
            continue
        chapter_index = _optional_positive_int(item.get("chapter_index"))
        chapter_id = _optional_positive_int(item.get("chapter_id"))
        chapter_goal = item.get("chapter_goal")
        if chapter_index is None or chapter_id is None or not isinstance(chapter_goal, str) or not chapter_goal.strip():
            continue
        chapters[chapter_index] = {
            "chapter_id": chapter_id,
            "chapter_goal": chapter_goal,
            "planning_refs": _planning_refs_or_none(item.get("planning_refs")),
        }
    return chapters


def _build_arc_barrier_if_planning_present(chapters: dict[int, dict[str, Any]]) -> ConsistencyBarrier | None:
    """dispatch 含弧线引用时默认启用弧线到期检查；无规划则保持现有行为。"""

    if any(isinstance(chapter.get("planning_refs"), Mapping) for chapter in chapters.values()):
        return ArcConsistencyBarrier(chapters)
    return None


def _planning_refs_or_none(value: object) -> dict[str, Any] | None:
    """只保留轻量 arc 引用，损坏字段一律降级为 None，保持现有放行行为。"""

    if not isinstance(value, Mapping):
        return None
    raw_arc_ids = value.get("arc_ids")
    arc_ids = (
        [arc_id for arc_id in raw_arc_ids if isinstance(arc_id, str) and arc_id.strip()]
        if isinstance(raw_arc_ids, list)
        else []
    )
    if not arc_ids:
        return None
    ratio = value.get("arc_completion_ratio")
    bounded = float(ratio) if isinstance(ratio, int | float) and 0 <= ratio <= 1 else 0.0
    return {"arc_ids": arc_ids, "arc_completion_ratio": bounded}


def _locked_narrative_plan_or_raise(value: object) -> dict[str, Any]:
    narrative_plan = _object_mapping(value)
    if narrative_plan is None or narrative_plan.get("locked") is not True:
        raise ValueError("BookRun dispatch payload requires narrative_plan locked=True before generation.")
    return narrative_plan


def _narrative_plan_progress_summary(
    narrative_plan: Mapping[str, Any],
    *,
    beat_sheet_gate: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    summary: dict[str, Any] = {"locked": True}
    for source_key, target_key in (
        ("plan_id", "plan_id"),
        ("id", "plan_id"),
        ("summary", "summary"),
        ("premise", "premise"),
        ("truth", "truth"),
        ("protagonist_arc", "protagonist_arc"),
        ("antagonist_motive", "antagonist_motive"),
    ):
        if target_key in summary:
            continue
        value = narrative_plan.get(source_key)
        if value is not None and _is_light_scalar(value):
            summary[target_key] = value
    if beat_sheet_gate is not None:
        summary["beat_sheet_gate"] = dict(beat_sheet_gate)
    return summary


def _chapter_beats_summary(narrative_plan: Mapping[str, Any]) -> list[dict[str, Any]]:
    raw_beats = narrative_plan.get("chapter_beats")
    if not isinstance(raw_beats, list | tuple):
        return []
    beats: list[dict[str, Any]] = []
    for raw_beat in raw_beats:
        beat = _object_mapping(raw_beat)
        if beat is None:
            continue
        summary = _mapping_summary(beat)
        if summary is not None:
            beats.append(summary)
    return beats


def _chapter_beat_for_index(request: BookRunAdapterRequest, chapter_index: int) -> dict[str, Any] | None:
    for beat in request.chapter_beats:
        raw_index = beat.get("chapter_index", beat.get("chapter"))
        if raw_index == chapter_index:
            return dict(beat)
    return None


def _mapping_summary(value: object) -> dict[str, Any] | None:
    mapping = _object_mapping(value)
    if mapping is None:
        return None
    summary: dict[str, Any] = {}
    for key, raw_value in mapping.items():
        if not isinstance(key, str) or _is_full_text_key(key):
            continue
        sanitized = _sanitize_summary_value(raw_value)
        if sanitized is not None:
            summary[key] = sanitized
    return summary


def _sanitize_summary_value(value: object) -> Any:
    if _is_light_scalar(value):
        return value
    if isinstance(value, Mapping):
        return _mapping_summary(value)
    if _is_dataclass_like(value):
        return _mapping_summary(value)
    if isinstance(value, list | tuple):
        items = [_sanitize_summary_value(item) for item in value]
        return [item for item in items if item is not None]
    return None


def _object_mapping(value: object) -> dict[str, Any] | None:
    if isinstance(value, Mapping):
        return dict(value)
    compact_summary = getattr(value, "compact_summary", None)
    if callable(compact_summary):
        summary = compact_summary()
        if isinstance(summary, Mapping):
            mapping = dict(summary)
            if hasattr(value, "locked"):
                mapping.setdefault("locked", value.locked)
            return mapping
    if _is_dataclass_like(value):
        return dict(vars(value))
    return None


def _is_dataclass_like(value: object) -> bool:
    return hasattr(value, "__dataclass_fields__") and hasattr(value, "__dict__")


def _is_light_scalar(value: object) -> bool:
    return isinstance(value, bool | int | float) or (isinstance(value, str) and len(value) <= 240)


def _is_full_text_key(key: str) -> bool:
    normalized = key.lower()
    return any(fragment in normalized for fragment in ("full", "draft", "正文", "prompt", "manuscript"))


def _required_int(payload: Mapping[str, Any], key: str) -> int:
    value = _optional_positive_int(payload.get(key))
    if value is None:
        raise ValueError(f"BookRun dispatch payload 缺少有效字段：{key}。")
    return value


def _optional_positive_int(value: object) -> int | None:
    return value if isinstance(value, int) and value > 0 else None


def _env_chapter_parallelism() -> int:
    raw = os.getenv("STORYFORGE_BOOK_RUN_CHAPTER_PARALLELISM")
    if raw is None:
        return 1
    try:
        parsed = int(raw)
    except ValueError:
        return 1
    return parsed if parsed > 0 else 1


def _bool_value(value: object, *, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return default


def _env_budget_guard_before_prefetch() -> bool:
    return _bool_value(os.getenv("STORYFORGE_BOOK_RUN_BUDGET_GUARD_PREFETCH"), default=False)


def _int_or_default(value: object, default: int) -> int:
    return value if isinstance(value, int) and value > 0 else default


def _list_or_empty(value: object) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [dict(item) for item in value if isinstance(item, Mapping)]
