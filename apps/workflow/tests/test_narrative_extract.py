from __future__ import annotations

from storyforge_workflow.narrative.extract import (
    NarrativeSceneFact,
    build_narrative_fact_extract_prompt,
    parse_narrative_scene_fact,
)
from storyforge_workflow.prompts.models import NarrativeContext


def test_parse_narrative_scene_fact_normalizes_single_object() -> None:
    payload = """
    {
      "chapter": 8,
      "primary_scene_mode": "character_conflict",
      "action_sequence": ["对峙", "误判", "失去证人保护资格"],
      "conflict_type": "人物冲突",
      "protagonist_mistake": "林岚误信灯塔账本",
      "cost": "证人保护资格被撤销",
      "relationship_delta": "林岚与周砚信任破裂",
      "irreversible_consequence": "证人保护资格被撤销",
      "clue_usage_mode": "reinterpret_existing",
      "new_evidence": [],
      "existing_clues_reinterpreted": ["黑盒"],
      "deletable": false
    }
    """

    fact = parse_narrative_scene_fact(payload, default_chapter=8)

    assert fact == NarrativeSceneFact(
        chapter=8,
        primary_scene_mode="character_conflict",
        action_sequence=("对峙", "误判", "失去证人保护资格"),
        conflict_type="人物冲突",
        protagonist_mistake="林岚误信灯塔账本",
        cost="证人保护资格被撤销",
        relationship_delta="林岚与周砚信任破裂",
        irreversible_consequence="证人保护资格被撤销",
        clue_usage_mode="reinterpret_existing",
        new_evidence=(),
        existing_clues_reinterpreted=("黑盒",),
        deletable=False,
        extraction_failed=False,
    )


def test_parse_narrative_scene_fact_fail_soft_on_bad_json() -> None:
    fact = parse_narrative_scene_fact("not json", default_chapter=12)

    assert fact.chapter == 12
    assert fact.extraction_failed is True
    assert fact.extraction_error == "invalid_json"


def test_build_narrative_fact_extract_prompt_requests_json_only() -> None:
    ctx = NarrativeContext(chapter_title="第八章", scene_goal="用旧线索制造关系破裂。")
    prompt = build_narrative_fact_extract_prompt(
        ctx, "林岚没有去新地点，她把黑盒旧记录重新解释。", chapter=8
    )

    assert "Return only a valid JSON object" in prompt
    assert "primary_scene_mode" in prompt
    assert "relationship_delta" in prompt
    assert "existing_clues_reinterpreted" in prompt
    assert "待抽取正文" in prompt
