"""知识选择/采集职责边界；旧入口的预算与来源检查行为先刻画后抽取。"""

from __future__ import annotations

from dataclasses import replace

import pytest

from app.domains.agent_runs.fs import (
    IndexedProjectKnowledgeEntry,
    KnowledgeEntry,
    KnowledgeSource,
    ProjectKnowledgeEntryIndex,
    knowledge_claim_fingerprint,
    knowledge_retrieval,
    retrieve_project_knowledge,
)
from app.domains.agent_runs.llm_context import build_llm_context_snapshot


def make_entry(n: int, title: str, claim: str = "固定设定。", **changes) -> KnowledgeEntry:
    return replace(
        KnowledgeEntry(
            id=f"pk_550e8400-e29b-41d4-a716-44665544{n:04d}",
            status="active",
            kind="world_rule",
            evidence_state="current",
            title=title,
            claim=claim,
            sources=(KnowledgeSource(type="author_statement", agent_event_id=f"ake_{n}"),),
            claim_fingerprint=knowledge_claim_fingerprint(title, claim),
            created_at="2026-08-03T10:00:00Z",
            updated_at="2026-08-03T10:00:00Z",
        ),
        **changes,
    )


@pytest.mark.parametrize("budget", [0, 4000])
def test_legacy_pins_preserve_index_order_and_only_selected_evidence_is_read(monkeypatch, budget):
    first = make_entry(1, "规则一")
    second = make_entry(2, "规则二")
    unselected = make_entry(3, "天枢")
    retired = make_entry(4, "天枢旧规则", status="retired")
    index = ProjectKnowledgeEntryIndex(
        entries=(
            IndexedProjectKnowledgeEntry("设定/z.md", first),
            IndexedProjectKnowledgeEntry("设定/a.md", second),
            IndexedProjectKnowledgeEntry("设定/unselected.md", unselected),
            IndexedProjectKnowledgeEntry("设定/retired.md", retired),
        ),
        warnings=("index warning",),
    )
    reads = []
    monkeypatch.setattr(knowledge_retrieval, "project_knowledge_entry_index", lambda root: index)

    def evidence(root, entry):
        reads.append((root, entry.id))
        return "stale" if entry.id == first.id else "current"

    monkeypatch.setattr(knowledge_retrieval, "knowledge_entry_evidence_state", evidence)
    result = retrieve_project_knowledge(
        "fixture-root", query="天枢", pinned_paths=("设定/a.md", "设定\\z.md"), max_items=1, max_chars=budget
    )
    assert [item.entry.id for item in result.items] == [first.id, second.id]
    assert reads == [("fixture-root", first.id), ("fixture-root", second.id)]
    assert result.structured_paths == ("设定/a.md", "设定/retired.md", "设定/unselected.md", "设定/z.md")
    expected = ["index warning", f"knowledge evidence stale: 设定/z.md#{first.id}"]
    if budget == 0:
        expected.extend(
            [
                f"pinned knowledge truncated by budget: 设定/z.md#{first.id}",
                f"pinned knowledge truncated by budget: 设定/a.md#{second.id}",
            ]
        )
        assert [item.excerpt for item in result.items] == ["", ""]
        assert [item.warning_count for item in result.items] == [2, 1]
    assert result.warnings == tuple(expected)


def test_legacy_auto_ties_are_stable_and_do_not_check_unselected_sources(monkeypatch):
    entries = tuple(
        IndexedProjectKnowledgeEntry(path, make_entry(n, "天枢"))
        for path, n in [("设定/z.md", 3), ("设定/a.md", 2), ("设定/a.md", 1)]
    )
    index = ProjectKnowledgeEntryIndex(entries=entries, warnings=())
    reads = []
    monkeypatch.setattr(knowledge_retrieval, "project_knowledge_entry_index", lambda root: index)
    monkeypatch.setattr(
        knowledge_retrieval, "knowledge_entry_evidence_state", lambda root, entry: reads.append(entry.id) or "current"
    )
    result = retrieve_project_knowledge("fixture", query="天枢", max_items=1)
    assert reads == [entries[2].entry.id]
    assert result.items[0].entry == entries[2].entry
    assert result.items[0].selection_source == "auto_retrieved"


