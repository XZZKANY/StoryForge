"""Raw bundles and loop reads must share structured knowledge admission."""

from __future__ import annotations

import os
from dataclasses import replace
from pathlib import Path

import pytest

from app.domains.agent_runs.fs import (
    KnowledgeEntry,
    KnowledgeSource,
    knowledge_claim_fingerprint,
    render_knowledge_entry,
)
from app.domains.agent_runs.knowledge_context import CollectedProjectKnowledge
from app.domains.agent_runs.llm_context import (
    build_llm_context_snapshot,
    build_llm_context_snapshot_from_collected,
    llm_context_snapshot_to_prompt_context_bundle,
    llm_context_snapshot_trace_summary,
)
from app.domains.agent_runs.llm_context_limits import MAX_CONTEXT_FILES

pytest_plugins = ("agent_loop_runtime_test_fixtures",)

CLAIM = "ADMISSION_CLAIM_SENTINEL：灯塔只在冬季开放。"
NOTE = "AUTHOR_NOTE_SENTINEL：第二卷才开始实行。"
RELATIVE_PATH = "设定/灯塔.md"


def make_entry(status: str = "active") -> KnowledgeEntry:
    return KnowledgeEntry(
        id="pk_550e8400-e29b-41d4-a716-446655440001",
        status=status,
        kind="world_rule",
        evidence_state="current",
        title="灯塔规则",
        claim=CLAIM,
        sources=(KnowledgeSource(type="author_statement", agent_event_id="ake_1"),),
        claim_fingerprint=knowledge_claim_fingerprint("灯塔规则", CLAIM),
        created_at="2026-10-04T00:00:00Z",
        updated_at="2026-10-04T00:00:00Z",
        superseded_by="pk_550e8400-e29b-41d4-a716-446655440002" if status == "superseded" else None,
    )


def snapshot_args(project: Path, files: list[dict], *, excluded: bool = False) -> dict:
    return {
        "run_state": None,
        "intent": "file.create",
        "user_message": "按灯塔规则写第二章",
        "file_path": str(project / "正文" / "第02章.md"),
        "content": "",
        "context_bundle": {
            "project_root": str(project),
            "files": files,
            "knowledge_exclusions": {"ids": [make_entry().id] if excluded else []},
        },
    }


@pytest.mark.parametrize("kind", ["knowledge", "setting", "materials", "other"])
@pytest.mark.parametrize(
    "status,excluded", [("retired", False), ("disputed", False), ("superseded", False), ("active", True)]
)
def test_inactive_or_excluded_entry_cannot_reenter_by_raw_kind(
    novel_project: Path, kind: str, status: str, excluded: bool
) -> None:
    raw = render_knowledge_entry(make_entry(status))
    (novel_project / RELATIVE_PATH).write_text(raw, encoding="utf-8")
    # The excerpt need not contain metadata: the current source path owns admission.
    snapshot = build_llm_context_snapshot(
        **snapshot_args(
            novel_project, [{"relative_path": RELATIVE_PATH, "kind": kind, "excerpt": CLAIM}], excluded=excluded
        )
    )
    delivered = llm_context_snapshot_to_prompt_context_bundle(snapshot)
    assert CLAIM not in str(delivered)
    assert snapshot["context_files"] == []


@pytest.mark.parametrize(
    "status,excluded", [("retired", False), ("disputed", False), ("superseded", False), ("active", True)]
)
def test_loop_read_cannot_reintroduce_filtered_entry(novel_project: Path, status: str, excluded: bool) -> None:
    raw = render_knowledge_entry(make_entry(status))
    (novel_project / RELATIVE_PATH).write_text(raw, encoding="utf-8")
    snapshot = build_llm_context_snapshot(
        **snapshot_args(novel_project, [], excluded=excluded),
        extra_context_files=[{"relative_path": RELATIVE_PATH, "excerpt": raw}],
    )
    assert CLAIM not in str(llm_context_snapshot_to_prompt_context_bundle(snapshot))
    assert snapshot["context_files"] == []


@pytest.mark.parametrize("kind", ["knowledge", "setting"])
def test_damaged_block_is_not_raw_context(novel_project: Path, kind: str) -> None:
    raw = render_knowledge_entry(make_entry("retired")).replace(CLAIM, "DAMAGED_CLAIM_SENTINEL")
    (novel_project / RELATIVE_PATH).write_text(raw, encoding="utf-8")
    snapshot = build_llm_context_snapshot(
        **snapshot_args(novel_project, [{"relative_path": RELATIVE_PATH, "kind": kind, "excerpt": raw}]),
        extra_context_files=[{"relative_path": RELATIVE_PATH, "excerpt": raw}],
    )
    assert "DAMAGED_CLAIM_SENTINEL" not in str(llm_context_snapshot_to_prompt_context_bundle(snapshot))
    assert snapshot["warnings"]


def test_active_entry_and_author_notes_survive_without_raw_duplicate(novel_project: Path) -> None:
    raw = render_knowledge_entry(make_entry()) + "\n" + NOTE
    (novel_project / RELATIVE_PATH).write_text(raw, encoding="utf-8")
    snapshot = build_llm_context_snapshot(
        **snapshot_args(novel_project, [{"relative_path": RELATIVE_PATH, "kind": "setting", "excerpt": raw}]),
        extra_context_files=[{"relative_path": RELATIVE_PATH.replace("/", "\\"), "excerpt": raw}],
    )
    delivered = str(llm_context_snapshot_to_prompt_context_bundle(snapshot))
    assert delivered.count(CLAIM) == 1
    assert delivered.count(NOTE) == 1
    assert "storyforge-knowledge:v1" not in delivered
    trace = str(llm_context_snapshot_trace_summary(snapshot))
    assert CLAIM not in trace and NOTE not in trace and str(novel_project) not in trace


