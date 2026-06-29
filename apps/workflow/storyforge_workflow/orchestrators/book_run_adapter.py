from __future__ import annotations

import os
from collections.abc import Callable, Mapping
from threading import Lock
from typing import Any

from storyforge_workflow.orchestrators.book_loop import (
    BookLoopRequest,
    BookLoopResult,
    ChapterExecutionError,
    ConsistencyBarrier,
    run_book_loop,
)
from storyforge_workflow.orchestrators.book_run_adapter_coerce import (
    _bool_value,
    _int_or_default,
    _list_or_empty,
    _optional_positive_int,
    _positive_float_or_zero,
    _positive_int_or_zero,
)
from storyforge_workflow.orchestrators.book_run_adapter_payload import (
    _build_arc_barrier_if_planning_present,
    _chapter_beat_for_index,
    _chapter_beats_summary,
    _chapter_dispatch_map,
    _locked_narrative_plan_or_raise,
    _mapping_summary,
    _narrative_plan_progress_summary,
    _required_int,
)
from storyforge_workflow.orchestrators.book_run_adapter_types import (
    BookRunAdapterPorts,
    BookRunAdapterRequest,
    BookRunProgressSink,
    ContinuitySubmitter,
    MemoryExtractor,
)
from storyforge_workflow.orchestrators.book_run_adapter_types import (
    BookRunChapterRange as BookRunChapterRange,
)
from storyforge_workflow.orchestrators.book_run_adapter_types import (
    BookRunVolumePlanItem as BookRunVolumePlanItem,
)
from storyforge_workflow.orchestrators.book_run_adapter_types import (
    CallableProgressSink as CallableProgressSink,
)
from storyforge_workflow.orchestrators.book_run_adapter_types import (
    CapturingProgressSink as CapturingProgressSink,
)
from storyforge_workflow.orchestrators.book_run_adapter_volume import (
    _volume_plan_or_single,
    _volume_progress_from_result,
)
from storyforge_workflow.orchestrators.novel_loop import (
    NovelLoopPorts,
    NovelLoopRequest,
    NovelLoopResult,
    run_single_chapter_loop,
)
from storyforge_workflow.skills.runner import NovelSkillRunner


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

    defer_commit_side_effects = True
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
        try:
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
        except Exception as exc:
            raise ChapterExecutionError(chapter_index, exc) from exc
        return _with_committed_side_effects(chapter_result, memory_atom_ids, continuity_result, runner)

    try:
        result = run_book_loop(
            book_loop_request,
            run_chapter,
            progress_callback=emit_chapter_progress,
            consistency_barrier=ports.consistency_barrier,
            commit_chapter_side_effects=commit_chapter_side_effects,
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


def _budget_from_checkpoint(checkpoint: list[dict[str, Any]]) -> dict[str, int | float]:
    return {
        "tokens_used": sum(_positive_int_or_zero(item.get("token_usage")) for item in checkpoint),
        "elapsed_time_sec": sum(_positive_int_or_zero(item.get("elapsed_time_sec")) for item in checkpoint),
        "estimated_cost": sum(_positive_float_or_zero(item.get("cost_estimate")) for item in checkpoint),
    }


def _env_chapter_parallelism() -> int:
    raw = os.getenv("STORYFORGE_BOOK_RUN_CHAPTER_PARALLELISM")
    if raw is None:
        return 1
    try:
        parsed = int(raw)
    except ValueError:
        return 1
    return parsed if parsed > 0 else 1


def _env_budget_guard_before_prefetch() -> bool:
    return _bool_value(os.getenv("STORYFORGE_BOOK_RUN_BUDGET_GUARD_PREFETCH"), default=False)
