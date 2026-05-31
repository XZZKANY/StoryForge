from __future__ import annotations

from storyforge_workflow.orchestrators.novel_loop import NovelLoopRequest
from storyforge_workflow.skills.definitions import NovelSkillRegistry
from storyforge_workflow.skills.runner import NovelSkillRun, NovelSkillRunner


def _request() -> NovelLoopRequest:
    return NovelLoopRequest(book_id=1, chapter_id=2, chapter_index=3, chapter_goal="揭示灯塔异常")


def test_skill_run_keeps_reference_fields_without_full_payload() -> None:
    run = NovelSkillRun(
        skill_name="generate",
        skill_version="1.0.0",
        status="generated",
        book_id=10,
        chapter_index=1,
        input_refs={"compiled_context_id": "ctx-1"},
        output_refs={"model_run_id": 55, "draft_hash": "sha256:abc"},
        budget={"token_usage": 120, "elapsed_time_sec": 2, "cost_estimate": 0.01},
    )

    payload = run.to_audit_dict()

    assert payload["skill_name"] == "generate"
    assert payload["output_refs"] == {"model_run_id": 55, "draft_hash": "sha256:abc"}
    assert "draft" not in payload
    assert "prompt" not in payload
    assert "scene_packet" not in payload


def test_skill_runner_resolves_definition_by_name() -> None:
    runner = NovelSkillRunner(registry=NovelSkillRegistry.default())

    definition = runner.definition_for("judge")

    assert definition.name == "judge"
    assert definition.version == "1.0.0"


def test_runner_records_generate_skill_run() -> None:
    runner = NovelSkillRunner.default()

    draft, model_run_id = runner.run_generate(
        request=_request(),
        context_id="ctx-1",
        generate_scene=lambda req, context_id: "林岚推开灯塔铁门。",
        record_model_run=lambda req, draft: 99,
    )

    assert draft == "林岚推开灯塔铁门。"
    assert model_run_id == 99
    assert runner.runs[-1].skill_name == "generate"
    assert runner.runs[-1].status == "generated"
    assert runner.runs[-1].input_refs == {"compiled_context_id": "ctx-1"}
    assert runner.runs[-1].output_refs["model_run_id"] == 99
    assert "draft_hash" in runner.runs[-1].output_refs
    assert "林岚" not in str(runner.runs[-1].to_audit_dict())


def test_runner_records_judge_repair_approve_and_memory_extract_runs() -> None:
    runner = NovelSkillRunner.default()
    request = _request()

    judge_report = runner.run_judge(
        draft="林岚推开灯塔铁门。",
        attempt=0,
        judge_scene=lambda draft, attempt: {"status": "repair", "judge_report_id": 41, "repair_patch_id": 42},
        request=request,
        model_run_id=99,
    )
    repaired = runner.run_repair(
        draft="林岚推开灯塔铁门。",
        report=judge_report,
        attempt=1,
        repair_scene=lambda draft, report, attempt: "林岚推开灯塔铁门，听见潮声倒灌。",
        request=request,
    )
    approved_scene_id = runner.run_approve(
        request=request,
        draft=repaired,
        refs={"source_model_run_id": 99, "judge_report_id": 41, "repair_patch_id": 42},
        approve_scene=lambda request, draft, refs: 51,
    )
    skipped_memory = runner.run_memory_extract(
        request=request,
        draft=repaired,
        approved_scene_id=approved_scene_id,
        extract_memory=lambda request, draft, approved_scene_id: [],
    )
    updated_memory = runner.run_memory_extract(
        request=request,
        draft=repaired,
        approved_scene_id=approved_scene_id,
        extract_memory=lambda request, draft, approved_scene_id: ["mem-1"],
    )

    assert repaired == "林岚推开灯塔铁门，听见潮声倒灌。"
    assert approved_scene_id == 51
    assert skipped_memory == []
    assert updated_memory == ["mem-1"]
    assert [run.skill_name for run in runner.runs] == ["judge", "repair", "approve", "memory_extract", "memory_extract"]
    assert runner.runs[0].output_refs == {"judge_report_id": 41, "repair_patch_id": 42, "decision": "repair"}
    assert runner.runs[1].output_refs["source_judge_report_id"] == 41
    assert runner.runs[1].output_refs["attempt"] == 1
    assert runner.runs[1].output_refs["repair_patch_id"] == 42
    assert runner.runs[2].output_refs == {"approved_scene_id": 51, "source_model_run_id": 99, "judge_report_id": 41, "repair_patch_id": 42}
    assert runner.runs[3].status == "memory_extract_skipped"
    assert runner.runs[4].status == "memory_updated"
    assert runner.runs[4].output_refs["memory_atom_ids"] == ["mem-1"]
