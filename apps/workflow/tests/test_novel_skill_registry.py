from __future__ import annotations

from dataclasses import FrozenInstanceError
from pathlib import Path

import pytest

from storyforge_workflow.skills.definitions import (
    DEFAULT_NOVEL_SKILL_REGISTRY,
    NovelSkillDefinition,
    NovelSkillReferences,
    NovelSkillRegistry,
    get_novel_skill,
    list_novel_skills,
)

REQUIRED_SKILLS = ("generate", "judge", "repair", "approve", "memory_extract", "submit_continuity", "export")


def _parse_skill_frontmatter(text: str) -> tuple[dict[str, object], str]:
    """解析技能文件顶部的简单 YAML frontmatter。"""

    delimiter = "---\n"
    assert text.startswith(delimiter)
    _, frontmatter_text, body = text.split(delimiter, 2)
    metadata: dict[str, object] = {}
    for line in frontmatter_text.splitlines():
        if not line.strip():
            continue
        key, separator, value = line.partition(":")
        assert separator == ":", f"frontmatter 行缺少冒号：{line}"
        normalized_value = value.strip()
        if normalized_value.lower() == "true":
            metadata[key.strip()] = True
        elif normalized_value.lower() == "false":
            metadata[key.strip()] = False
        else:
            metadata[key.strip()] = normalized_value
    return metadata, body


def _is_false_value(value: object) -> bool:
    """将 YAML 布尔值和字符串 false 统一判断为禁用。"""

    return value is False or (isinstance(value, str) and value.lower() == "false")


def _assert_all_items_are_documented(items: tuple[str, ...], body: str) -> None:
    """确认 registry 中的每个静态字段都出现在技能正文中。"""

    for item in items:
        assert item in body


def test_default_registry_covers_required_novel_skills() -> None:
    """默认注册表必须按 NovelLoop 到 BookLoop 的顺序覆盖六个小说技能。"""

    skills = DEFAULT_NOVEL_SKILL_REGISTRY.all()

    assert tuple(skill.name for skill in skills) == REQUIRED_SKILLS
    assert tuple(skill.stage for skill in skills) == ("chapter", "chapter", "chapter", "chapter", "chapter", "chapter", "book")
    assert len({skill.name for skill in skills}) == len(skills)


def test_registry_exposes_generate_and_judge_contracts() -> None:
    """关键技能条目必须暴露引用化输入、输出、门禁、审计和状态契约。"""

    generate = DEFAULT_NOVEL_SKILL_REGISTRY.require("generate")
    judge = DEFAULT_NOVEL_SKILL_REGISTRY.require("judge")

    assert generate.version == "1.0.0"
    assert "chapter_id" in generate.input_refs
    assert "model_run_id" in generate.output_refs
    assert "compiled_context_id" in generate.gates
    assert "token_usage" in generate.audit_fields
    assert "llm" in generate.required_capabilities
    assert generate.status_mapping["success"] == "generated"
    assert "NovelLoopPorts.generate_scene" in generate.references.workflow_nodes

    assert judge.status_mapping["repair"] == "repair"
    assert "judge_report_id" in judge.output_refs


def test_registry_queries_by_stage_and_capability() -> None:
    """注册表应支持按阶段、能力和名称查询，并保持注册顺序。"""

    chapter_skills = DEFAULT_NOVEL_SKILL_REGISTRY.by_stage("chapter")
    llm_skills = DEFAULT_NOVEL_SKILL_REGISTRY.by_capability("llm")

    assert tuple(skill.name for skill in chapter_skills) == (
        "generate",
        "judge",
        "repair",
        "approve",
        "memory_extract",
        "submit_continuity",
    )
    assert {skill.name for skill in llm_skills} == {"generate", "judge", "repair"}
    assert get_novel_skill("approve") == DEFAULT_NOVEL_SKILL_REGISTRY.require("approve")
    assert list_novel_skills() == DEFAULT_NOVEL_SKILL_REGISTRY.all()


