from __future__ import annotations

import pytest

from storyforge_workflow.orchestrators.book_run_adapter import (
    CallableProgressSink,
    CapturingProgressSink,
    run_book_run_dispatch_payload,
)
from storyforge_workflow.orchestrators.novel_loop import NovelLoopPorts, NovelLoopRequest


def test_book_run_dispatch_payload_runs_adapter_and_emits_recorded_skill_runs() -> None:
    """workflow 应消费 API dispatch payload，并把 recorded skill_runs 回填给 sink。"""

    sink = CapturingProgressSink()
    result = run_book_run_dispatch_payload(_dispatch_payload(), _passing_ports, sink)

    assert result.status == "completed"
    assert [payload["status"] for payload in sink.payloads] == ["running", "running", "completed"]
    assert sink.payloads[-1]["book_run_id"] == 41
    assert sink.payloads[-1]["status"] == "completed"
    assert sink.payloads[-1]["volume_progress"] == {
        "current_volume": 1,
        "chapter_range": {"start": 1, "end": 1},
        "completed_chapter_count": 1,
        "next_batch_start_chapter_index": 2,
    }
    chapter = sink.payloads[-1]["progress"]["completed_chapters"][0]
    assert chapter["chapter_index"] == 1
    assert [run["skill_name"] for run in chapter["skill_runs"]] == [
        "generate",
        "judge",
        "approve",
        "memory_extract",
        "submit_continuity",
    ]
    assert chapter["skill_runs"][0]["output_refs"]["model_run_id"] == 501
    assert "完整正文" not in str(chapter["skill_runs"])
    assert "完整提示词" not in str(chapter["skill_runs"])


def test_book_run_dispatch_payload_passes_volume_plan_to_adapter() -> None:
    """dispatch payload 中的 volume_plan 应作为 adapter 的稳定输入。"""

    sink = CapturingProgressSink()
    payload = _dispatch_payload(
        total_chapters=4,
        start_chapter_index=3,
        chapter_budget=1,
        chapters=[
            {
                "chapter_index": 3,
                "chapter_id": 103,
                "chapter_goal": "第三章进入第二卷冲突。",
            },
            {
                "chapter_index": 4,
                "chapter_id": 104,
                "chapter_goal": "第四章完成第二卷收束。",
            },
        ],
        volume_plan=[
            {"volume_index": 1, "chapter_range": {"start": 1, "end": 2}},
            {"volume_index": 2, "chapter_range": {"start": 3, "end": 4}},
        ],
    )

    result = run_book_run_dispatch_payload(payload, _passing_ports, sink)

    assert result.status == "paused_by_budget"
    assert sink.payloads[-1]["volume_progress"] == {
        "current_volume": 2,
        "chapter_range": {"start": 3, "end": 4},
        "completed_chapter_count": 1,
        "next_batch_start_chapter_index": 4,
    }


def test_book_run_dispatch_payload_resumes_with_historical_completed_chapters() -> None:
    """dispatch payload 的 existing_checkpoint 是历史 completed_chapters，不应降级丢审计摘要。"""

    sink = CapturingProgressSink()
    historical_skill_runs = [
        {
            "skill_name": "generate",
            "skill_version": "1.0.0",
            "status": "generated",
            "output_refs": {"model_run_id": 501},
            "budget": {"token_usage": 60},
        }
    ]
    payload = _dispatch_payload(
        total_chapters=2,
        start_chapter_index=2,
        existing_checkpoint=[
            {
                "chapter_index": 1,
                "status": "approved",
                "model_run_id": 501,
                "judge_report_id": 601,
                "approved_scene_id": 701,
                "token_usage": 60,
                "elapsed_time_sec": 4,
                "cost_estimate": 0.03,
                "skill_runs": historical_skill_runs,
            }
        ],
        chapters=[
            {
                "chapter_index": 2,
                "chapter_id": 102,
                "chapter_goal": "第二章承接恢复后的冲突。",
            }
        ],
    )

    result = run_book_run_dispatch_payload(payload, _passing_ports, sink)

    assert result.status == "completed"
    assert [item["chapter_index"] for item in sink.payloads[-1]["progress"]["completed_chapters"]] == [1, 2]
    assert sink.payloads[-1]["progress"]["completed_chapters"][0]["skill_runs"] == historical_skill_runs
    assert sink.payloads[-1]["progress"]["budget"]["tokens_used"] == 60
    assert sink.payloads[-1]["volume_progress"]["completed_chapter_count"] == 2


