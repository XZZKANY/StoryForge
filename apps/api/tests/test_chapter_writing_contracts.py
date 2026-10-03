from __future__ import annotations

import json

import pytest

from app.domains.agent_runs import serial_plan
from app.domains.agent_runs.adapters.chapter_writing_contracts import (
    build_brief_seed,
    build_check,
    confirm_brief,
    parse_brief,
    resolve_target,
)
from app.domains.agent_runs.errors import AgentOrchestrationError


def _seed() -> dict[str, object]:
    return {
        "target_path": "正文/第002章.md",
        "chapter_ordinal": 2,
        "chapter_title": "潮声",
        "goal": "推进冲突",
        "target_chars_min": 1000,
        "target_chars_max": 2000,
    }


def _project(tmp_path):
    project = tmp_path / "project"
    (project / "正文").mkdir(parents=True)
    return project


def _write_plan(project, chapters) -> None:
    directory = project / ".storyforge"
    directory.mkdir(parents=True, exist_ok=True)
    payload = {"version": 1, "chapters": chapters}
    (directory / "serial-plan.json").write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def _seed_with_plan(project, requested_path):
    relative, _absolute, planned = resolve_target(str(project), requested_path)
    return build_brief_seed(
        user_message="写下一章",
        target_path=relative,
        planned=planned,
        plan=serial_plan.build_plan(str(project)),
    )


def _two_written_plus_next(project) -> None:
    for name in ("第001章.md", "第002章.md"):
        (project / "正文" / name).write_text("已写正文", encoding="utf-8")
    _write_plan(
        project,
        [
            {"ordinal": 1, "title": "起", "status": "done"},
            {"ordinal": 2, "title": "承", "status": "done"},
            {"ordinal": 3, "title": "潮声", "goal": "第3章目标", "path": "正文/第003章.md", "status": "pending"},
        ],
    )


def test_explicit_target_beyond_plan_next_does_not_inherit_plan_metadata(tmp_path) -> None:
    project = _project(tmp_path)
    _two_written_plus_next(project)
    (project / "正文" / "第005章.md").write_text("", encoding="utf-8")
    seed = _seed_with_plan(project, "正文/第005章.md")
    assert seed["target_path"] == "正文/第005章.md"
    assert seed["chapter_ordinal"] in (None, 5)
    assert seed["chapter_title"] != "潮声"
    assert seed["goal"] != "第3章目标"


def test_explicit_target_matching_plan_next_keeps_plan_metadata(tmp_path) -> None:
    project = _project(tmp_path)
    _two_written_plus_next(project)
    seed = _seed_with_plan(project, "正文/第003章.md")
    assert seed["chapter_ordinal"] == 3
    assert seed["chapter_title"] == "潮声"
    assert seed["goal"] == "第3章目标"


def test_no_explicit_target_falls_back_to_plan_next_metadata(tmp_path) -> None:
    project = _project(tmp_path)
    _two_written_plus_next(project)
    seed = _seed_with_plan(project, None)
    assert seed["target_path"] == "正文/第003章.md"
    assert seed["chapter_ordinal"] == 3
    assert seed["chapter_title"] == "潮声"
    assert seed["goal"] == "第3章目标"


def test_explicit_target_number_matching_plan_ordinal_keeps_metadata(tmp_path) -> None:
    project = _project(tmp_path)
    for name in ("第001章.md", "第002章.md"):
        (project / "正文" / name).write_text("已写正文", encoding="utf-8")
    _write_plan(
        project,
        [
            {"ordinal": 1, "status": "done"},
            {"ordinal": 2, "status": "done"},
            {"ordinal": 3, "title": "潮声", "goal": "第3章目标", "status": "pending"},
        ],
    )
    seed = _seed_with_plan(project, "正文/第003章.md")
    assert seed["chapter_ordinal"] == 3
    assert seed["chapter_title"] == "潮声"


def test_explicit_target_other_volume_same_ordinal_does_not_inherit_plan_metadata(tmp_path) -> None:
    project = _project(tmp_path)
    for name in ("第001章.md", "第002章.md"):
        (project / "正文" / name).write_text("已写正文", encoding="utf-8")
    _write_plan(
        project,
        [
            {"ordinal": 1, "status": "done"},
            {"ordinal": 2, "status": "done"},
            {"ordinal": 3, "title": "潮声", "goal": "第3章目标", "path": "第一卷/第003章.md", "status": "pending"},
        ],
    )
    other_volume = project / "第二卷" / "第003章.md"
    other_volume.parent.mkdir(parents=True, exist_ok=True)
    other_volume.write_text("", encoding="utf-8")

    relative, _absolute, planned = resolve_target(str(project), "第二卷/第003章.md")
    assert relative == "第二卷/第003章.md"
    assert planned is None

    seed = _seed_with_plan(project, "第二卷/第003章.md")
    assert seed["chapter_ordinal"] is None
    assert seed["chapter_title"] != "潮声"
    assert seed["goal"] != "第3章目标"


def test_resolve_target_rejects_non_empty_file(tmp_path) -> None:
    novel_project = _project(tmp_path)
    target = novel_project / "正文" / "第002章.md"
    target.write_text("已有正文", encoding="utf-8")
    with pytest.raises(AgentOrchestrationError, match="file|文件已存在"):
        resolve_target(str(novel_project), "正文/第002章.md")


def test_resolve_target_accepts_blank_placeholder_and_rejects_escape(tmp_path) -> None:
    novel_project = _project(tmp_path)
    target = novel_project / "正文" / "第002章.md"
    target.write_text("  \n", encoding="utf-8")
    _relative, absolute, _planned = resolve_target(str(novel_project), "正文/第002章.md")
    assert absolute == str(target.resolve())
    with pytest.raises(AgentOrchestrationError, match="越界"):
        resolve_target(str(novel_project), "../outside.md")


def test_confirm_brief_requires_matching_revision_and_increments_revision() -> None:
    brief = parse_brief(
        json.dumps({"goal": "推进冲突", "required_beats": ["见面"]}),
        seed=_seed(),
        provenance={"snapshot_id": "snap-1"},
    )
    confirmed = confirm_brief({**brief, "goal": "推进并留下线索"}, brief)
    assert confirmed["brief_id"] == brief["brief_id"]
    assert confirmed["revision"] == 2
    with pytest.raises(AgentOrchestrationError, match="过期"):
        confirm_brief({**brief, "revision": 99}, brief)


def test_build_check_blocks_hard_contract_failures_but_advisory_passes() -> None:
    brief = parse_brief("{}", seed=_seed(), provenance={"snapshot_id": "snap-1"})
    advisory = build_check(
        "一" * 1200,
        brief,
        {"findings": [{"rule": "advisory", "severity": "hard", "message": "建议", "evidence": "一"}]},
    )
    assert advisory["status"] == "pass"
    assert advisory["advisory_count"] == 1
    hard = build_check(
        "一" * 1200,
        brief,
        {
            "findings": [
                {
                    "rule": "missing_required_beat",
                    "severity": "hard",
                    "message": "缺少见面",
                    "line": 2,
                    "evidence": "第二行",
                }
            ]
        },
    )
    assert hard["status"] == "repairable"
    assert hard["hard_failure_count"] == 1
