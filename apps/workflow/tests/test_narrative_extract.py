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


def test_parse_narrative_scene_fact_accepts_list_wrapped_object() -> None:
    fact = parse_narrative_scene_fact(
        """
        [
          {
            "chapter": 9,
            "primary_scene_mode": "clue_reversal",
            "action_sequence": ["复盘", "指认"],
            "deletable": true
          }
        ]
        """,
        default_chapter=8,
    )

    assert fact.chapter == 9
    assert fact.primary_scene_mode == "clue_reversal"
    assert fact.action_sequence == ("复盘", "指认")
    assert fact.deletable is True
    assert fact.extraction_failed is False


def test_parse_narrative_scene_fact_empty_list_is_invalid_shape() -> None:
    fact = parse_narrative_scene_fact("[]", default_chapter=8)

    assert fact.chapter == 8
    assert fact.extraction_failed is True
    assert fact.extraction_error == "invalid_shape"


def test_parse_narrative_scene_fact_requires_first_list_item_to_be_mapping() -> None:
    fact = parse_narrative_scene_fact(
        '[false, {"chapter": 9, "primary_scene_mode": "ignored"}]', default_chapter=8
    )

    assert fact.chapter == 8
    assert fact.extraction_failed is True
    assert fact.extraction_error == "invalid_shape"


def test_parse_narrative_scene_fact_invalid_chapter_falls_back_to_default() -> None:
    for raw in (
        '{"chapter": false}',
        '{"chapter": true}',
        '{"chapter": 0}',
        '{"chapter": -1}',
        '{"chapter": "8"}',
    ):
        fact = parse_narrative_scene_fact(raw, default_chapter=8)

        assert fact.chapter == 8
        assert fact.extraction_failed is False


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


def test_build_narrative_fact_extract_prompt_includes_schema_types_without_internal_fields() -> None:
    ctx = NarrativeContext(chapter_title="第八章", scene_goal="用旧线索制造关系破裂。")
    prompt = build_narrative_fact_extract_prompt(ctx, "正文。", chapter=8)

    assert '"chapter": int' in prompt
    assert '"primary_scene_mode": string' in prompt
    assert '"action_sequence": array of strings' in prompt
    assert '"conflict_type": string' in prompt
    assert '"protagonist_mistake": string' in prompt
    assert '"cost": string' in prompt
    assert '"relationship_delta": string' in prompt
    assert '"irreversible_consequence": string' in prompt
    assert '"clue_usage_mode": string' in prompt
    assert '"new_evidence": array of strings' in prompt
    assert '"existing_clues_reinterpreted": array of strings' in prompt
    assert '"deletable": boolean true/false' in prompt
    assert "extraction_failed" not in prompt
    assert "extraction_error" not in prompt
