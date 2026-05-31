from __future__ import annotations

from storyforge_workflow.orchestrators.novel_loop import (
    NovelLoopPorts,
    NovelLoopRequest,
    run_single_chapter_loop,
)


def test_single_chapter_loop_approves_when_judge_passes() -> None:
    """Judge 通过时 NovelLoop 应直接批准，不触发 Repair。"""

    calls: list[str] = []
    ports = NovelLoopPorts(
        compile_context=lambda request: calls.append("compile") or "ctx-1",
        generate_scene=lambda request, context_id: calls.append(f"generate:{context_id}") or "林岚抵达雾港。",
        judge_scene=lambda draft, attempt: calls.append(f"judge:{attempt}") or {"status": "pass", "judge_report_id": 11},
        repair_scene=lambda draft, report, attempt: calls.append("repair") or draft,
        approve_scene=lambda request, draft, evidence: calls.append("approve") or 21,
        record_model_run=lambda request, draft: calls.append("model_run") or 31,
    )

    result = run_single_chapter_loop(_request(), ports, max_repairs=1)

    assert result.status == "approved"
    assert result.approved_scene_id == 21
    assert result.source_model_run_id == 31
    assert result.judge_report_id == 11
    assert calls == ["compile", "generate:ctx-1", "model_run", "judge:0", "approve"]


def test_single_chapter_loop_extracts_memory_after_approval() -> None:
    """章节批准后应抽取长效记忆，并在结果中保留 memory id。"""

    calls: list[str] = []
    ports = NovelLoopPorts(
        compile_context=lambda request: "ctx-1",
        generate_scene=lambda request, context_id: "林岚在雾港承认左臂旧伤。",
        judge_scene=lambda draft, attempt: {"status": "pass", "judge_report_id": 11},
        repair_scene=lambda draft, report, attempt: draft,
        approve_scene=lambda request, draft, evidence: calls.append("approve") or 21,
        record_model_run=lambda request, draft: 31,
        extract_memory=lambda request, draft, approved_scene_id: calls.append(
            f"extract:{approved_scene_id}:{request.chapter_id}"
        )
        or ["memory:linlan-status"],
    )

    result = run_single_chapter_loop(_request(), ports, max_repairs=1)

    assert result.status == "approved"
    assert result.memory_atom_ids == ["memory:linlan-status"]
    assert calls == ["approve", "extract:21:2"]


def test_single_chapter_loop_repairs_once_then_approves() -> None:
    """首次 Judge 失败但修复后通过时，应批准修复稿。"""

    judge_reports = iter(
        [
            {"status": "fail", "judge_report_id": 11, "repair_patch_id": 41},
            {"status": "pass", "judge_report_id": 12},
        ]
    )
    ports = NovelLoopPorts(
        compile_context=lambda request: "ctx-1",
        generate_scene=lambda request, context_id: "草稿存在节奏问题。",
        judge_scene=lambda draft, attempt: next(judge_reports),
        repair_scene=lambda draft, report, attempt: "修复后的草稿。",
        approve_scene=lambda request, draft, evidence: 22,
        record_model_run=lambda request, draft: 32,
    )

    result = run_single_chapter_loop(_request(), ports, max_repairs=1)

    assert result.status == "approved"
    assert result.approved_scene_id == 22
    assert result.repair_patch_id == 41
    assert result.final_draft == "修复后的草稿。"


def test_single_chapter_loop_pauses_when_repair_budget_exhausted() -> None:
    """Repair 次数耗尽仍未通过时，NovelLoop 必须暂停等待人工审查。"""

    ports = NovelLoopPorts(
        compile_context=lambda request: "ctx-1",
        generate_scene=lambda request, context_id: "草稿持续失败。",
        judge_scene=lambda draft, attempt: {"status": "fail", "judge_report_id": 90, "repair_patch_id": 91},
        repair_scene=lambda draft, report, attempt: f"{draft} 修复尝试 {attempt}",
        approve_scene=lambda request, draft, evidence: 0,
        record_model_run=lambda request, draft: 33,
    )

    result = run_single_chapter_loop(_request(), ports, max_repairs=1)

    assert result.status == "awaiting_review"
    assert result.approved_scene_id is None
    assert result.judge_report_id == 90
    assert result.repair_patch_id == 91



def test_single_chapter_loop_repairs_static_quality_issue_before_approval() -> None:
    """静态质量问题即使 LLM Judge 通过，也应先触发一次修订再批准。"""

    calls: list[str] = []
    ports = NovelLoopPorts(
        compile_context=lambda request: "ctx-1",
        generate_scene=lambda request, context_id: "林岚很愤怒，也很害怕。",
        judge_scene=lambda draft, attempt: calls.append(f"judge:{attempt}:{draft}") or {"status": "pass", "judge_report_id": 11},
        repair_scene=lambda draft, report, attempt: calls.append(f"repair:{attempt}") or "林岚把指节抵在门缝上，冷汗沿腕骨滑下。",
        approve_scene=lambda request, draft, evidence: calls.append(f"approve:{draft}") or 21,
        record_model_run=lambda request, draft: 31,
        check_static_quality=lambda draft: [
            {
                "dimension": "说明腔",
                "severity": "中",
                "snippet": "很愤怒，也很害怕",
                "message": "抽象情绪直述",
                "suggestion": "用动作呈现恐惧",
                "revision_strategy": "line_edit",
            }
        ],
    )

    result = run_single_chapter_loop(_request(), ports, max_repairs=1)

    assert result.status == "approved"
    assert result.final_draft == "林岚把指节抵在门缝上，冷汗沿腕骨滑下。"
    assert calls == [
        "judge:0:林岚很愤怒，也很害怕。",
        "repair:1",
        "judge:1:林岚把指节抵在门缝上，冷汗沿腕骨滑下。",
        "approve:林岚把指节抵在门缝上，冷汗沿腕骨滑下。",
    ]


def test_single_chapter_loop_pauses_on_severe_static_quality_issue() -> None:
    """严重静态质量问题应直接等待人工审查，避免把坏稿送入轻修。"""

    calls: list[str] = []
    ports = NovelLoopPorts(
        compile_context=lambda request: "ctx-1",
        generate_scene=lambda request, context_id: "角色突然背叛全部设定。",
        judge_scene=lambda draft, attempt: calls.append("judge") or {"status": "pass", "judge_report_id": 11},
        repair_scene=lambda draft, report, attempt: calls.append("repair") or draft,
        approve_scene=lambda request, draft, evidence: calls.append("approve") or 0,
        record_model_run=lambda request, draft: 31,
        check_static_quality=lambda draft: [
            {
                "dimension": "连续性",
                "severity": "严重",
                "snippet": "背叛全部设定",
                "message": "与必含事实矛盾",
                "suggestion": "人工确认连续性",
                "revision_strategy": "regenerate",
            }
        ],
    )

    result = run_single_chapter_loop(_request(), ports, max_repairs=1)

    assert result.status == "awaiting_review"
    assert result.judge_report_id == 11
    assert result.approved_scene_id is None
    assert calls == ["judge"]

def _request() -> NovelLoopRequest:
    return NovelLoopRequest(book_id=1, chapter_id=2, chapter_index=1, chapter_goal="完成雾港开篇。")

