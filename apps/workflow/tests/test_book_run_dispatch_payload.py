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
    assert sink.payloads[0]["book_run_id"] == 41
    assert sink.payloads[0]["status"] == "completed"
    assert sink.payloads[0]["volume_progress"] == {
        "current_volume": 1,
        "chapter_range": {"start": 1, "end": 1},
        "completed_chapter_count": 1,
        "next_batch_start_chapter_index": 2,
    }
    chapter = sink.payloads[0]["progress"]["completed_chapters"][0]
    assert chapter["chapter_index"] == 1
    assert [run["skill_name"] for run in chapter["skill_runs"]] == [
        "generate",
        "judge",
        "approve",
        "memory_extract",
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
    assert sink.payloads[0]["volume_progress"] == {
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
    assert [item["chapter_index"] for item in sink.payloads[0]["progress"]["completed_chapters"]] == [1, 2]
    assert sink.payloads[0]["progress"]["completed_chapters"][0]["skill_runs"] == historical_skill_runs
    assert sink.payloads[0]["progress"]["budget"]["tokens_used"] == 60
    assert sink.payloads[0]["volume_progress"]["completed_chapter_count"] == 2


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


def _dispatch_payload(
    *,
    total_chapters: int = 1,
    start_chapter_index: int = 1,
    chapter_budget: int | None = None,
    existing_checkpoint: list[dict[str, object]] | None = None,
    chapters: list[dict[str, object]] | None = None,
    volume_plan: list[dict[str, object]] | None = None,
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
