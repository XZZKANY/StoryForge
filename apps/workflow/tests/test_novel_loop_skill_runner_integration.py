from __future__ import annotations

from storyforge_workflow.orchestrators.novel_loop import (
    NovelLoopPorts,
    NovelLoopRequest,
    run_single_chapter_loop,
)
from storyforge_workflow.skills.runner import NovelSkillRunner


def test_novel_loop_with_skill_runner_keeps_approved_result_contract() -> None:
    """runner 接入后，Judge 通过路径的 NovelLoopResult 契约保持不变。"""

    runner = NovelSkillRunner.default()
    ports = NovelLoopPorts(
        compile_context=lambda request: "ctx-1",
        generate_scene=lambda request, context_id: "林岚抵达雾港。",
        record_model_run=lambda request, draft: 31,
        judge_scene=lambda draft, attempt: {"status": "pass", "judge_report_id": 41},
        repair_scene=lambda draft, report, attempt: draft,
        approve_scene=lambda request, draft, refs: 51,
        extract_memory=lambda request, draft, approved_scene_id: ["mem-1"],
    )

    result = run_single_chapter_loop(
        _request(),
        ports,
        max_repairs=1,
        skill_runner=runner,
    )

    assert result.status == "approved"
    assert result.source_model_run_id == 31
    assert result.judge_report_id == 41
    assert result.approved_scene_id == 51
    assert result.memory_atom_ids == ["mem-1"]
    assert [run.skill_name for run in runner.runs] == ["generate", "judge", "approve", "memory_extract"]


def test_novel_loop_with_skill_runner_records_repair_chain_then_approves() -> None:
    """runner 应记录修复回路，同时保持修复后 approved 的结果字段。"""

    runner = NovelSkillRunner.default()
    judge_reports = iter(
        [
            {"status": "repair", "judge_report_id": 41, "repair_patch_id": 42},
            {"status": "pass", "judge_report_id": 43},
        ]
    )
    ports = NovelLoopPorts(
        compile_context=lambda request: "ctx-1",
        generate_scene=lambda request, context_id: "草稿存在节奏问题。",
        record_model_run=lambda request, draft: 31,
        judge_scene=lambda draft, attempt: next(judge_reports),
        repair_scene=lambda draft, report, attempt: "修复后的草稿。",
        approve_scene=lambda request, draft, refs: 51,
    )

    result = run_single_chapter_loop(
        _request(),
        ports,
        max_repairs=1,
        skill_runner=runner,
    )

    assert result.status == "approved"
    assert result.final_draft == "修复后的草稿。"
    assert result.source_model_run_id == 31
    assert result.judge_report_id == 43
    assert result.repair_patch_id == 42
    assert result.approved_scene_id == 51
    assert [run.skill_name for run in runner.runs] == [
        "generate",
        "judge",
        "repair",
        "judge",
        "approve",
        "memory_extract",
    ]
    assert runner.runs[-1].status == "memory_extract_skipped"


def test_novel_loop_with_skill_runner_static_gate_blocks_before_judge() -> None:
    """高危静态质量门应转人工审查，不进入 judge 或 approve。"""

    runner = NovelSkillRunner.default()
    calls: list[str] = []
    ports = NovelLoopPorts(
        compile_context=lambda request: "ctx-1",
        generate_scene=lambda request, context_id: "草稿触发高危静态门。",
        record_model_run=lambda request, draft: 31,
        judge_scene=lambda draft, attempt: calls.append("judge") or {"status": "pass", "judge_report_id": 41},
        repair_scene=lambda draft, report, attempt: calls.append("repair") or draft,
        approve_scene=lambda request, draft, refs: calls.append("approve") or 51,
        check_static_quality=lambda draft: [
            {
                "dimension": "连续性",
                "severity": "high",
                "snippet": "草稿",
                "message": "关键设定冲突。",
                "suggestion": "转人工审查。",
                "revision_strategy": "regenerate",
            }
        ],
    )

    result = run_single_chapter_loop(
        _request(),
        ports,
        max_repairs=1,
        skill_runner=runner,
    )

    assert result.status == "awaiting_review"
    assert result.source_model_run_id == 31
    assert result.judge_report_id is None
    assert result.approved_scene_id is None
    assert calls == []
    assert [run.skill_name for run in runner.runs] == ["generate"]


def _request() -> NovelLoopRequest:
    return NovelLoopRequest(book_id=1, chapter_id=2, chapter_index=1, chapter_goal="开场")
