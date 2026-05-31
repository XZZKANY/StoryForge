from __future__ import annotations

import pytest

from storyforge_workflow.skills import DEFAULT_NOVEL_SKILL_REGISTRY, NovelSkillDefinition, NovelSkillRegistry

EXPECTED_SKILL_NAMES = ("generate", "judge", "repair", "approve", "memory_extract", "export")
FORBIDDEN_STATUS_VALUES = {"repair_required", "repair_limit_exceeded", "provider_failed", "budget_exceeded"}


def test_default_registry_exposes_six_skills_in_chain_order() -> None:
    """默认小说技能注册表必须按 BookRun 技能链顺序暴露六个技能。"""

    registry = DEFAULT_NOVEL_SKILL_REGISTRY

    assert registry.names() == EXPECTED_SKILL_NAMES
    assert tuple(skill.name for skill in registry.list()) == EXPECTED_SKILL_NAMES


def test_skill_definitions_have_required_contract_fields() -> None:
    """每个技能定义必须包含阶段一审计所需的完整契约字段。"""

    for skill_name in EXPECTED_SKILL_NAMES:
        definition = DEFAULT_NOVEL_SKILL_REGISTRY.get(skill_name)

        assert definition.name == skill_name
        assert definition.version == "1.0.0"
        assert definition.description
        assert definition.trigger_conditions
        assert definition.required_inputs
        assert definition.produced_outputs
        assert definition.allowed_statuses
        assert definition.audit_fields


def test_skill_definitions_match_stage_one_contract_details() -> None:
    """关键输入、输出、状态和审计字段必须贴合 NovelLoop/BookLoop 真实契约。"""

    generate = DEFAULT_NOVEL_SKILL_REGISTRY.get("generate")
    judge = DEFAULT_NOVEL_SKILL_REGISTRY.get("judge")
    repair = DEFAULT_NOVEL_SKILL_REGISTRY.get("repair")
    approve = DEFAULT_NOVEL_SKILL_REGISTRY.get("approve")
    memory_extract = DEFAULT_NOVEL_SKILL_REGISTRY.get("memory_extract")
    export = DEFAULT_NOVEL_SKILL_REGISTRY.get("export")

    assert "compiled_context_id" in generate.required_inputs
    assert "model_run_id" in generate.produced_outputs
    assert generate.allowed_statuses == ("generated",)

    assert "static_gate_blocked" in judge.allowed_statuses
    assert "awaiting_review" in judge.allowed_statuses
    assert "judge_report_id" in judge.produced_outputs
    assert "repair_patch_id" in judge.produced_outputs

    assert repair.allowed_statuses == ("repaired",)
    assert "source_judge_report_id" in repair.audit_fields
    assert "repair_patch_id" in repair.audit_fields

    assert approve.allowed_statuses == ("approved",)
    assert "approved_scene_id" in approve.produced_outputs
    assert "source_model_run_id" in approve.audit_fields

    assert "memory_extract_skipped" in memory_extract.allowed_statuses
    assert "memory_updated" in memory_extract.allowed_statuses
    assert "memory_extract_failed" in memory_extract.allowed_statuses
    assert "memory_atom_ids" in memory_extract.produced_outputs

    assert export.allowed_statuses == ("exported", "export_failed")
    assert "audit_artifact_id" in export.produced_outputs


def test_registry_reports_missing_and_rejects_duplicate_skills() -> None:
    """注册表应拒绝重复技能名，并为缺失技能给出包含名称的错误。"""

    generate = DEFAULT_NOVEL_SKILL_REGISTRY.get("generate")

    with pytest.raises(KeyError, match="小说技能不存在：missing"):
        DEFAULT_NOVEL_SKILL_REGISTRY.get("missing")
    with pytest.raises(ValueError, match="小说技能名称重复：generate"):
        NovelSkillRegistry([generate, generate])


def test_definitions_do_not_expose_forbidden_status_values() -> None:
    """技能定义不得暴露 NovelLoop/BookLoop 不存在的虚构终态。"""

    for definition in DEFAULT_NOVEL_SKILL_REGISTRY.list():
        joined_fields = " ".join(
            (
                definition.name,
                definition.version,
                definition.description,
                *definition.trigger_conditions,
                *definition.required_inputs,
                *definition.produced_outputs,
                *definition.allowed_statuses,
                *definition.audit_fields,
                *definition.next_skills,
            )
        )
        assert FORBIDDEN_STATUS_VALUES.isdisjoint(joined_fields.split())


def test_definition_validation_rejects_empty_and_forbidden_values() -> None:
    """定义对象应在创建时拒绝空字段和禁止状态，避免坏契约进入注册表。"""

    with pytest.raises(ValueError, match="技能名称不能为空"):
        NovelSkillDefinition(
            name=" ",
            version="1.0.0",
            description="无效技能。",
            trigger_conditions=("已触发",),
            required_inputs=("book_id",),
            produced_outputs=("artifact_id",),
            allowed_statuses=("generated",),
            audit_fields=("skill_name",),
            next_skills=(),
        )
    with pytest.raises(ValueError, match="禁止的技能状态"):
        NovelSkillDefinition(
            name="unit",
            version="1.0.0",
            description="无效技能。",
            trigger_conditions=("已触发",),
            required_inputs=("book_id",),
            produced_outputs=("artifact_id",),
            allowed_statuses=("budget_exceeded",),
            audit_fields=("skill_name",),
            next_skills=(),
        )
