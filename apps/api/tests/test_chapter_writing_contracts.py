from __future__ import annotations

import json

import pytest

from app.domains.agent_runs.adapters.chapter_writing_contracts import (
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
