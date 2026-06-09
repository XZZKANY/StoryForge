from __future__ import annotations

from storyforge_workflow.orchestrators.novel_loop import (
    NovelLoopPorts,
    NovelLoopRequest,
    run_single_chapter_loop,
)
from storyforge_workflow.skills.runner import NovelSkillRunner


def _base_ports(**overrides) -> NovelLoopPorts:
    defaults = dict(
        compile_context=lambda request: "ctx-1",
        generate_scene=lambda request, context_id: "林岚在雾港确认旧伤。",
        judge_scene=lambda draft, attempt: {"status": "pass", "judge_report_id": 11},
        repair_scene=lambda draft, report, attempt: draft,
        approve_scene=lambda request, draft, evidence: 21,
        record_model_run=lambda request, draft: 31,
    )
    defaults.update(overrides)
    return NovelLoopPorts(**defaults)


def _request() -> NovelLoopRequest:
    return NovelLoopRequest(book_id=1, chapter_id=2, chapter_index=1, chapter_goal="完成雾港开篇。")


def test_submit_continuity_default_skips_without_edges() -> None:
    """默认不注入 submit_continuity → 零边、行为不变。"""

    result = run_single_chapter_loop(_request(), _base_ports(), max_repairs=1)

    assert result.status == "approved"
    assert result.continuity_edge_count == 0


def test_submit_continuity_records_edge_count_via_port() -> None:
    """注入 submit_continuity 返回边数 → 写入结果。"""

    calls: list[str] = []
    ports = _base_ports(
        submit_continuity=lambda request, draft, approved_scene_id: calls.append(
            f"submit:{approved_scene_id}:{request.chapter_id}"
        )
        or {"continuity_edge_count": 2},
    )

    result = run_single_chapter_loop(_request(), ports, max_repairs=1)

    assert result.continuity_edge_count == 2
    assert calls == ["submit:21:2"]


def test_submit_continuity_audit_via_skill_runner() -> None:
    """skill_runner 路径下提交边应记 continuity_submitted 审计；默认记 continuity_skipped。"""

    runner = NovelSkillRunner.default()
    ports = _base_ports(submit_continuity=lambda request, draft, approved_scene_id: {"continuity_edge_count": 3})

    result = run_single_chapter_loop(_request(), ports, max_repairs=1, skill_runner=runner)

    assert result.continuity_edge_count == 3
    submit_runs = [run for run in runner.runs if run.skill_name == "submit_continuity"]
    assert len(submit_runs) == 1
    assert submit_runs[0].status == "continuity_submitted"
    assert submit_runs[0].output_refs["continuity_edge_count"] == 3


def test_submit_continuity_skipped_audit_when_default() -> None:
    """默认 skip-stub 经 skill_runner 记 continuity_skipped、零边。"""

    runner = NovelSkillRunner.default()

    result = run_single_chapter_loop(_request(), _base_ports(), max_repairs=1, skill_runner=runner)

    assert result.continuity_edge_count == 0
    submit_runs = [run for run in runner.runs if run.skill_name == "submit_continuity"]
    assert len(submit_runs) == 1
    assert submit_runs[0].status == "continuity_skipped"
