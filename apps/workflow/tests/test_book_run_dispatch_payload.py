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


def test_callable_progress_sink_wraps_service_or_http_sender() -> None:
    """callable sink 应把标准 progress payload 交给外部发送函数。"""

    sent: list[dict[str, object]] = []
    sink = CallableProgressSink(sent.append)

    sink.emit(book_run_id=7, status="completed", current_chapter_index=2, progress={"completed_chapters": []})

    assert sent == [
        {
            "book_run_id": 7,
            "status": "completed",
            "current_chapter_index": 2,
            "progress": {"completed_chapters": []},
        }
    ]


def test_book_run_dispatch_payload_requires_chapter_mapping() -> None:
    """payload 缺少待执行章节映射时应拒绝运行，避免伪造 chapter_id。"""

    payload = _dispatch_payload()
    payload["chapters"] = []

    with pytest.raises(ValueError, match="章节映射"):
        run_book_run_dispatch_payload(payload, _passing_ports, CapturingProgressSink())


def _dispatch_payload() -> dict[str, object]:
    return {
        "book_run_id": 41,
        "book_id": 42,
        "blueprint_id": 43,
        "total_chapters": 1,
        "start_chapter_index": 1,
        "existing_checkpoint": [],
        "token_budget": None,
        "time_budget_sec": None,
        "chapter_budget": None,
        "provider_fallback_pause_threshold": None,
        "chapters": [
            {
                "chapter_index": 1,
                "chapter_id": 101,
                "chapter_goal": "林岚抵达雾港并确认灯塔信号异常。",
            }
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
