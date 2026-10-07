"""写回删除缓存失败时，派生读侧仍必须拒绝旧正文投影。"""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

import pytest

from app.domains.agent_runs import (
    book_context,
    canon_delta,
    canon_rebuild,
    canon_service,
    canon_store,
    observatory,
)
from app.domains.agent_runs.fs_tools import FsToolError


@pytest.fixture()
def project(tmp_path: Path) -> Path:
    (tmp_path / "正文").mkdir()
    (tmp_path / "正文" / "第01章.md").write_text("青岩走进旧港。\n", encoding="utf-8")
    canon = tmp_path / ".storyforge/canon/canon.json"
    canon.parent.mkdir(parents=True)
    canon.write_text(
        json.dumps({"entities": [{"id": "qingyan", "canonical_name": "青岩"}], "invariants": {}}),
        encoding="utf-8",
    )
    return tmp_path


def _writeback(project: Path, *, outcome: str | None = "applied") -> tuple[Path, Path]:
    body = project / "正文/第01章.md"
    before = body.read_bytes()
    after = "旧港空无一人。\n".encode()
    operation_id, fingerprint = "a" * 64, "b" * 64
    receipts = project / ".storyforge/writeback-receipts"
    receipts.mkdir(parents=True, exist_ok=True)
    intent_path = receipts / f"{operation_id}.intent.json"
    outcome_path = receipts / f"{operation_id}.outcome.json"
    intent_path.write_text(json.dumps({
        "schemaVersion": 1, "operationId": operation_id, "fingerprint": fingerprint,
        "relativePath": "正文/第01章.md", "beforeHash": hashlib.sha256(before).hexdigest(),
        "afterHash": hashlib.sha256(after).hexdigest(), "checkpointTimestamp": 1,
    }), encoding="utf-8")
    body.write_bytes(after)
    if outcome is not None:
        outcome_path.write_text(json.dumps({
            "schemaVersion": 1, "operationId": operation_id, "fingerprint": fingerprint,
            "state": outcome, "detail": "canon 派生缓存未失效: synthetic failure",
        }), encoding="utf-8")
    return intent_path, outcome_path


def test_failed_unlink_cannot_feed_stale_presence_to_book_context(project: Path) -> None:
    canon_service.run_canon_projection(str(project))
    before = book_context.build_book_context(str(project), None)
    assert before is not None and before.roster[0].first_chapter == 1
    derived = project / ".storyforge/canon/derived/presence.json"
    original_bytes = derived.read_bytes()

    _writeback(project)

    assert derived.read_bytes() == original_bytes  # 模拟 unlink 失败，旧文件确实仍在。
    assert canon_store.read_derived(str(project), "presence.json") is None
    after = book_context.build_book_context(str(project), None)
    assert after is not None and after.roster[0].first_chapter is None
    assert after.roster[0].canonical_name == "青岩"


def test_failed_unlink_rebuilds_presence_from_current_body(project: Path) -> None:
    canon_delta.canon_delta(str(project))
    _writeback(project)
    canon_delta.canon_delta(str(project))
    presence = canon_store.read_derived(str(project), "presence.json")
    assert presence is not None and presence["entities"][0]["missing"] is True


def test_projection_does_not_stamp_pre_writeback_scan_as_fresh(project: Path, monkeypatch) -> None:
    original = canon_rebuild.rebuild_presence

    def interrupted(*args, **kwargs):
        old_presence = original(*args, **kwargs)
        _writeback(project)
        return old_presence

    monkeypatch.setattr(canon_rebuild, "rebuild_presence", interrupted)
    with pytest.raises(FsToolError, match="缓存来源"):
        canon_service.run_canon_projection(str(project))
    assert canon_store.read_derived(str(project), "presence.json") is None


@pytest.mark.parametrize("outcome", [None, "outcome_unknown", "unrecognized"])
def test_unknown_intent_never_qualifies_new_cache(project: Path, outcome: str | None) -> None:
    _writeback(project, outcome=outcome)
    output = canon_service.run_canon_projection(str(project))
    assert output["cache_status"] == "uncached_unverified"
    assert "未经核验" in output["note"]
    assert output["dossier"]["path"] is None
    assert canon_store.read_derived(str(project), "presence.json") is None
    assert not (project / ".storyforge/canon/derived").exists()


