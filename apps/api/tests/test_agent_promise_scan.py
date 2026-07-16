"""project.promise_check 伏笔承诺记账：确定性、只读、无 LLM 可证伪。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from app.domains.agent_runs.promise_scan import check_promises, promise_check


def _canon(promises: object) -> dict[str, Any]:
    return {"version": 1, "entities": [], "invariants": {"promises": promises}}


def _categories(result: dict[str, Any], layer: str) -> set[str]:
    return {issue["category"] for issue in result[layer]}


@pytest.mark.parametrize("resolved_chapter", [None, "40", True, 0, -1])
def test_resolved_requires_valid_resolved_chapter(resolved_chapter: object) -> None:
    promise = {
        "id": "gift-sword",
        "status": "resolved",
        "planted_chapter": 3,
        "resolved_chapter": resolved_chapter,
    }

    flagged = check_promises(_canon([promise]), 40)
    clean = check_promises(_canon([{**promise, "resolved_chapter": 3}]), 40)

    assert "resolved_chapter" in _categories(flagged, "conflicts")
    assert "resolved_chapter" not in _categories(clean, "conflicts")


def test_resolved_before_planted_has_positive_and_boundary_cases() -> None:
    base = {"id": "sealed-letter", "status": "resolved", "planted_chapter": 8}

    flagged = check_promises(_canon([{**base, "resolved_chapter": 7}]), 20)
    boundary = check_promises(_canon([{**base, "resolved_chapter": 8}]), 20)

    assert "resolved_before_planted" in _categories(flagged, "conflicts")
    assert "resolved_before_planted" not in _categories(boundary, "conflicts")


def test_due_before_planted_has_positive_and_boundary_cases() -> None:
    base = {"id": "tower-bell", "status": "planted", "planted_chapter": 12}

    flagged = check_promises(_canon([{**base, "due_chapter": 11}]), 20)
    boundary = check_promises(_canon([{**base, "due_chapter": 12}]), 20)

    assert "due_before_planted" in _categories(flagged, "conflicts")
    assert "due_before_planted" not in _categories(boundary, "conflicts")


def test_duplicate_ids_are_normalized_and_reported_once() -> None:
    result = check_promises(
        _canon(
            [
                {"id": "moon-mark", "status": "planted", "planted_chapter": 2},
                {"id": " moon-mark ", "status": "advancing", "planted_chapter": 2},
            ]
        ),
        10,
    )

    duplicates = [issue for issue in result["conflicts"] if issue["category"] == "duplicate_id"]
    assert len(duplicates) == 1
    assert duplicates[0]["promise_id"] == "moon-mark"
    assert duplicates[0]["occurrences"] == 2


def test_overdue_uses_strict_due_boundary_and_active_statuses() -> None:
    base = {
        "id": "old-oath",
        "kind": "foreshadow",
        "planted_chapter": 3,
        "due_chapter": 40,
    }

    at_due = check_promises(_canon([{**base, "status": "planted"}]), 40)
    planted_overdue = check_promises(_canon([{**base, "status": "planted"}]), 41)
    advancing_overdue = check_promises(_canon([{**base, "status": "advancing"}]), 41)
    dropped = check_promises(_canon([{**base, "status": "dropped"}]), 41)

    assert "overdue" not in _categories(at_due, "advisories")
    assert "overdue" in _categories(planted_overdue, "advisories")
    assert "overdue" in _categories(advancing_overdue, "advisories")
    assert "overdue" not in _categories(dropped, "advisories")


def test_open_window_stall_uses_inclusive_threshold_and_override() -> None:
    promise = {
        "id": "scar-memory",
        "kind": "foreshadow",
        "planted_chapter": 3,
        "due_chapter": None,
        "status": "planted",
    }

    below = check_promises(_canon([promise]), 32)
    at_default = check_promises(_canon([promise]), 33)
    at_override = check_promises(_canon([promise]), 13, stale_after_chapters=10)

    assert "stalled" not in _categories(below, "advisories")
    assert "stalled" in _categories(at_default, "advisories")
    assert "stalled" in _categories(at_override, "advisories")


def test_stall_uses_declared_last_touch_without_sorting() -> None:
    promise = {
        "id": "broken-compass",
        "kind": "foreshadow",
        "planted_chapter": 3,
        "due_chapter": None,
        "status": "planted",
        "touches": [25, 10],
    }

    result = check_promises(_canon([promise]), 40)

    issue = next(issue for issue in result["advisories"] if issue["category"] == "stalled")
    assert issue["last_touch_chapter"] == 10
    assert issue["gap_chapters"] == 30


def test_recurring_cadence_uses_strict_gap_boundary() -> None:
    promise = {
        "id": "red-moon",
        "kind": "recurring",
        "planted_chapter": 2,
        "due_chapter": 50,
        "status": "advancing",
        "touches": [7],
        "cadence_chapters": 5,
    }

    at_cadence = check_promises(_canon([promise]), 12)
    beyond_cadence = check_promises(_canon([promise]), 13)

    assert "cadence_gap" not in _categories(at_cadence, "advisories")
    assert "cadence_gap" in _categories(beyond_cadence, "advisories")


@pytest.mark.parametrize(
    "canon",
    [
        {},
        {"invariants": None},
        {"invariants": {}},
        _canon({}),
        _canon([None, {}, {"id": 7}, {"id": "   "}]),
    ],
)
def test_empty_missing_and_bad_declarations_return_honest_empty_state(canon: dict[str, Any]) -> None:
    result = check_promises(canon, 0)

    assert result["promise_count"] == 0
    assert result["checked_promises"] == []
    assert result["conflicts"] == []
    assert result["advisories"] == []
    assert "没有可检查项" in result["summary"]


def test_bad_field_types_do_not_become_default_facts() -> None:
    promise = {
        "id": "bad-types",
        "kind": "recurring",
        "planted_chapter": True,
        "due_chapter": "40",
        "status": "planted",
        "touches": "7, 15",
        "cadence_chapters": "5",
    }

    result = check_promises(_canon([promise]), 80)

    assert result["promise_count"] == 1
    assert result["conflicts"] == []
    assert result["advisories"] == []


def test_issue_shape_and_id_stay_stable_as_current_chapter_advances() -> None:
    promise = {
        "id": "gift-sword",
        "title": "赠剑伏笔",
        "kind": "foreshadow",
        "planted_chapter": 3,
        "due_chapter": 40,
        "status": "planted",
    }

    first = check_promises(_canon([promise]), 41)["advisories"][0]
    later = check_promises(_canon([promise]), 60)["advisories"][0]

    assert first["id"] == later["id"]
    assert first["id"].startswith("promise_")
    assert {"id", "category", "severity", "message", "promise_id", "title"} <= set(first)


def test_project_wrapper_reads_chapter_order_without_writing_canon(tmp_path: Path) -> None:
    (tmp_path / "正文").mkdir()
    (tmp_path / "正文" / "第01章.md").write_text("第一章。\n", encoding="utf-8")
    (tmp_path / "正文" / "第02章.md").write_text("第二章。\n", encoding="utf-8")
    (tmp_path / ".draft").mkdir()
    (tmp_path / ".draft" / "隐藏章.md").write_text("不计入。\n", encoding="utf-8")
    canon_dir = tmp_path / ".storyforge" / "canon"
    canon_dir.mkdir(parents=True)
    canon_file = canon_dir / "canon.json"
    canon_file.write_text(
        json.dumps(
            _canon(
                [
                    {
                        "id": "first-clue",
                        "kind": "foreshadow",
                        "planted_chapter": 1,
                        "due_chapter": 1,
                        "status": "planted",
                    }
                ]
            ),
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    before = canon_file.read_bytes()

    result = promise_check(str(tmp_path))

    assert result["current_chapter"] == 2
    assert result["advisory_count"] == 1
    assert canon_file.read_bytes() == before
    assert not (canon_dir / "derived").exists()


def test_missing_canon_remains_missing_after_project_check(tmp_path: Path) -> None:
    (tmp_path / "正文").mkdir()
    (tmp_path / "正文" / "第01章.md").write_text("第一章。\n", encoding="utf-8")

    result = promise_check(str(tmp_path))

    assert result["current_chapter"] == 1
    assert result["promise_count"] == 0
    assert not (tmp_path / ".storyforge").exists()


@pytest.mark.parametrize("threshold", [0, -1, True, "30"])
def test_invalid_stale_threshold_is_rejected(threshold: object) -> None:
    with pytest.raises(ValueError):
        check_promises(_canon([]), 0, stale_after_chapters=threshold)  # type: ignore[arg-type]
