from __future__ import annotations

from storyforge_workflow.orchestrators.novel_loop import NovelLoopRequest
from storyforge_workflow.skills.definitions import DEFAULT_NOVEL_SKILL_REGISTRY
from storyforge_workflow.skills.runner import NovelSkillRun, NovelSkillRunner


def test_skill_run_keeps_reference_fields_without_full_payload() -> None:
    """技能运行记录只暴露引用和预算，不保存完整正文或提示词。"""

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
    """runner 应复用既有 NovelSkillRegistry 查询技能定义。"""

    runner = NovelSkillRunner(registry=DEFAULT_NOVEL_SKILL_REGISTRY)

    definition = runner.definition_for("judge")

    assert definition.name == "judge"
    assert definition.version == "1.0.0"


def test_runner_records_generate_skill_run() -> None:
    """generate 包装应执行端口、记录 ModelRun 引用和草稿 hash。"""

    runner = NovelSkillRunner.default()
    request = _request()

    draft, model_run_id = runner.run_generate(
        request=request,
        context_id="ctx-1",
        generate_scene=lambda req, context_id: "林岚推开灯塔铁门。",
        record_model_run=lambda req, draft: 99,
    )

    payload = runner.runs[-1].to_audit_dict()

    assert draft == "林岚推开灯塔铁门。"
    assert model_run_id == 99
    assert payload["skill_name"] == "generate"
    assert payload["status"] == "generated"
    assert payload["input_refs"] == {"chapter_id": 2, "chapter_index": 3, "compiled_context_id": "ctx-1"}
    assert payload["output_refs"]["model_run_id"] == 99
    assert payload["output_refs"]["draft_hash"].startswith("sha256:")
    assert "draft" not in payload


def test_runner_records_judge_skill_run() -> None:
    """judge 包装应保留报告、修复补丁和决策引用。"""

    runner = NovelSkillRunner.default()

    report = runner.run_judge(
        draft="存在节奏问题的草稿。",
        attempt=1,
        judge_scene=lambda draft, attempt: {
            "status": "repair",
            "judge_report_id": 41,
            "repair_patch_id": 42,
            "decision": "需要压缩铺垫",
        },
    )

    payload = runner.runs[-1].to_audit_dict()

    assert report["status"] == "repair"
    assert payload["skill_name"] == "judge"
    assert payload["status"] == "repair"
    assert payload["book_id"] is None
    assert payload["output_refs"] == {"judge_report_id": 41, "repair_patch_id": 42, "decision": "需要压缩铺垫"}
    assert payload["input_refs"] == {"attempt": 1}


def test_runner_records_repair_skill_run() -> None:
    """repair 包装只记录修复尝试，不制造 NovelLoop 终态。"""

    runner = NovelSkillRunner.default()
    report = {"judge_report_id": 41, "repair_patch_id": 42, "status": "repair"}

    draft = runner.run_repair(
        draft="存在节奏问题的草稿。",
        report=report,
        attempt=2,
        repair_scene=lambda draft, report, attempt: "修复后的草稿。",
    )

    payload = runner.runs[-1].to_audit_dict()

    assert draft == "修复后的草稿。"
    assert payload["skill_name"] == "repair"
    assert payload["status"] == "repaired"
    assert payload["book_id"] is None
    assert payload["input_refs"] == {"source_judge_report_id": 41, "attempt": 2}
    assert payload["output_refs"]["repair_patch_id"] == 42
    assert payload["output_refs"]["draft_hash"].startswith("sha256:")


def test_runner_records_approve_skill_run() -> None:
    """approve 包装应保留批准场景与上游 model/judge 证据。"""

    runner = NovelSkillRunner.default()
    request = _request()

    approved_scene_id = runner.run_approve(
        request=request,
        draft="最终草稿。",
        refs={"source_model_run_id": 31, "judge_report_id": 41},
        approve_scene=lambda request, draft, refs: 51,
    )

    payload = runner.runs[-1].to_audit_dict()

    assert approved_scene_id == 51
    assert payload["skill_name"] == "approve"
    assert payload["status"] == "approved"
    assert payload["input_refs"] == {"chapter_id": 2, "chapter_index": 3, "source_model_run_id": 31, "judge_report_id": 41}
    assert payload["output_refs"] == {"approved_scene_id": 51}


def test_runner_records_memory_extract_statuses() -> None:
    """memory_extract 应区分默认跳过与真实写入。"""

    skipped_runner = NovelSkillRunner.default()
    updated_runner = NovelSkillRunner.default()
    request = _request()

    skipped = skipped_runner.run_memory_extract(
        request=request,
        draft="最终草稿。",
        approved_scene_id=51,
        extract_memory=lambda request, draft, approved_scene_id: [],
    )
    updated = updated_runner.run_memory_extract(
        request=request,
        draft="最终草稿。",
        approved_scene_id=51,
        extract_memory=lambda request, draft, approved_scene_id: ["memory:linlan"],
    )

    skipped_payload = skipped_runner.runs[-1].to_audit_dict()
    updated_payload = updated_runner.runs[-1].to_audit_dict()

    assert skipped == []
    assert updated == ["memory:linlan"]
    assert skipped_payload["status"] == "memory_extract_skipped"
    assert skipped_payload["output_refs"] == {"memory_atom_ids": ()}
    assert updated_payload["status"] == "memory_updated"
    assert updated_payload["output_refs"] == {"memory_atom_ids": ("memory:linlan",)}


def _request() -> NovelLoopRequest:
    return NovelLoopRequest(book_id=1, chapter_id=2, chapter_index=3, chapter_goal="揭示灯塔异常")