def test_observations_and_report_are_stale_but_proposals_are_preserved(project: Path) -> None:
    draft = {"entities": [{"id": "pending", "canonical_name": "月儿"}]}
    canon_store.write_derived(str(project), "proposals.json", draft)
    author_canon = project / ".storyforge/canon/canon.json"
    canon_before = author_canon.read_bytes()
    observatory.run_observatory_scan(str(project))
    assert canon_store.read_derived(str(project), "observations.json") is not None
    assert canon_store.read_derived(str(project), "report.json") is not None
    _writeback(project)
    assert canon_store.read_derived(str(project), "observations.json") is None
    assert canon_store.read_derived(str(project), "report.json") is None
    assert canon_store.read_derived(str(project), "proposals.json") == draft
    assert author_canon.read_bytes() == canon_before


@pytest.mark.parametrize("producer", [canon_delta.canon_delta, observatory.run_observatory_scan])
def test_each_producer_keeps_the_revision_from_before_its_scan(project: Path, monkeypatch, producer) -> None:
    original = canon_rebuild.rebuild_presence

    def interrupted(*args, **kwargs):
        old_presence = original(*args, **kwargs)
        _writeback(project)
        return old_presence

    monkeypatch.setattr(canon_rebuild, "rebuild_presence", interrupted)
    with pytest.raises(FsToolError, match="缓存来源"):
        producer(str(project))
    assert canon_store.read_derived(str(project), "presence.json") is None
    assert canon_store.read_derived(str(project), "observations.json") is None


def test_observatory_cannot_relabel_earlier_checker_results(project: Path, monkeypatch) -> None:
    original = observatory.promise_check

    def interrupted(*args, **kwargs):
        output = original(*args, **kwargs)
        _writeback(project)
        return output

    monkeypatch.setattr(observatory, "promise_check", interrupted)
    with pytest.raises(FsToolError, match="缓存来源"):
        observatory.run_observatory_scan(str(project))
    assert canon_store.read_derived(str(project), "observations.json") is None
    assert canon_store.read_derived(str(project), "report.json") is None


def test_dossier_cannot_be_written_with_post_scan_revision(project: Path, monkeypatch) -> None:
    original = canon_service.canon_dossier.render_dossiers_markdown

    def interrupted(*args, **kwargs):
        output = original(*args, **kwargs)
        _writeback(project)
        return output

    monkeypatch.setattr(canon_service.canon_dossier, "render_dossiers_markdown", interrupted)
    with pytest.raises(FsToolError, match="缓存来源"):
        canon_service.run_canon_projection(str(project))
    assert not (project / ".storyforge/canon/derived/dossier.md").exists()


def test_source_change_during_atomic_write_leaves_an_unreadable_old_stamp(project: Path, monkeypatch) -> None:
    original = canon_store._atomic_write_json

    def interrupted(target, payload):
        _writeback(project)
        original(target, payload)

    revision = canon_store.capture_source_revision(str(project))
    monkeypatch.setattr(canon_store, "_atomic_write_json", interrupted)
    canon_store.write_derived(str(project), "presence.json", {"entities": []}, source_revision=revision)
    assert (project / ".storyforge/canon/derived/presence.json").is_file()
    assert canon_store.read_derived(str(project), "presence.json") is None


@pytest.mark.parametrize("name", ["presence.json", "observations.json", "report.json"])
def test_legacy_unstamped_cache_is_never_assumed_fresh(project: Path, name: str) -> None:
    derived = project / ".storyforge/canon/derived"
    derived.mkdir()
    (derived / name).write_text('{"entities": []}', encoding="utf-8")
    assert canon_store.read_derived(str(project), name) is None


@pytest.mark.parametrize("name", ["canon.json", "hooks.json"])
def test_declaration_edits_invalidate_old_derived_cache(project: Path, name: str) -> None:
    canon_service.run_canon_projection(str(project))
    (project / ".storyforge/canon" / name).write_text('{"entities": []}', encoding="utf-8")
    assert canon_store.read_derived(str(project), "presence.json") is None
    assert canon_store.read_derived(str(project), "report.json") is None


