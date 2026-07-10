"""project.entity_budget_check 长篇实体预算检查：确定性、无 LLM、无 key 可验。"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.domains.agent_runs.entity_budget_scan import entity_budget_scan
from app.domains.agent_runs.fs_tools import FsToolError


@pytest.fixture()
def project(tmp_path: Path) -> Path:
    (tmp_path / "正文").mkdir()
    return tmp_path


def _write(project: Path, content: str, name: str = "第01章.md") -> str:
    (project / "正文" / name).write_text(content, encoding="utf-8")
    return f"正文/{name}"


def _rules(result: dict[str, object]) -> set[str]:
    verdict = result["verdict"]
    assert isinstance(verdict, dict)
    return {issue["rule"] for issue in verdict["issues"]}


def test_late_core_locations_positive_and_negative(project: Path) -> None:
    path = _write(project, "他们抵达旧港。")

    flagged = entity_budget_scan(str(project), path, chapter=20, new_core_locations=["旧港"])
    clean = entity_budget_scan(str(project), path, chapter=19, new_core_locations=["旧港"])

    assert "late_core_locations" in _rules(flagged)
    assert "late_core_locations" not in _rules(clean)


def test_late_mysteries_positive_and_negative(project: Path) -> None:
    path = _write(project, "密信留下新的谜题。")

    flagged = entity_budget_scan(str(project), path, chapter=25, new_mysteries=["密信来源"])
    clean = entity_budget_scan(str(project), path, chapter=24, new_mysteries=["密信来源"])

    assert "late_mysteries" in _rules(flagged)
    assert "late_mysteries" not in _rules(clean)


@pytest.mark.parametrize("field", ["new_core_evidence", "new_equipment"])
def test_late_evidence_or_equipment_positive_and_negative(project: Path, field: str) -> None:
    path = _write(project, "他找到新的设备证据。")
    observed = {field: ["量子记录仪"]}

    flagged = entity_budget_scan(str(project), path, chapter=30, **observed)
    clean = entity_budget_scan(str(project), path, chapter=29, **observed)

    assert "late_core_evidence_or_equipment" in _rules(flagged)
    assert "late_core_evidence_or_equipment" not in _rules(clean)


@pytest.mark.parametrize(
    ("field", "limit", "rule"),
    [
        ("new_key_characters", 5, "key_characters_over_budget"),
        ("new_core_locations", 3, "core_locations_over_budget"),
        ("new_core_evidence", 3, "core_evidence_over_budget"),
        ("new_major_reversals", 2, "major_reversals_over_budget"),
    ],
)
def test_count_budget_rules_have_positive_and_negative_cases(
    project: Path,
    field: str,
    limit: int,
    rule: str,
) -> None:
    path = _write(project, "本章引入若干新要素。")

    flagged = entity_budget_scan(str(project), path, chapter=1, **{field: [str(i) for i in range(limit + 1)]})
    clean = entity_budget_scan(str(project), path, chapter=1, **{field: [str(i) for i in range(limit)]})

    assert rule in _rules(flagged)
    assert rule not in _rules(clean)


def test_missing_and_explicit_empty_arrays_are_distinct(project: Path) -> None:
    path = _write(project, "本章没有新增地点。")

    missing = entity_budget_scan(str(project), path, chapter=1, budget_core_locations=-1)
    explicit_empty = entity_budget_scan(
        str(project),
        path,
        chapter=1,
        new_core_locations=[],
        budget_core_locations=-1,
    )

    assert "core_locations_over_budget" not in _rules(missing)
    assert "core_locations_over_budget" in _rules(explicit_empty)


def test_budget_override_is_effective(project: Path) -> None:
    path = _write(project, "六名关键人物同时登场。")
    characters = [f"人物{i}" for i in range(6)]

    default_budget = entity_budget_scan(str(project), path, chapter=1, new_key_characters=characters)
    overridden = entity_budget_scan(
        str(project),
        path,
        chapter=1,
        new_key_characters=characters,
        budget_key_characters=6,
    )

    assert "key_characters_over_budget" in _rules(default_budget)
    assert "key_characters_over_budget" not in _rules(overridden)


def test_chapter_is_inferred_from_project_reading_order(project: Path) -> None:
    first = _write(project, "第一章。", "第01章.md")
    second = _write(project, "第二章。", "第02章.md")

    assert entity_budget_scan(str(project), first)["chapter"] == 1
    assert entity_budget_scan(str(project), second)["chapter"] == 2


def test_explicit_chapter_overrides_reading_order(project: Path) -> None:
    path = _write(project, "文件顺序不是作者声明的章节序号。")

    result = entity_budget_scan(str(project), path, chapter=21, new_core_locations=["新城"])

    assert result["chapter"] == 21
    assert "late_core_locations" in _rules(result)


def test_result_and_issue_shape(project: Path) -> None:
    path = _write(project, "他们抵达旧港。")
    result = entity_budget_scan(str(project), path, chapter=20, new_core_locations=["旧港"])

    assert set(result) == {"path", "chapter", "verdict", "summary"}
    assert result["verdict"]["status"] == "warn"
    assert set(result["verdict"]["issues"][0]) == {"rule", "severity", "detail", "snippet"}
    assert "advisory" in result["summary"]


def test_path_escape_is_rejected(project: Path) -> None:
    (project.parent / "outside.md").write_text("不应读取", encoding="utf-8")
    with pytest.raises(FsToolError):
        entity_budget_scan(str(project), "../outside.md")


def test_missing_file_is_rejected(project: Path) -> None:
    with pytest.raises(FsToolError):
        entity_budget_scan(str(project), "正文/不存在.md")


def test_empty_file_is_rejected(project: Path) -> None:
    path = _write(project, "  \n")
    with pytest.raises(FsToolError):
        entity_budget_scan(str(project), path)
