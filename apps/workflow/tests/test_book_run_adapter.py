from __future__ import annotations

from storyforge_workflow.orchestrators.book_run_adapter import (
    BookRunAdapterPorts,
    BookRunAdapterRequest,
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
    assert sink.payloads == [
        {
            "book_run_id": 1,
            "status": "completed",
            "current_chapter_index": 1,
            "progress": result.progress,
            "volume_progress": {
                "current_volume": 1,
                "chapter_range": {"start": 1, "end": 1},
                "completed_chapter_count": 1,
                "next_batch_start_chapter_index": 2,
            },
        }
    ]
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
    assert sink.payloads[0]["status"] == "awaiting_review"


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
    assert sink.payloads[0]["volume_progress"] == {
        "current_volume": 1,
        "chapter_range": {"start": 1, "end": 3},
        "completed_chapter_count": 1,
        "next_batch_start_chapter_index": 2,
    }
    assert "volume" not in sink.payloads[0]["progress"]
    assert "chapter_range" not in sink.payloads[0]["progress"]


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
    assert sink.payloads[0]["progress"]["completed_chapters"][0]["skill_runs"] == historical_skill_runs
    assert sink.payloads[0]["volume_progress"]["completed_chapter_count"] == 2


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
    assert sink.payloads[0]["volume_progress"] == {
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


def _review_ports(request: NovelLoopRequest) -> NovelLoopPorts:
    return NovelLoopPorts(
        compile_context=lambda novel_request: "ctx-review",
        generate_scene=lambda novel_request, context_id: "草稿需要人工判断。",
        record_model_run=lambda novel_request, draft: 801,
        judge_scene=lambda draft, attempt: {"status": "awaiting_review", "judge_report_id": 901},
        repair_scene=lambda draft, report, attempt: draft,
        approve_scene=lambda novel_request, draft, refs: 0,
    )
