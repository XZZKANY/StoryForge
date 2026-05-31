from __future__ import annotations

from pathlib import Path

import pytest

from storyforge_workflow.skills.definitions import NovelSkillRegistry

GENRE_SKILLS = {
    "mystery": "clue_fairness_judge",
    "xuanhuan": "power_scale_guard",
    "romance": "relationship_arc_judge",
}
FORBIDDEN_BOOK_RUN_STATES = {
    "completed",
    "awaiting_review",
    "paused_by_budget",
    "paused_by_provider_degradation",
    "paused_by_user",
    "stopped",
    "failed",
}


def _parse_skill_frontmatter(text: str) -> tuple[dict[str, object], str]:
    delimiter = "---\n"
    assert text.startswith(delimiter)
    _, frontmatter_text, body = text.split(delimiter, 2)
    metadata: dict[str, object] = {}
    for line in frontmatter_text.splitlines():
        if not line.strip():
            continue
        key, separator, value = line.partition(":")
        assert separator == ":", f"frontmatter 行缺少冒号：{line}"
        normalized = value.strip()
        if normalized.lower() == "true":
            metadata[key.strip()] = True
        elif normalized.lower() == "false":
            metadata[key.strip()] = False
        else:
            metadata[key.strip()] = normalized
    return metadata, body


def test_default_registry_does_not_load_genre_skills() -> None:
    """默认 registry 只能包含通用技能，不能自动加载题材扩展。"""

    registry = NovelSkillRegistry.default()

    for skill_name in GENRE_SKILLS.values():
        assert skill_name not in registry.names()


@pytest.mark.parametrize(("genre", "skill_name"), tuple(GENRE_SKILLS.items()))
def test_registry_loads_genre_pack_explicitly(genre: str, skill_name: str) -> None:
    """显式选择题材包时，只加入对应题材技能。"""

    registry = NovelSkillRegistry.with_genre_pack(genre)

    assert skill_name in registry.names()
    for other_skill in set(GENRE_SKILLS.values()) - {skill_name}:
        assert other_skill not in registry.names()
    assert registry.require(skill_name).version == "1.0.0"
    assert registry.require(skill_name).stage == "chapter"


def test_unknown_genre_pack_reports_genre_name() -> None:
    """未知题材必须给出包含 genre 名称的明确错误。"""

    with pytest.raises(ValueError, match="unknown"):
        NovelSkillRegistry.with_genre_pack("unknown")


@pytest.mark.parametrize(("genre", "skill_name"), tuple(GENRE_SKILLS.items()))
def test_genre_skill_statuses_do_not_add_book_run_terminal_states(genre: str, skill_name: str) -> None:
    """题材技能只能使用技能阶段态，不能新增 BookRun 终态。"""

    skill = NovelSkillRegistry.with_genre_pack(genre).require(skill_name)

    assert FORBIDDEN_BOOK_RUN_STATES.isdisjoint(set(skill.status_mapping.values()))


@pytest.mark.parametrize(
    ("genre", "skill_name"),
    tuple(GENRE_SKILLS.items()),
)
def test_genre_skill_metadata_files_match_registry(genre: str, skill_name: str) -> None:
    """题材 SKILL.md 必须与 registry 契约保持一致。"""

    skill = NovelSkillRegistry.with_genre_pack(genre).require(skill_name)
    skill_file = Path(__file__).parents[1] / "storyforge_workflow" / "skills" / f"genre_{genre}" / skill_name / "SKILL.md"
    assert skill_file.exists(), f"缺少题材技能元数据文件：{skill_file}"
    metadata, body = _parse_skill_frontmatter(skill_file.read_text(encoding="utf-8"))

    assert metadata["skill_name"] == skill.name
    assert metadata["name"] == skill.name
    assert metadata["version"] == skill.version
    assert metadata["stage"] == skill.stage
    assert metadata["genre"] == genre
    assert metadata["dynamic_execution"] is False
    assert "dynamic_execution: true" not in body
    assert "完整 prompt" not in body
    assert "完整正文" not in body
    for item in (*skill.input_refs, *skill.output_refs, *skill.gates, *skill.audit_fields):
        assert item in body
    for source_status, target_status in skill.status_mapping.items():
        assert source_status in body
        assert target_status in body