@pytest.mark.parametrize("kind,field,value", [
    ("intent", "schemaVersion", 2),
    ("intent", "schemaVersion", True),
    ("intent", "operationId", "c" * 64),
    ("intent", "afterHash", None),
    ("intent", "beforeHash", []),
    ("intent", "checkpointTimestamp", -1),
    ("intent", "unexpected", "value"),
    ("outcome", "fingerprint", "c" * 64),
    ("outcome", "state", []),
    ("outcome", "detail", {}),
])
def test_corrupt_receipts_fail_closed(project: Path, kind: str, field: str, value) -> None:
    intent, outcome = _writeback(project)
    target = intent if kind == "intent" else outcome
    record = json.loads(target.read_bytes())
    record[field] = value
    target.write_text(json.dumps(record), encoding="utf-8")
    assert canon_store.capture_source_revision(str(project)) is None
    output = canon_service.run_canon_projection(str(project))
    assert output["cache_status"] == "uncached_unverified"
    assert not (project / ".storyforge/canon/derived").exists()


@pytest.mark.parametrize("budget", ["MAX_RECEIPT_ENTRIES", "MAX_RECEIPT_BYTES", "MAX_RECEIPTS_TOTAL_BYTES"])
def test_receipt_budget_exhaustion_is_not_a_fresh_empty_version(project: Path, monkeypatch, budget: str) -> None:
    from app.domains.agent_runs import canon_cache_freshness

    _writeback(project)
    monkeypatch.setattr(canon_cache_freshness, budget, 1)
    assert canon_store.capture_source_revision(str(project)) is None


def test_missing_or_malformed_receipt_cannot_qualify_cache(project: Path) -> None:
    intent, outcome = _writeback(project)
    intent.unlink()
    assert canon_store.capture_source_revision(str(project)) is None
    outcome.write_bytes(b"{")
    assert canon_store.capture_source_revision(str(project)) is None


@pytest.mark.parametrize("directory", ["writeback-receipts", "canon"])
def test_outside_receipt_and_declaration_directories_are_not_read(tmp_path: Path, directory: str) -> None:
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "canon.json").write_text("{}", encoding="utf-8")
    contained = tmp_path / "contained"
    (contained / ".storyforge").mkdir(parents=True)
    alias = contained / ".storyforge" / directory
    if sys.platform == "win32":
        # Directory junctions exercise the real reparse boundary without symlink privilege.
        created = subprocess.run(
            ["cmd.exe", "/d", "/c", "mklink", "/J", str(alias), str(outside)],
            capture_output=True,
            check=False,
        )
        assert created.returncode == 0, created.stderr
    else:
        alias.symlink_to(outside, target_is_directory=True)
    assert alias.resolve() == outside.resolve()
    assert canon_store.capture_source_revision(str(contained)) is None


def test_outside_declaration_file_symlink_is_not_read(tmp_path: Path) -> None:
    outside = tmp_path / "outside.json"
    outside.write_text("{}", encoding="utf-8")
    contained = tmp_path / "contained"
    (contained / ".storyforge/canon").mkdir(parents=True)
    try:
        (contained / ".storyforge/canon/canon.json").symlink_to(outside)
    except OSError as exc:
        if sys.platform == "win32" and exc.winerror == 1314:
            pytest.skip("Windows file symlink requires SeCreateSymbolicLinkPrivilege")
        raise
    assert canon_store.capture_source_revision(str(contained)) is None


def test_source_revision_ignores_only_unrelated_retry_markers(project: Path) -> None:
    intent, outcome = _writeback(project)
    revision = canon_store.capture_source_revision(str(project))
    assert revision is not None
    marker = intent.with_name("a" * 64 + ".canon-invalidation.json")
    marker.write_text('{"state": "invalidated"}', encoding="utf-8")
    assert canon_store.capture_source_revision(str(project)) == revision
    outcome.unlink()
    assert canon_store.capture_source_revision(str(project)) is None


def test_body_derived_writes_require_a_previously_captured_revision(project: Path) -> None:
    with pytest.raises(FsToolError, match="缓存来源"):
        canon_store.write_derived(str(project), "presence.json", {"entities": []})
    with pytest.raises(FsToolError, match="缓存来源"):
        canon_store.write_derived_text(str(project), "dossier.md", "old results")


