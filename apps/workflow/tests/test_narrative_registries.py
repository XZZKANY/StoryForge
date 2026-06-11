from __future__ import annotations

from storyforge_workflow.narrative.name_registry import NameRegistry
from storyforge_workflow.narrative.repetition_ledger import RepetitionLedger
from storyforge_workflow.narrative.timeline_ledger import TimelineLedger


def test_name_registry_fails_same_display_name_for_different_identity() -> None:
    registry = NameRegistry()
    registry.record(identity_id="lin-lan", display_name="林岚", chapter=1)

    verdict = registry.record(identity_id="lin-mirror", display_name="林岚", chapter=6)

    assert verdict.status == "fail"
    assert "同一显示名指向不同身份" in verdict.issues[0]["message"]


def test_name_registry_warns_single_use_clue_only_character() -> None:
    registry = NameRegistry()
    registry.record(identity_id="guard-1", display_name="门卫", chapter=8, role="clue_only")

    verdict = registry.audit()

    assert verdict.status == "warn"
    assert "single-use clue-only character" in verdict.issues[0]["message"]


def test_timeline_ledger_fails_item_available_today_without_time_jump() -> None:
    ledger = TimelineLedger()
    ledger.record_availability(chapter=17, item="盐蚀芯片", available_in_days=3)

    verdict = ledger.claim_available_today(chapter=18, item="盐蚀芯片", days_elapsed_since_last=0)

    assert verdict.status == "fail"
    assert "available in 3 days" in verdict.issues[0]["message"]
    assert "available today without time jump" in verdict.issues[0]["message"]


def test_repetition_ledger_fails_static_left_arm_injury_overuse() -> None:
    ledger = RepetitionLedger()
    verdict = None
    for chapter in range(1, 7):
        verdict = ledger.record_motif(
            chapter=chapter,
            motif="左臂旧伤",
            changes_action=False,
        )

    assert verdict is not None
    assert verdict.status == "fail"
    assert "Left arm old injury >5" in verdict.issues[0]["message"]


def test_repetition_ledger_fails_save_encrypt_sync_overuse() -> None:
    ledger = RepetitionLedger()
    verdict = None
    for chapter in range(1, 5):
        verdict = ledger.record_action_pattern(chapter=chapter, pattern="save/encrypt/sync")

    assert verdict is not None
    assert verdict.status == "fail"
    assert "Save/encrypt/sync action repeated >3" in verdict.issues[0]["message"]
