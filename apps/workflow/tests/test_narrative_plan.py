from __future__ import annotations

from storyforge_workflow.narrative.plan import NarrativePlan


def test_narrative_plan_normalizes_dicts_and_summarizes_without_full_text() -> None:
    plan = NarrativePlan.from_dict(
        {
            "premise": "灯塔城的旧航线被人刻意抹除。",
            "truth": "失踪舰队被盟友藏进了禁航区。",
            "protagonist_arc": "从逃避代价到主动承担代价。",
            "antagonist_motive": "阻止城市知道停电真相。",
            "locked": True,
            "allowed_characters": ["林岚", {"name": "周砚", "aliases": ["周医生"]}],
            "allowed_locations": ["灯塔", "潮汐档案馆"],
            "allowed_evidence": ["盐蚀芯片"],
            "allowed_mysteries": ["旧航线为何被删"],
            "major_reversals": ["盟友其实在保护舰队"],
            "chapter_beats": [
                {
                    "chapter": 1,
                    "function": "建立危机",
                    "summary": "林岚在灯塔底层发现芯片，并被迫交出母亲留下的钥匙。",
                    "relationship_change": "林岚不再信任周砚",
                    "irreversible_consequence": "钥匙落入审查官手中",
                    "new_core_entities": {"evidence": ["盐蚀芯片"]},
                }
            ],
            "phase_policy": {"phase": "开局", "allowed_expansion": True},
            "entity_budget": {"key_characters": 4},
        }
    )

    assert plan.locked is True
    assert plan.allowed_characters[1].display == "周砚"
    assert plan.allowed_characters[1].aliases == ("周医生",)
    assert plan.chapter_beats[0].chapter == 1
    assert plan.phase_policy.phase == "开局"
    assert plan.entity_budget.key_characters == 4

    summary = plan.compact_summary()
    assert summary["premise"] == "灯塔城的旧航线被人刻意抹除。"
    assert summary["locked"] is True
    assert summary["chapter_count"] == 1
    assert summary["allowed_characters"] == ["林岚", "周砚"]
    assert "林岚在灯塔底层发现芯片" not in str(summary)


def test_narrative_plan_parses_repetition_policy() -> None:
    plan = NarrativePlan.from_dict(
        {
            "premise": "x",
            "truth": "y",
            "protagonist_arc": "z",
            "antagonist_motive": "m",
            "repetition_policy": {
                "tracked_motifs": [{"key": "old_wound", "terms": ["旧伤"], "threshold": 2}],
                "tracked_action_patterns": [{"key": "archive_loop", "terms": ["归档", "同步"], "threshold": 1}],
            },
        }
    )

    assert plan.repetition_policy.tracked_motifs[0].key == "old_wound"
    assert plan.repetition_policy.tracked_motifs[0].terms == ("旧伤",)
    assert plan.repetition_policy.tracked_action_patterns[0].threshold == 1


def test_narrative_plan_drops_repetition_policy_entries_with_blank_keys() -> None:
    plan = NarrativePlan.from_dict(
        {
            "premise": "x",
            "truth": "y",
            "protagonist_arc": "z",
            "antagonist_motive": "m",
            "repetition_policy": {
                "tracked_motifs": [
                    {"key": " ", "terms": ["旧伤"], "threshold": 1},
                    {"key": "old_wound", "terms": ["旧伤"], "threshold": 2},
                ],
                "tracked_action_patterns": [{"terms": ["归档", "同步"], "threshold": 1}],
            },
        }
    )

    assert [pattern.key for pattern in plan.repetition_policy.tracked_motifs] == ["old_wound"]
    assert plan.repetition_policy.tracked_action_patterns == ()
