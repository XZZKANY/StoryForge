from __future__ import annotations

import pytest

from storyforge_workflow.orchestrators.book_run_adapter import (
    BookRunAdapterPorts,
    BookRunAdapterRequest,
    CallableProgressSink,
    CapturingProgressSink,
    run_book_run_with_skill_runner,
)
from storyforge_workflow.orchestrators.novel_loop import NovelLoopPorts, NovelLoopRequest
from storyforge_workflow.skills.definitions import DEFAULT_NOVEL_SKILL_REGISTRY


def test_book_run_adapter_runs_book_loop_and_emits_progress_with_recorded_skill_runs() -> None:
    """adapter 应在每章 NovelLoop 注入 runner，并把 recorded skill_runs 回填给 sink。"""

    sink = CapturingProgressSink()
    ports = BookRunAdapterPorts(
        chapter_goal=lambda chapter_index: f"第 {chapter_index} 章目标",
        chapter_id=lambda chapter_index: chapter_index + 100,
        novel_loop_ports_factory=_passing_ports,
        progress_sink=sink,
    )
    request = BookRunAdapterRequest(
        book_run_id=1,
        book_id=2,
        blueprint_id=3,
        total_chapters=1,
        start_chapter_index=1,
    )

    result = run_book_run_with_skill_runner(request, ports)

    assert result.status == "completed"
    assert [payload["status"] for payload in sink.payloads] == ["running", "running", "completed"]
    assert sink.payloads[0]["progress"]["dispatch"] == {"stage": "scheduled", "start_chapter_index": 1}
    assert sink.payloads[1]["progress"]["dispatch"] == {"stage": "chapter_completed", "chapter_index": 1}
    assert sink.payloads[-1]["book_run_id"] == 1
    assert sink.payloads[-1]["current_chapter_index"] == 1
    assert sink.payloads[-1]["progress"] == result.progress
    assert sink.payloads[-1]["volume_progress"] == {
        "current_volume": 1,
        "chapter_range": {"start": 1, "end": 1},
        "completed_chapter_count": 1,
        "next_batch_start_chapter_index": 2,
    }
    chapter = result.progress["completed_chapters"][0]
    assert [run["skill_name"] for run in chapter["skill_runs"]] == [
        "generate",
        "judge",
        "approve",
        "memory_extract",
    ]
    assert chapter["skill_runs"][0]["output_refs"]["model_run_id"] == 501
    assert chapter["skill_runs"][0]["skill_version"] == "1.0.0"
    assert "完整正文" not in str(chapter["skill_runs"])
    assert "完整提示词" not in str(chapter["skill_runs"])


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


def test_book_run_adapter_preserves_awaiting_review_with_recorded_generate_and_judge() -> None:
    """adapter 应保留人工审查章节里的已记录 generate 与 judge。"""

    sink = CapturingProgressSink()
    ports = BookRunAdapterPorts(
        chapter_goal=lambda chapter_index: f"第 {chapter_index} 章目标",
        chapter_id=lambda chapter_index: chapter_index + 100,
        novel_loop_ports_factory=_review_ports,
        progress_sink=sink,
    )
    request = BookRunAdapterRequest(book_run_id=11, book_id=22, blueprint_id=33, total_chapters=1)

    result = run_book_run_with_skill_runner(request, ports)

    assert result.status == "awaiting_review"
    blocked = result.progress["blocked_chapter"]
    assert blocked["chapter_index"] == 1
    assert [run["skill_name"] for run in blocked["skill_runs"]] == ["generate", "judge"]
    assert blocked["skill_runs"][1]["status"] == "awaiting_review"
    assert sink.payloads[-1]["status"] == "awaiting_review"