def test_callable_progress_sink_wraps_service_or_http_sender() -> None:
    """callable sink 应把标准 progress payload 交给外部发送函数。"""

    sent: list[dict[str, object]] = []
    sink = CallableProgressSink(sent.append)

    sink.emit(
        book_run_id=7,
        status="completed",
        current_chapter_index=2,
        progress={"completed_chapters": []},
        volume_progress={
            "current_volume": 1,
            "chapter_range": {"start": 1, "end": 2},
            "completed_chapter_count": 2,
            "next_batch_start_chapter_index": 3,
        },
    )

    assert sent == [
        {
            "book_run_id": 7,
            "status": "completed",
            "current_chapter_index": 2,
            "progress": {"completed_chapters": []},
            "volume_progress": {
                "current_volume": 1,
                "chapter_range": {"start": 1, "end": 2},
                "completed_chapter_count": 2,
                "next_batch_start_chapter_index": 3,
            },
        }
    ]


def test_book_run_dispatch_payload_requires_chapter_mapping() -> None:
    """payload 缺少待执行章节映射时应拒绝运行，避免伪造 chapter_id。"""

    payload = _dispatch_payload()
    payload["chapters"] = []

    with pytest.raises(ValueError, match="章节映射"):
        run_book_run_dispatch_payload(payload, _passing_ports, CapturingProgressSink())


def test_book_run_dispatch_payload_requires_locked_narrative_plan_before_ports_factory() -> None:
    """dispatch 缺少 locked NarrativePlan 时应在生成前失败，且不能调用端口工厂。"""

    called = False
    payload = _dispatch_payload()
    payload.pop("narrative_plan")

    def ports_factory(request: NovelLoopRequest) -> NovelLoopPorts:
        nonlocal called
        called = True
        return _passing_ports(request)

    with pytest.raises(ValueError, match="narrative_plan.*locked"):
        run_book_run_dispatch_payload(payload, ports_factory, CapturingProgressSink())

    assert called is False


def test_book_run_dispatch_payload_rejects_unlocked_narrative_plan_before_ports_factory() -> None:
    """dispatch 中 NarrativePlan 未锁定时应拒绝运行，避免基于漂移规划开写。"""

    called = False
    payload = _dispatch_payload(narrative_plan={**_locked_narrative_plan(), "locked": False})

    def ports_factory(request: NovelLoopRequest) -> NovelLoopPorts:
        nonlocal called
        called = True
        return _passing_ports(request)

    with pytest.raises(ValueError, match="narrative_plan.*locked"):
        run_book_run_dispatch_payload(payload, ports_factory, CapturingProgressSink())

    assert called is False


def test_book_run_dispatch_payload_threads_planning_refs_into_novel_request() -> None:
    """dispatch payload 中的 planning_refs 应透传到每章 NovelLoopRequest，不再在 adapter 处丢弃。"""

    captured: list[NovelLoopRequest] = []

    def capturing_ports(request: NovelLoopRequest) -> NovelLoopPorts:
        captured.append(request)
        return _passing_ports(request)

    payload = _dispatch_payload(
        chapters=[
            {
                "chapter_index": 1,
                "chapter_id": 101,
                "chapter_goal": "林岚抵达雾港并确认灯塔信号异常。",
                "planning_refs": {"arc_ids": ["旧港信号"], "arc_completion_ratio": 0.8},
            }
        ],
    )

    run_book_run_dispatch_payload(payload, capturing_ports, CapturingProgressSink())

    assert len(captured) == 1
    assert captured[0].planning_refs == {"arc_ids": ["旧港信号"], "arc_completion_ratio": 0.8}


def test_book_run_dispatch_payload_threads_current_chapter_beat_into_novel_request() -> None:
    """locked NarrativePlan 的当前章 ChapterBeat 应挂到对应 NovelLoopRequest。"""

    captured: list[NovelLoopRequest] = []

    def capturing_ports(request: NovelLoopRequest) -> NovelLoopPorts:
        captured.append(request)
        return _passing_ports(request)

    payload = _dispatch_payload(
        total_chapters=2,
        chapters=[
            {
                "chapter_index": 1,
                "chapter_id": 101,
                "chapter_goal": "第一章建立雾港信号。",
            },
            {
                "chapter_index": 2,
                "chapter_id": 102,
                "chapter_goal": "第二章把灯塔风险推到台前。",
            },
        ],
        narrative_plan={
            **_locked_narrative_plan(),
            "beat_sheet_gate": {"status": "passed", "risk_level": "low"},
            "chapter_beats": [
                {"chapter_index": 1, "beat_id": "beat-1", "goal": "发现信号异常", "full_text": "完整正文不应下发"},
                {"chapter_index": 2, "beat_id": "beat-2", "goal": "确认灯塔有人篡改"},
            ],
            "phase_policy": {"current_phase": "setup", "allowed_tension": "low"},
            "entity_budget": {"max_new_entities": 2, "used_entities": 1},
        },
    )

    run_book_run_dispatch_payload(payload, capturing_ports, CapturingProgressSink())

    assert [request.current_chapter_beat for request in captured] == [
        {"chapter_index": 1, "beat_id": "beat-1", "goal": "发现信号异常"},
        {"chapter_index": 2, "beat_id": "beat-2", "goal": "确认灯塔有人篡改"},
    ]
    assert captured[0].phase_policy_summary == {"current_phase": "setup", "allowed_tension": "low"}
    assert captured[0].entity_budget_summary == {"max_new_entities": 2, "used_entities": 1}


