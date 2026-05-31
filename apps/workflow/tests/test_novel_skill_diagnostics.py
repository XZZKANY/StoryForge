from __future__ import annotations

from storyforge_workflow.skills.diagnostics import (
    explain_bookrun_skill_chain,
    list_novel_skill_diagnostics,
    validate_novel_skill_registry,
)


def test_validate_registry_reports_ready_state() -> None:
    report = validate_novel_skill_registry()

    assert report["status"] == "ready"
    assert report["skill_count"] == 6
    assert report["missing_required_skills"] == ()
    assert report["dynamic_execution"] is False


def test_list_novel_skill_diagnostics_is_machine_readable() -> None:
    rows = list_novel_skill_diagnostics()

    assert rows[0]["name"] == "generate"
    assert rows[0]["version"] == "1.0.0"
    assert rows[0]["stage"] == "chapter"
    assert "llm" in rows[0]["required_capabilities"]
    assert rows[-1]["name"] == "export"
    assert rows[-1]["stage"] == "book"


def test_explain_bookrun_skill_chain_describes_fixed_order() -> None:
    explanation = explain_bookrun_skill_chain()

    assert explanation["chapter_chain"] == ("generate", "judge", "repair", "approve", "memory_extract")
    assert explanation["book_chain"] == ("export",)
    assert explanation["dynamic_plugins"] == "disabled"
    assert explanation["status_contract"] == {
        "chapter_terminal": ("approved", "awaiting_review"),
        "book_terminal": ("completed", "awaiting_review", "paused_by_budget", "paused_by_provider_degradation"),
    }