def test_book_run_adapter_preserves_chapter_budget_pause_after_recorded_chapter() -> None:
    """章节预算暂停时，已完成章节仍应带 recorded skill_runs。"""

    sink = CapturingProgressSink()
    ports = BookRunAdapterPorts(
        chapter_goal=lambda chapter_index: f"第 {chapter_index} 章目标",
        chapter_id=lambda chapter_index: chapter_index + 100,
        novel_loop_ports_factory=_passing_ports,
        progress_sink=sink,
    )
    request = BookRunAdapterRequest(
        book_run_id=21,
        book_id=22,
        blueprint_id=23,
        total_chapters=3,
        chapter_budget=1,
    )

    result = run_book_run_with_skill_runner(request, ports)

    assert result.status == "paused_by_budget"
    assert result.progress["pause_reason"] == "chapter_budget_exceeded"
    assert len(result.progress["completed_chapters"]) == 1
    assert result.progress["completed_chapters"][0]["skill_runs"][0]["skill_name"] == "generate"
    assert sink.payloads[-1]["volume_progress"] == {
        "current_volume": 1,
        "chapter_range": {"start": 1, "end": 3},
        "completed_chapter_count": 1,
        "next_batch_start_chapter_index": 2,
    }
    assert "volume" not in sink.payloads[-1]["progress"]
    assert "chapter_range" not in sink.payloads[-1]["progress"]


def test_book_run_adapter_resume_preserves_historical_skill_runs_and_budget_summary() -> None:
    """adapter 恢复时应保留历史 completed_chapters，并让预算摘要包含历史消耗。"""

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
    ports = BookRunAdapterPorts(
        chapter_goal=lambda chapter_index: f"第 {chapter_index} 章目标",
        chapter_id=lambda chapter_index: chapter_index + 100,
        novel_loop_ports_factory=_passing_ports,
        progress_sink=sink,
    )
    request = BookRunAdapterRequest(
        book_run_id=51,
        book_id=52,
        blueprint_id=53,
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
    )

    result = run_book_run_with_skill_runner(request, ports)

    assert result.status == "completed"
    assert [item["chapter_index"] for item in result.progress["completed_chapters"]] == [1, 2]
    assert result.progress["completed_chapters"][0]["skill_runs"] == historical_skill_runs
    assert result.progress["budget"]["tokens_used"] == 60
    assert sink.payloads[-1]["progress"]["completed_chapters"][0]["skill_runs"] == historical_skill_runs
    assert sink.payloads[-1]["volume_progress"]["completed_chapter_count"] == 2


def test_book_run_adapter_uses_volume_plan_for_current_volume_and_chapter_range() -> None:
    """adapter 应按 volume_plan 回填当前卷与整卷章节范围，而不是当前批次范围。"""

    sink = CapturingProgressSink()
    ports = BookRunAdapterPorts(
        chapter_goal=lambda chapter_index: f"第 {chapter_index} 章目标",
        chapter_id=lambda chapter_index: chapter_index + 100,
        novel_loop_ports_factory=_passing_ports,
        progress_sink=sink,
    )
    request = BookRunAdapterRequest(
        book_run_id=41,
        book_id=42,
        blueprint_id=43,
        total_chapters=6,
        start_chapter_index=3,
        chapter_budget=1,
        volume_plan=[
            {"volume_index": 1, "chapter_range": {"start": 1, "end": 2}},
            {"volume_index": 2, "chapter_range": {"start": 3, "end": 5}},
            {"volume_index": 3, "chapter_range": {"start": 6, "end": 6}},
        ],
    )

    result = run_book_run_with_skill_runner(request, ports)

    assert result.status == "paused_by_budget"
    assert sink.payloads[-1]["volume_progress"] == {
        "current_volume": 2,
        "chapter_range": {"start": 3, "end": 5},
        "completed_chapter_count": 1,
        "next_batch_start_chapter_index": 4,
    }