def test_unverified_raw_block_is_omitted_without_replay_io(
    novel_project: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    raw = render_knowledge_entry(make_entry("retired"))

    def no_io(*args, **kwargs):
        raise AssertionError("pure replay must not read disk")

    monkeypatch.setattr(Path, "open", no_io)
    snapshot = build_llm_context_snapshot_from_collected(
        knowledge=CollectedProjectKnowledge(),
        **snapshot_args(novel_project, []),
        extra_context_files=[{"relative_path": RELATIVE_PATH, "excerpt": raw}],
    )
    assert CLAIM not in str(llm_context_snapshot_to_prompt_context_bundle(snapshot))
    assert snapshot["warnings"]


@pytest.mark.parametrize("path", ["../outside.md", "C:/outside.md", "storyforge://private/data"])
def test_loop_read_uses_existing_path_admission(novel_project: Path, path: str) -> None:
    snapshot = build_llm_context_snapshot(
        **snapshot_args(novel_project, []),
        extra_context_files=[{"relative_path": path, "excerpt": "UNSAFE_READ_SENTINEL"}],
    )
    assert "UNSAFE_READ_SENTINEL" not in str(llm_context_snapshot_to_prompt_context_bundle(snapshot))
    assert path not in str(llm_context_snapshot_trace_summary(snapshot))


def test_plain_loop_read_is_normalized_redacted_and_deduplicated(novel_project: Path) -> None:
    secret = "sk-" + "x" * 48
    (novel_project / RELATIVE_PATH).write_text(NOTE, encoding="utf-8")
    (novel_project / "设定/普通.md").write_text(f"普通作者说明。 api_key={secret}", encoding="utf-8")
    snapshot = build_llm_context_snapshot(
        **snapshot_args(novel_project, [{"relative_path": RELATIVE_PATH, "kind": "setting", "excerpt": NOTE}]),
        extra_context_files=[
            {"relative_path": RELATIVE_PATH.replace("/", "\\"), "excerpt": NOTE},
            {"relative_path": "设定/普通.md", "excerpt": f"普通作者说明。 api_key={secret}"},
        ],
    )
    delivered = str(llm_context_snapshot_to_prompt_context_bundle(snapshot))
    assert delivered.count(NOTE) == 1
    assert "普通作者说明" in delivered
    assert secret not in str(snapshot) and secret not in delivered
    assert "[REDACTED]" in delivered


def test_loop_read_count_uses_snapshot_budget(novel_project: Path) -> None:
    for i in range(MAX_CONTEXT_FILES + 1):
        (novel_project / f"设定/{i}.md").write_text(f"普通事实{i}", encoding="utf-8")
    snapshot = build_llm_context_snapshot(
        **snapshot_args(novel_project, []),
        extra_context_files=[
            {"relative_path": f"设定/{i}.md", "excerpt": f"普通事实{i}"} for i in range(MAX_CONTEXT_FILES + 1)
        ],
    )
    assert len(snapshot["context_files"]) == MAX_CONTEXT_FILES
    assert snapshot["context_budget"]["truncated"] is True


def test_malformed_header_does_not_become_plain_author_notes(novel_project: Path) -> None:
    raw = render_knowledge_entry(make_entry("retired")).replace(
        "storyforge-knowledge:v1\n", "storyforge-knowledge:v1 \n"
    )
    (novel_project / RELATIVE_PATH).write_text(raw + "\n" + NOTE, encoding="utf-8")
    snapshot = build_llm_context_snapshot(
        **snapshot_args(novel_project, [{"relative_path": RELATIVE_PATH, "kind": "setting", "excerpt": raw}])
    )
    delivered = str(llm_context_snapshot_to_prompt_context_bundle(snapshot))
    assert CLAIM not in delivered
    assert NOTE in delivered
    assert snapshot["warnings"]


def test_unselected_mixed_file_does_not_auto_inject_its_notes(novel_project: Path) -> None:
    selected = render_knowledge_entry(make_entry())
    (novel_project / RELATIVE_PATH).write_text(selected, encoding="utf-8")
    unrelated = replace(make_entry("retired"), id="pk_550e8400-e29b-41d4-a716-446655440090")
    (novel_project / "设定" / "未选.md").write_text(
        render_knowledge_entry(unrelated) + "\nUNSELECTED_AUTHOR_NOTE_SENTINEL", encoding="utf-8"
    )
    snapshot = build_llm_context_snapshot(
        **snapshot_args(novel_project, [{"relative_path": RELATIVE_PATH, "kind": "knowledge", "excerpt": selected}])
    )
    delivered = str(llm_context_snapshot_to_prompt_context_bundle(snapshot))
    assert CLAIM in delivered
    assert "UNSELECTED_AUTHOR_NOTE_SENTINEL" not in delivered


@pytest.mark.skipif(os.name != "nt", reason="case-insensitive Windows file identity")
def test_windows_case_alias_cannot_bypass_path_admission(novel_project: Path) -> None:
    raw = render_knowledge_entry(make_entry("retired"))
    (novel_project / RELATIVE_PATH).write_text(raw, encoding="utf-8")
    snapshot = build_llm_context_snapshot(
        **snapshot_args(novel_project, [{"relative_path": "设定/灯塔.MD", "kind": "setting", "excerpt": CLAIM}])
    )
    assert CLAIM not in str(llm_context_snapshot_to_prompt_context_bundle(snapshot))