def test_legacy_snapshot_retrieval_failure_is_not_an_empty_success(monkeypatch, tmp_path):
    from app.domains.agent_runs import knowledge_context

    def fail(*_args, **_kwargs):
        raise OSError("fixture failure")

    monkeypatch.setattr(knowledge_context, "retrieve_project_knowledge", fail)
    snapshot = build_llm_context_snapshot(
        run_state=None,
        intent="file.revise",
        user_message="修订",
        file_path="正文/a.md",
        content="原文",
        context_bundle={
            "project_root": str(tmp_path),
            "files": [
                {"relative_path": "设定/a.md", "kind": "knowledge", "excerpt": "普通摘录。"},
            ],
        },
    )
    assert snapshot["warnings"] == ["structured Project Knowledge retrieval failed"]
    assert snapshot["context_files"][0]["excerpt"] == "普通摘录。"


def test_fixed_index_selection_and_materialization_need_no_io(monkeypatch):
    import builtins
    import os
    from copy import deepcopy
    from pathlib import Path

    from app.domains.agent_runs.fs import materialize_knowledge_selection, select_knowledge_entries

    active = make_entry(10, "ＡＢＣ 天枢", "天枢不可移动。")
    excluded = make_entry(11, "天枢", "排除正文。")
    retired = make_entry(12, "天枢", status="retired")
    index = ProjectKnowledgeEntryIndex(
        entries=tuple(
            IndexedProjectKnowledgeEntry(path, entry)
            for path, entry in [("设定/a.md", active), ("设定/b.md", excluded), ("设定/c.md", retired)]
        ),
        warnings=("fixture parse warning",),
    )
    before = deepcopy(index)

    def no_io(*args, **kwargs):
        raise AssertionError("pure selection attempted I/O")

    with monkeypatch.context() as blocked:
        blocked.setattr(builtins, "open", no_io)
        blocked.setattr(Path, "open", no_io)
        blocked.setattr(Path, "is_dir", no_io)
        blocked.setattr(os, "getenv", no_io)
        blocked.setattr(knowledge_retrieval, "project_knowledge_entry_index", no_io)
        blocked.setattr(knowledge_retrieval, "knowledge_entry_evidence_state", no_io)
        selected = select_knowledge_entries(index, query="abc 天枢", excluded_ids=(excluded.id,), max_items=1)
        equivalent = select_knowledge_entries(index, query="ＡＢＣ 天枢", excluded_ids=(excluded.id,), max_items=1)
        shortened = select_knowledge_entries(index, query="abc 天枢", excluded_ids=(excluded.id,), max_chars=3)
        empty = select_knowledge_entries(index, query="abc 天枢", max_items=0)
        result = materialize_knowledge_selection(selected, evidence_states=("stale",))
    assert index == before
    assert selected == equivalent
    assert [item.entry.id for item in selected.items] == [active.id]
    assert shortened.items[0].excerpt == selected.items[0].excerpt[:3]
    assert empty.items == ()
    assert not hasattr(selected.items[0], "evidence_state")
    assert result.structured_paths == ("设定/a.md", "设定/b.md", "设定/c.md")
    assert result.warnings == ("fixture parse warning", f"knowledge evidence stale: 设定/a.md#{active.id}")
    assert result.total_chars == len(selected.items[0].excerpt)


@pytest.mark.parametrize("states", [(), ("current", "current"), ("unknown",), (None,)])
def test_materialization_requires_exact_explicit_evidence(states):
    from app.domains.agent_runs.fs import materialize_knowledge_selection, select_knowledge_entries

    entry = make_entry(20, "天枢")
    index = ProjectKnowledgeEntryIndex(entries=(IndexedProjectKnowledgeEntry("设定/a.md", entry),), warnings=())
    selection = select_knowledge_entries(index, query="天枢")
    with pytest.raises(ValueError, match="one valid evidence state per selected entry"):
        materialize_knowledge_selection(selection, evidence_states=states)