def test_book_run_adapter_skill_run_statuses_match_registry_status_mapping() -> None:
    """adapter 产出的技能状态词必须来自静态注册表映射。"""

    sink = CapturingProgressSink()
    ports = BookRunAdapterPorts(
        chapter_goal=lambda chapter_index: f"第 {chapter_index} 章目标",
        chapter_id=lambda chapter_index: chapter_index + 100,
        novel_loop_ports_factory=_passing_ports,
        progress_sink=sink,
    )
    request = BookRunAdapterRequest(book_run_id=31, book_id=32, blueprint_id=33, total_chapters=1)

    result = run_book_run_with_skill_runner(request, ports)

    allowed_by_skill = {
        skill.name: set(skill.status_mapping.values()) for skill in DEFAULT_NOVEL_SKILL_REGISTRY.all()
    }
    for run in result.progress["completed_chapters"][0]["skill_runs"]:
        assert run["status"] in allowed_by_skill[run["skill_name"]]
    assert result.status in {
        "completed",
        "awaiting_review",
        "paused_by_budget",
        "paused_by_provider_degradation",
    }


def test_book_run_adapter_emits_running_progress_after_each_completed_chapter() -> None:
    """adapter 应把每章完章作为 running progress 投递，供生产调度面板实时推进。"""

    sink = CapturingProgressSink()
    ports = BookRunAdapterPorts(
        chapter_goal=lambda chapter_index: f"第 {chapter_index} 章目标",
        chapter_id=lambda chapter_index: chapter_index + 100,
        novel_loop_ports_factory=_passing_ports,
        progress_sink=sink,
    )
    request = BookRunAdapterRequest(book_run_id=61, book_id=62, blueprint_id=63, total_chapters=2)

    result = run_book_run_with_skill_runner(request, ports)

    assert result.status == "completed"
    assert [payload["status"] for payload in sink.payloads] == ["running", "running", "running", "completed"]
    assert [payload["progress"].get("dispatch", {}).get("stage") for payload in sink.payloads] == [
        "scheduled",
        "chapter_completed",
        "chapter_completed",
        "completed",
    ]
    assert [item["chapter_index"] for item in sink.payloads[1]["progress"]["completed_chapters"]] == [1]
    assert [item["chapter_index"] for item in sink.payloads[2]["progress"]["completed_chapters"]] == [1, 2]
    assert sink.payloads[2]["progress"]["checkpoint"][1]["chapter_index"] == 2
    assert sink.payloads[2]["progress"]["budget"]["tokens_used"] == 0


def test_book_run_adapter_emits_failed_progress_and_reraises_original_error() -> None:
    """章节执行异常时，adapter 应先回填 failed progress，再重新抛出原始异常。"""

    sink = CapturingProgressSink()
    ports = BookRunAdapterPorts(
        chapter_goal=lambda chapter_index: f"第 {chapter_index} 章目标",
        chapter_id=lambda chapter_index: chapter_index + 100,
        novel_loop_ports_factory=_failing_ports,
        progress_sink=sink,
    )
    request = BookRunAdapterRequest(book_run_id=71, book_id=72, blueprint_id=73, total_chapters=1)

    with pytest.raises(RuntimeError, match="章节生成超时"):
        run_book_run_with_skill_runner(request, ports)

    assert [payload["status"] for payload in sink.payloads] == ["running", "failed"]
    failed = sink.payloads[-1]
    assert failed["book_run_id"] == 71
    assert failed["current_chapter_index"] == 1
    assert failed["progress"]["failure"] == {
        "kind": "workflow_execution_failed",
        "message": "章节生成超时",
        "failed_at_chapter_index": 1,
        "recoverable": True,
    }
    assert failed["progress"]["completed_chapters"] == []
    assert failed["progress"]["checkpoint"] == []
    assert failed["progress"]["budget"] == {"tokens_used": 0, "elapsed_time_sec": 0, "estimated_cost": 0.0}
    assert failed["volume_progress"]["next_batch_start_chapter_index"] == 1