def test_book_run_dispatch_payload_uses_top_level_narrative_control_summaries() -> None:
    """API dispatch 顶层叙事预算和阶段策略应成为 workflow 的运行约束摘要。"""

    captured: list[NovelLoopRequest] = []
    sink = CapturingProgressSink()

    def capturing_ports(request: NovelLoopRequest) -> NovelLoopPorts:
        captured.append(request)
        return _passing_ports(request)

    payload = _dispatch_payload(
        narrative_plan={
            "locked": True,
            "source": "generated_default",
            "chapter_beats": [
                {"chapter_index": 1, "beat": "确认灯塔信号失真。"},
            ],
        },
    )
    payload["entity_budget"] = {
        "key_characters": 5,
        "core_locations": 3,
        "core_evidence": 3,
        "major_reversals": 2,
    }
    payload["phase_policy"] = {
        "phases": [
            {"name": "setup", "chapter_range": {"start": 1, "end": 6}},
        ]
    }
    payload["beat_sheet_gate"] = {"status": "pass", "locked": True, "chapter_count": 1}

    run_book_run_dispatch_payload(payload, capturing_ports, sink)

    assert captured[0].entity_budget_summary == {
        "key_characters": 5,
        "core_locations": 3,
        "core_evidence": 3,
        "major_reversals": 2,
    }
    assert captured[0].phase_policy_summary == {
        "phases": [
            {"name": "setup", "chapter_range": {"start": 1, "end": 6}},
        ]
    }
    assert sink.payloads[-1]["progress"]["entity_usage"] == captured[0].entity_budget_summary
    assert sink.payloads[-1]["progress"]["narrative_plan"]["beat_sheet_gate"] == {
        "status": "pass",
        "locked": True,
        "chapter_count": 1,
    }


def test_book_run_dispatch_payload_progress_has_narrative_summaries_without_full_draft_text() -> None:
    """progress 应包含规划/风险/实体摘要，但不能携带完整正文或 draft。"""

    sink = CapturingProgressSink()
    payload = _dispatch_payload(
        narrative_plan={
            **_locked_narrative_plan(),
            "summary": "雾港灯塔长线推进",
            "full_text": "完整正文不应进入 progress",
            "draft": "full draft must not enter progress",
            "beat_sheet_gate": {"status": "passed", "risk_level": "medium", "notes": "节奏可控"},
            "narrative_risk_summary": {"risk_level": "medium", "open_risks": ["灯塔动机需回收"]},
            "entity_budget": {"max_new_entities": 2, "used_entities": 1, "remaining_entities": 1},
        },
    )

    run_book_run_dispatch_payload(payload, _passing_ports, sink)

    first_progress = sink.payloads[0]["progress"]
    final_progress = sink.payloads[-1]["progress"]
    for progress in (first_progress, final_progress):
        assert progress["narrative_plan"] == {
            "locked": True,
            "plan_id": "np-locked",
            "summary": "雾港灯塔长线推进",
            "beat_sheet_gate": {"status": "passed", "risk_level": "medium", "notes": "节奏可控"},
        }
        assert progress["entity_usage"] == {"max_new_entities": 2, "used_entities": 1, "remaining_entities": 1}
        assert progress["narrative_risk_summary"] == {
            "risk_level": "medium",
            "open_risks": ["灯塔动机需回收"],
        }
        assert "完整正文不应进入 progress" not in str(progress)
        assert "full draft must not enter progress" not in str(progress)
        assert "final_draft" not in str(progress)


def test_book_run_dispatch_payload_drops_corrupt_planning_refs() -> None:
    """损坏的 planning_refs（无有效 arc_id 或坏比例）应降级为 None，保持现有放行行为。"""

    captured: list[NovelLoopRequest] = []

    def capturing_ports(request: NovelLoopRequest) -> NovelLoopPorts:
        captured.append(request)
        return _passing_ports(request)

    payload = _dispatch_payload(
        chapters=[
            {
                "chapter_index": 1,
                "chapter_id": 101,
                "chapter_goal": "林岚抵达雾港并确认灯塔信号异常。",
                "planning_refs": {"arc_ids": ["", "  "], "arc_completion_ratio": 2.5},
            }
        ],
    )

    run_book_run_dispatch_payload(payload, capturing_ports, CapturingProgressSink())

    assert captured[0].planning_refs is None


