from __future__ import annotations

from storyforge_workflow.orchestrators.novel_loop import NovelLoopPorts, NovelLoopRequest, run_single_chapter_loop
from storyforge_workflow.skills.runner import NovelSkillRunner


def _request() -> NovelLoopRequest:
    return NovelLoopRequest(book_id=1, chapter_id=2, chapter_index=1, chapter_goal="开场")


def test_novel_loop_with_skill_runner_keeps_approved_result_contract() -> None:
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

    result = run_single_chapter_loop(_request(), ports, max_repairs=1, skill_runner=runner)

    assert result.status == "approved"
    assert result.source_model_run_id == 31
    assert result.judge_report_id == 41
    assert result.approved_scene_id == 51
    assert result.skill_runs == [run.to_audit_dict() for run in runner.runs]
    assert [run.skill_name for run in runner.runs] == ["generate", "judge", "approve", "memory_extract"]


def test_novel_loop_with_skill_runner_records_repair_then_approve_path() -> None:
    runner = NovelSkillRunner.default()
    reports = iter([
        {"status": "repair", "judge_report_id": 41, "repair_patch_id": 42},
        {"status": "pass", "judge_report_id": 43},
    ])
    ports = NovelLoopPorts(
        compile_context=lambda request: "ctx-1",
        generate_scene=lambda request, context_id: "初稿。",
        record_model_run=lambda request, draft: 31,
        judge_scene=lambda draft, attempt: next(reports),
        repair_scene=lambda draft, report, attempt: "修订稿。",
        approve_scene=lambda request, draft, refs: 51,
        extract_memory=lambda request, draft, approved_scene_id: [],
    )

    result = run_single_chapter_loop(_request(), ports, max_repairs=1, skill_runner=runner)

    assert result.status == "approved"
    assert result.final_draft == "修订稿。"
    assert result.judge_report_id == 43
    assert result.repair_patch_id == 42
    assert [run.skill_name for run in runner.runs] == ["generate", "judge", "repair", "judge", "approve", "memory_extract"]


def test_novel_loop_with_skill_runner_static_gate_block_does_not_call_judge_scene() -> None:
    runner = NovelSkillRunner.default()
    judge_called = False

    def judge_scene(draft: str, attempt: int) -> dict[str, object]:
        nonlocal judge_called
        judge_called = True
        return {"status": "pass", "judge_report_id": 41}

    ports = NovelLoopPorts(
        compile_context=lambda request: "ctx-1",
        generate_scene=lambda request, context_id: "高危初稿。",
        record_model_run=lambda request, draft: 31,
        judge_scene=judge_scene,
        repair_scene=lambda draft, report, attempt: draft,
        approve_scene=lambda request, draft, refs: 51,
        check_static_quality=lambda draft: [
            {
                "dimension": "结构",
                "severity": "高",
                "message": "必须人工审查。",
                "revision_strategy": "regenerate",
            }
        ],
    )

    result = run_single_chapter_loop(_request(), ports, max_repairs=1, skill_runner=runner)

    assert result.status == "awaiting_review"
    assert judge_called is False
    assert [run.skill_name for run in runner.runs] == ["generate", "judge"]
    assert runner.runs[-1].status == "static_gate_blocked"
    assert "approve" not in [run.skill_name for run in runner.runs]