def test_book_run_adapter_failed_progress_points_to_active_chapter_after_partial_success() -> None:
    """前序章节完成后失败时，failed progress 应指向正在执行的失败章节。"""

    sink = CapturingProgressSink()
    ports = BookRunAdapterPorts(
        chapter_goal=lambda chapter_index: f"第 {chapter_index} 章目标",
        chapter_id=lambda chapter_index: chapter_index + 100,
        novel_loop_ports_factory=_fail_second_chapter_ports,
        progress_sink=sink,
    )
    request = BookRunAdapterRequest(book_run_id=91, book_id=92, blueprint_id=93, total_chapters=2)

    with pytest.raises(RuntimeError, match="第二章生成超时"):
        run_book_run_with_skill_runner(request, ports)

    assert [payload["status"] for payload in sink.payloads] == ["running", "running", "failed"]
    failed = sink.payloads[-1]
    assert failed["current_chapter_index"] == 2
    assert failed["progress"]["failure"]["failed_at_chapter_index"] == 2
    assert [item["chapter_index"] for item in failed["progress"]["completed_chapters"]] == [1]
    assert failed["volume_progress"]["next_batch_start_chapter_index"] == 2


def test_book_run_adapter_failure_progress_sink_error_does_not_hide_original_error() -> None:
    """失败回填链路异常时，adapter 仍应暴露章节执行的原始错误。"""

    sent: list[dict[str, object]] = []

    def fail_on_failed_payload(payload: dict[str, object]) -> None:
        sent.append(payload)
        if payload["status"] == "failed":
            raise RuntimeError("progress sink 写入失败")

    ports = BookRunAdapterPorts(
        chapter_goal=lambda chapter_index: f"第 {chapter_index} 章目标",
        chapter_id=lambda chapter_index: chapter_index + 100,
        novel_loop_ports_factory=_failing_ports,
        progress_sink=CallableProgressSink(fail_on_failed_payload),
    )
    request = BookRunAdapterRequest(book_run_id=81, book_id=82, blueprint_id=83, total_chapters=1)

    with pytest.raises(RuntimeError, match="章节生成超时"):
        run_book_run_with_skill_runner(request, ports)

    assert [payload["status"] for payload in sent] == ["running", "failed"]


def _review_ports(request: NovelLoopRequest) -> NovelLoopPorts:
    return NovelLoopPorts(
        compile_context=lambda novel_request: "ctx-review",
        generate_scene=lambda novel_request, context_id: "草稿需要人工判断。",
        record_model_run=lambda novel_request, draft: 801,
        judge_scene=lambda draft, attempt: {"status": "awaiting_review", "judge_report_id": 901},
        repair_scene=lambda draft, report, attempt: draft,
        approve_scene=lambda novel_request, draft, refs: 0,
    )


def _failing_ports(request: NovelLoopRequest) -> NovelLoopPorts:
    def raise_timeout(novel_request: NovelLoopRequest, context_id: str) -> str:
        raise RuntimeError("章节生成超时")

    return NovelLoopPorts(
        compile_context=lambda novel_request: "ctx-failing",
        generate_scene=raise_timeout,
        record_model_run=lambda novel_request, draft: 0,
        judge_scene=lambda draft, attempt: {"status": "pass", "judge_report_id": 1},
        repair_scene=lambda draft, report, attempt: draft,
        approve_scene=lambda novel_request, draft, refs: 0,
    )


def _fail_second_chapter_ports(request: NovelLoopRequest) -> NovelLoopPorts:
    def generate_or_fail(novel_request: NovelLoopRequest, context_id: str) -> str:
        if novel_request.chapter_index == 2:
            raise RuntimeError("第二章生成超时")
        return "第一章完成。"

    return NovelLoopPorts(
        compile_context=lambda novel_request: f"ctx-{novel_request.chapter_index}",
        generate_scene=generate_or_fail,
        record_model_run=lambda novel_request, draft: 500 + novel_request.chapter_index,
        judge_scene=lambda draft, attempt: {"status": "pass", "judge_report_id": 600 + attempt},
        repair_scene=lambda draft, report, attempt: draft,
        approve_scene=lambda novel_request, draft, refs: 700 + novel_request.chapter_index,
        extract_memory=lambda novel_request, draft, approved_scene_id: [],
    )