def test_collected_snapshot_replays_after_source_and_knowledge_changes(monkeypatch, tmp_path):
    import builtins
    import hashlib
    import os
    from copy import deepcopy
    from pathlib import Path

    from app.domains.agent_runs import llm_context
    from app.domains.agent_runs.fs import render_knowledge_entry
    from app.domains.agent_runs.knowledge_context import collect_project_knowledge_context
    from app.domains.agent_runs.llm_context import (
        build_llm_context_snapshot_from_collected,
        llm_context_snapshot_to_prompt_context_bundle,
        llm_context_snapshot_trace_summary,
    )

    (tmp_path / "正文").mkdir()
    source = tmp_path / "正文" / "a.md"
    source.write_bytes("来源原稿。".encode())
    entry = make_entry(
        30,
        "天枢",
        "REPLAY_ORIGINAL 天枢不可移动。",
        sources=(
            KnowledgeSource(
                type="project_file",
                path="正文/a.md",
                content_sha256="sha256:" + hashlib.sha256(source.read_bytes()).hexdigest(),
            ),
        ),
    )
    (tmp_path / "设定").mkdir()
    knowledge_file = tmp_path / "设定" / "a.md"
    knowledge_file.write_bytes(render_knowledge_entry(entry).encode())
    captured = []

    def collect(*args, **kwargs):
        result = collect_project_knowledge_context(*args, **kwargs)
        captured.append(result)
        return result

    monkeypatch.setattr(llm_context, "collect_project_knowledge_context", collect)
    args = dict(
        run_state={"public_id": "agr_fixture", "goal": "很" * 1998 + " 目标", "status": "running"},
        intent="file.revise",
        user_message="修订天枢",
        file_path="正文/b.md",
        content="固定正文。",
        context_bundle={
            "project_root": str(tmp_path),
            "files": [
                {"kind": "knowledge", "relative_path": "设定/a.md", "excerpt": "raw sentinel"},
                {"kind": "knowledge", "relative_path": "../unsafe.md", "excerpt": "unsafe sentinel"},
            ],
        },
        artifacts=[{"kind": "review_report", "payload": {"issues": [{"message": "审稿意见"}]}}],
        event_history=[{"content": "event omitted"}],
        role_hints=["writer"],
    )
    inputs_before = deepcopy(args)
    baseline = build_llm_context_snapshot(**args)
    knowledge = captured[0]
    assert len(captured) == 1
    assert baseline["context_files"][0]["selection_source"] == "author_pinned"
    assert "unsafe sentinel" not in str(baseline)
    assert build_llm_context_snapshot_from_collected(knowledge=knowledge, **args) == baseline
    source.write_bytes("证据已改。".encode())
    live_stale = build_llm_context_snapshot(**args)
    assert live_stale["context_files"][0]["evidence_state"] == "stale"
    assert live_stale["snapshot_id"] != baseline["snapshot_id"]
    changed = make_entry(30, "天枢", "REPLAY_NEW 天枢不可移动。", sources=entry.sources)
    knowledge_file.write_bytes(render_knowledge_entry(changed).encode())
    live_new = build_llm_context_snapshot(**args)
    assert "REPLAY_NEW" in str(live_new)
    assert "REPLAY_ORIGINAL" not in str(live_new)
    knowledge_file.unlink()
    source.unlink()
    live_deleted = build_llm_context_snapshot(**args)
    assert not any(item.get("knowledge_id") for item in live_deleted["context_files"])

    def no_io(*args, **kwargs):
        raise AssertionError("snapshot replay attempted I/O")

    with monkeypatch.context() as blocked:
        blocked.setattr(builtins, "open", no_io)
        blocked.setattr(Path, "open", no_io)
        blocked.setattr(Path, "is_dir", no_io)
        blocked.setattr(os, "getenv", no_io)
        blocked.setattr(llm_context, "collect_project_knowledge_context", no_io)
        replay = build_llm_context_snapshot_from_collected(knowledge=knowledge, **args)
        prompt_bundle = llm_context_snapshot_to_prompt_context_bundle(replay)
        trace = llm_context_snapshot_trace_summary(replay)
    assert replay == baseline
    assert args == inputs_before
    assert "REPLAY_ORIGINAL" in str(prompt_bundle)
    assert "REPLAY_ORIGINAL" not in str(trace)
    assert str(tmp_path) not in str(trace)
    assert trace["snapshot_id"] == baseline["snapshot_id"]
    assert trace["knowledge_entries"][0]["evidence_state"] == "current"