def test_registry_returns_immutable_snapshots() -> None:
    """技能定义应冻结调用方传入的数据，避免原始 dict 后续污染注册表。"""

    raw_mapping = {"success": "ok"}
    skill = NovelSkillDefinition(
        name="unit.example",
        version="1.0.0",
        stage="chapter",
        description="单元测试技能。",
        input_refs=("chapter_id",),
        output_refs=("model_run_id",),
        gates=("compiled_context_id",),
        audit_fields=("token_usage",),
        status_mapping=raw_mapping,
        required_capabilities=("llm",),
        references=NovelSkillReferences(workflow_nodes=("unit.node",)),
    )

    raw_mapping["success"] = "changed"

    assert skill.status_mapping["success"] == "ok"
    assert skill.input_refs == ("chapter_id",)
    assert skill.references.workflow_nodes == ("unit.node",)
    with pytest.raises(TypeError):
        skill.status_mapping["success"] = "changed"  # type: ignore[index]
    with pytest.raises(FrozenInstanceError):
        skill.name = "unit.changed"  # type: ignore[misc]


def test_registry_rejects_duplicate_names_and_reports_missing_skills() -> None:
    """注册表应拒绝重复名称，并为缺失技能给出明确中文错误。"""

    skill = NovelSkillDefinition(
        name="unit.example",
        version="1.0.0",
        stage="chapter",
        description="单元测试技能。",
        input_refs=("chapter_id",),
        output_refs=("model_run_id",),
        gates=(),
        audit_fields=(),
        status_mapping={"success": "ok"},
        required_capabilities=(),
        references=NovelSkillReferences(),
    )

    with pytest.raises(ValueError, match="小说技能名称重复"):
        NovelSkillRegistry([skill, skill])
    with pytest.raises(KeyError, match="小说技能不存在：missing"):
        DEFAULT_NOVEL_SKILL_REGISTRY.require("missing")
    assert DEFAULT_NOVEL_SKILL_REGISTRY.get("missing") is None


def test_definition_rejects_unknown_stage() -> None:
    """技能 stage 只能描述单章或整书两个执行层级。"""

    with pytest.raises(ValueError, match="小说技能 stage 只能是 chapter 或 book"):
        NovelSkillDefinition(
            name="unit.bad_stage",
            version="1.0.0",
            stage="scene",
            description="非法阶段。",
            input_refs=(),
            output_refs=(),
            gates=(),
            audit_fields=(),
            status_mapping={"success": "ok"},
        )


def test_default_status_mappings_do_not_introduce_book_loop_terminal_states() -> None:
    """默认技能不得虚构 BookLoop 或 NovelLoop 没有承诺的终态。"""

    forbidden = {"repair_required", "repair_limit_exceeded", "provider_failed", "budget_exceeded"}
    for skill in DEFAULT_NOVEL_SKILL_REGISTRY.all():
        assert forbidden.isdisjoint(set(skill.status_mapping.values()))


def test_skill_metadata_files_exist_for_default_registry() -> None:
    root = Path(__file__).parents[1] / "storyforge_workflow" / "skills"
    for skill in DEFAULT_NOVEL_SKILL_REGISTRY.all():
        skill_file = root / skill.name / "SKILL.md"
        assert skill_file.exists(), f"缺少技能元数据文件：{skill_file}"
        text = skill_file.read_text(encoding="utf-8")
        metadata, body = _parse_skill_frontmatter(text)

        assert metadata["skill_name"] == skill.name
        assert metadata["version"] == skill.version
        assert metadata["stage"] == skill.stage
        assert _is_false_value(metadata["dynamic_execution"])
        assert metadata["dynamic_execution"] is not True
        assert "dynamic_execution: true" not in text
        assert "完整 prompt" not in text
        assert "完整正文" not in text
        _assert_all_items_are_documented(tuple(skill.input_refs), body)
        _assert_all_items_are_documented(tuple(skill.output_refs), body)
        _assert_all_items_are_documented(tuple(skill.gates), body)
        _assert_all_items_are_documented(tuple(skill.audit_fields), body)
        for source_status, target_status in skill.status_mapping.items():
            assert source_status in body
            assert target_status in body
