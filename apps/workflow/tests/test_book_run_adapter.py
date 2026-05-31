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
