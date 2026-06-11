from __future__ import annotations

from storyforge_workflow.narrative.entity_budget import ChapterEntityDelta, EntityBudgetGate


def test_entity_budget_fails_new_core_location_after_chapter_20() -> None:
    verdict = EntityBudgetGate().validate(
        ChapterEntityDelta(chapter=20, new_core_locations=["海底档案馆"])
    )

    assert verdict.status == "fail"
    assert "chapter 20+新增核心地点" in verdict.issues[0]["message"]


def test_entity_budget_fails_new_mystery_after_chapter_25() -> None:
    verdict = EntityBudgetGate().validate(
        ChapterEntityDelta(chapter=25, new_mysteries=["谁改写了灯塔钟声"])
    )

    assert verdict.status == "fail"
    assert "chapter 25+新增新谜题" in verdict.issues[0]["message"]


def test_entity_budget_fails_new_core_evidence_after_chapter_30() -> None:
    verdict = EntityBudgetGate().validate(
        ChapterEntityDelta(chapter=30, new_core_evidence=["VX-9设备型号"])
    )

    assert verdict.status == "fail"
    assert "chapter 30新增设备型号/core evidence" in verdict.issues[0]["message"]