@pytest.mark.parametrize("producer", [
    canon_service.run_canon_projection, canon_delta.canon_delta, observatory.run_observatory_scan,
])
@pytest.mark.parametrize("history", ["unknown_intent", "over_budget"])
def test_unverifiable_history_allows_fresh_uncached_report(project: Path, monkeypatch, producer, history) -> None:
    from app.domains.agent_runs import canon_cache_freshness

    observatory.run_observatory_scan(str(project))
    derived = project / ".storyforge/canon/derived"
    previous = {path.name: path.read_bytes() for path in derived.iterdir()}
    intent, outcome = _writeback(project, outcome=None if history == "unknown_intent" else "applied")
    if history == "over_budget":
        monkeypatch.setattr(canon_cache_freshness, "MAX_RECEIPT_ENTRIES", 1)
    receipts = {path.name: path.read_bytes() for path in intent.parent.iterdir()}
    canon_before = (project / ".storyforge/canon/canon.json").read_bytes()
    original = canon_rebuild.rebuild_presence
    scans = []

    def counted(*args, **kwargs):
        value = original(*args, **kwargs)
        scans.append(value)
        return value

    monkeypatch.setattr(canon_rebuild, "rebuild_presence", counted)
    output = producer(str(project))

    assert output["cache_status"] == "uncached_unverified"
    assert "未经核验" in output["note"]
    assert len(scans) == 1 and scans[0]["entities"][0]["missing"] is True
    if producer is canon_service.run_canon_projection:
        assert output["dossier"]["path"] is None
        assert output["presence_summary"]["missing_entities"] == ["qingyan"]
    if producer is observatory.run_observatory_scan:
        assert output["entities"][0]["appearance"]["missing"] is True
    # 未重新发布、删除或改写旧派生缓存；待决提案仍走自身持久化契约。
    for name, raw in previous.items():
        assert (derived / name).read_bytes() == raw
        if name.endswith(".json"):
            assert canon_store.read_derived(str(project), name) is None
    assert {path.name: path.read_bytes() for path in intent.parent.iterdir()} == receipts
    assert (project / ".storyforge/canon/canon.json").read_bytes() == canon_before


def test_unknown_history_resolving_mid_scan_does_not_retroactively_stamp_result(project: Path, monkeypatch) -> None:
    intent, outcome = _writeback(project, outcome=None)
    original = canon_rebuild.rebuild_presence

    def interrupted(*args, **kwargs):
        value = original(*args, **kwargs)
        record = json.loads(intent.read_bytes())
        outcome.write_text(json.dumps({
            "schemaVersion": 1, "operationId": record["operationId"], "fingerprint": record["fingerprint"],
            "state": "applied", "detail": None,
        }), encoding="utf-8")
        return value

    monkeypatch.setattr(canon_rebuild, "rebuild_presence", interrupted)
    output = observatory.run_observatory_scan(str(project))
    assert output["cache_status"] == "uncached_unverified"
    assert canon_store.capture_source_revision(str(project)) is not None
    assert not (project / ".storyforge/canon/derived").exists()
    # 后续独立扫描才有资格发布，无需改写或删除任何已有回执。
    monkeypatch.setattr(canon_rebuild, "rebuild_presence", original)
    output = observatory.run_observatory_scan(str(project))
    assert output["cache_status"] == "published"
    assert canon_store.read_derived(str(project), "observations.json") is not None


def test_verified_delta_cannot_publish_old_gate_after_source_changes(project: Path, monkeypatch) -> None:
    canon_service.run_canon_projection(str(project))
    original = canon_delta.canon_gate.check

    def interrupted(*args, **kwargs):
        value = original(*args, **kwargs)
        if not (project / ".storyforge/writeback-receipts").exists():
            _writeback(project)
        return value

    monkeypatch.setattr(canon_delta.canon_gate, "check", interrupted)
    with pytest.raises(FsToolError, match="缓存来源"):
        canon_delta.canon_delta(str(project))
    assert not (project / ".storyforge/canon/derived/proposals.json").exists()