@pytest.mark.parametrize("status,excluded", [("retired", False), ("active", True)])
def test_valid_empty_collection_suppresses_raw_structured_knowledge(tmp_path, status, excluded):
    from app.domains.agent_runs.fs import render_knowledge_entry
    from app.domains.agent_runs.knowledge_context import collect_project_knowledge_context
    from app.domains.agent_runs.llm_context import build_llm_context_snapshot_from_collected

    entry = make_entry(40, "天枢", "FORBIDDEN_RAW", status=status)
    (tmp_path / "设定").mkdir()
    (tmp_path / "设定" / "a.md").write_bytes(render_knowledge_entry(entry).encode())
    files = [{"relative_path": "设定/a.md", "kind": "knowledge", "excerpt": "FORBIDDEN_RAW"}]
    bundle = {
        "project_root": str(tmp_path),
        "files": files,
        "knowledge_exclusions": {"ids": [entry.id] if excluded else []},
    }
    knowledge = collect_project_knowledge_context(bundle, context_files=files, query="天枢")
    assert knowledge.result is not None and knowledge.result.items == ()
    args = dict(
        run_state=None,
        intent="file.revise",
        user_message="天枢",
        file_path="正文/a.md",
        content="",
        context_bundle=bundle,
    )
    pure = build_llm_context_snapshot_from_collected(knowledge=knowledge, **args)
    assert pure == build_llm_context_snapshot(**args)
    assert pure["context_files"] == []
    assert "FORBIDDEN_RAW" not in str(pure)


def test_explicit_empty_collection_never_retries_disk(monkeypatch, tmp_path):
    from pathlib import Path

    from app.domains.agent_runs.knowledge_context import CollectedProjectKnowledge
    from app.domains.agent_runs.llm_context import build_llm_context_snapshot_from_collected

    def no_io(*args, **kwargs):
        raise AssertionError("empty collected value must not trigger filesystem fallback")

    with monkeypatch.context() as blocked:
        blocked.setattr(Path, "is_dir", no_io)
        blocked.setattr(Path, "open", no_io)
        result = build_llm_context_snapshot_from_collected(
            knowledge=CollectedProjectKnowledge(),
            run_state=None,
            intent="file.revise",
            user_message="天枢",
            file_path="正文/a.md",
            content="",
            context_bundle={"project_root": str(tmp_path), "files": []},
        )
    assert result["context_files"] == []
    assert result["warnings"] == []


@pytest.mark.parametrize("module", ["llm_context", "context_provenance", "knowledge_context", "fs.knowledge_retrieval"])
def test_context_entry_points_import_without_application_preloading(module):
    import subprocess
    import sys
    from pathlib import Path

    code = (
        f"import app.domains.agent_runs.{module}; "
        "from app.domains.agent_runs.loop import LoopToolCall; "
        "from app.domains.agent_runs.loop.types import LoopToolCall as Original; "
        "assert LoopToolCall is Original"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=Path(__file__).resolve().parents[1],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=30,
    )
    assert result.returncode == 0, result.stderr
