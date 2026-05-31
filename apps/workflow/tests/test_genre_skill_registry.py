from __future__ import annotations

import pytest

from storyforge_workflow.skills.definitions import FORBIDDEN_STATUS_VALUES, NovelSkillRegistry


def test_default_registry_does_not_load_genre_skills() -> None:
    registry = NovelSkillRegistry.default()

    assert "clue_fairness_judge" not in registry.names()
    assert "power_scale_guard" not in registry.names()
    assert "relationship_arc_judge" not in registry.names()


def test_registry_loads_mystery_pack_explicitly() -> None:
    registry = NovelSkillRegistry.with_genre_pack("mystery")

    assert "clue_fairness_judge" in registry.names()
    assert registry.get("clue_fairness_judge").version == "1.0.0"
    assert "judge" in registry.names()


def test_registry_loads_only_selected_genre_pack() -> None:
    registry = NovelSkillRegistry.with_genre_pack("xuanhuan")

    assert "power_scale_guard" in registry.names()
    assert "clue_fairness_judge" not in registry.names()
    assert "relationship_arc_judge" not in registry.names()


def test_unknown_genre_pack_reports_genre_name() -> None:
    with pytest.raises(ValueError, match="unknown"):
        NovelSkillRegistry.with_genre_pack("unknown")


def test_genre_skill_statuses_do_not_use_bookloop_terminal_states() -> None:
    for genre in ("mystery", "xuanhuan", "romance"):
        registry = NovelSkillRegistry.with_genre_pack(genre)
        for definition in registry.list():
            assert FORBIDDEN_STATUS_VALUES.isdisjoint(definition.allowed_statuses)