def test_book_run_dispatch_payload_threads_injected_memory_extractor() -> None:
    """dispatch 入口注入的 memory_extractor 必须真正驱动章末记忆写入，而非被静默丢弃。"""

    recorded: list[tuple[int, int]] = []

    def extractor(novel_request: NovelLoopRequest, draft: str, approved_scene_id: int) -> list[str]:
        recorded.append((novel_request.chapter_index, approved_scene_id))
        return ["memory:旧港信号"]

    sink = CapturingProgressSink()
    run_book_run_dispatch_payload(_dispatch_payload(), _passing_ports, sink, memory_extractor=extractor)

    assert recorded == [(1, 701)]
    memory_run = _skill_run(sink, chapter_index=1, skill_name="memory_extract")
    assert memory_run["status"] == "memory_updated"
    assert memory_run["output_refs"]["memory_atom_ids"] == ("memory:旧港信号",)


def test_book_run_dispatch_payload_without_memory_extractor_stays_skipped() -> None:
    """未注入 memory_extractor 时保持既有跳过行为，守住回归基线。"""

    sink = CapturingProgressSink()
    run_book_run_dispatch_payload(_dispatch_payload(), _passing_ports, sink)

    memory_run = _skill_run(sink, chapter_index=1, skill_name="memory_extract")
    assert memory_run["status"] == "memory_extract_skipped"
    assert memory_run["output_refs"]["memory_atom_ids"] == ()


def _skill_run(sink: CapturingProgressSink, *, chapter_index: int, skill_name: str) -> dict[str, object]:
    completed = sink.payloads[-1]["progress"]["completed_chapters"]
    chapter = next(item for item in completed if item["chapter_index"] == chapter_index)
    return next(run for run in chapter["skill_runs"] if run["skill_name"] == skill_name)


def _dispatch_payload(
    *,
    total_chapters: int = 1,
    start_chapter_index: int = 1,
    chapter_budget: int | None = None,
    existing_checkpoint: list[dict[str, object]] | None = None,
    chapters: list[dict[str, object]] | None = None,
    volume_plan: list[dict[str, object]] | None = None,
    narrative_plan: dict[str, object] | None = None,
) -> dict[str, object]:
    return {
        "book_run_id": 41,
        "book_id": 42,
        "blueprint_id": 43,
        "total_chapters": total_chapters,
        "start_chapter_index": start_chapter_index,
        "existing_checkpoint": existing_checkpoint or [],
        "token_budget": None,
        "time_budget_sec": None,
        "chapter_budget": chapter_budget,
        "provider_fallback_pause_threshold": None,
        "chapters": chapters
        or [
            {
                "chapter_index": 1,
                "chapter_id": 101,
                "chapter_goal": "林岚抵达雾港并确认灯塔信号异常。",
            }
        ],
        "volume_plan": volume_plan,
        "narrative_plan": narrative_plan or _locked_narrative_plan(),
    }


def _locked_narrative_plan() -> dict[str, object]:
    return {
        "plan_id": "np-locked",
        "locked": True,
        "summary": "雾港灯塔长线推进",
        "beat_sheet_gate": {"status": "passed", "risk_level": "low"},
        "narrative_risk_summary": {"risk_level": "low", "open_risks": []},
        "entity_budget": {"max_new_entities": 2, "used_entities": 0, "remaining_entities": 2},
        "phase_policy": {"current_phase": "setup"},
        "chapter_beats": [
            {"chapter_index": 1, "beat_id": "beat-1", "goal": "林岚发现异常信号"},
        ],
    }


def _passing_ports(request: NovelLoopRequest) -> NovelLoopPorts:
    return NovelLoopPorts(
        compile_context=lambda novel_request: f"ctx-{novel_request.chapter_index}",
        generate_scene=lambda novel_request, context_id: "林岚抵达雾港。",
        record_model_run=lambda novel_request, draft: 500 + novel_request.chapter_index,
        judge_scene=lambda draft, attempt: {"status": "pass", "judge_report_id": 600 + attempt},
        repair_scene=lambda draft, report, attempt: draft,
        approve_scene=lambda novel_request, draft, refs: 700 + novel_request.chapter_index,
        extract_memory=lambda novel_request, draft, approved_scene_id: [],
    )
