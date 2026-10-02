from __future__ import annotations

import json
import subprocess
import sys
from dataclasses import replace
from pathlib import Path

import pytest

from app.domains.agent_runs.fs import FsToolError, fs_list, fs_read, fs_search
from app.domains.agent_runs.fs.native_receipts import (
    MAX_RECEIPT_BYTES,
    NativeReceiptError,
    NativeWritebackIdentity,
    bind_native_writeback,
    inspect_native_writeback,
    raw_sha256,
)

# Rust also compares these vectors with actual Native describe/write output.
VECTORS = json.loads((Path(__file__).resolve().parents[2] /
                     "desktop/src-tauri/test-fixtures/writeback-receipt-v1.json").read_text(encoding="utf-8"))


def fixture(tmp_path, vector=VECTORS[0], name="project"):
    root = tmp_path / name
    root.mkdir()
    target = root / vector["relativePath"]
    target.write_bytes(vector["before"].encode())
    args = dict(project_path=root, requested_path=vector["relativePath"], operation_key=vector["operationKey"],
                source=vector["source"], content=vector["content"], raw_before=vector["before"].encode(),
                identity=NativeWritebackIdentity.model_validate(vector["identity"]))
    return root, target, bind_native_writeback(**args), args


def records(root, bound, vector=VECTORS[0], outcome=True):
    directory = root / ".storyforge/writeback-receipts"
    directory.mkdir(parents=True)
    for suffix in ("intent", "outcome") if outcome else ("intent",):
        (directory / f"{bound.identity.operation_id}.{suffix}.json").write_text(
            json.dumps(vector[suffix], ensure_ascii=False), encoding="utf-8")
    return directory


@pytest.mark.parametrize("vector", VECTORS)
def test_native_golden_binding_and_inspect_are_read_only(tmp_path, vector):
    root, target, bound, _ = fixture(tmp_path, vector)
    assert inspect_native_writeback(bound) is None
    assert not (root / ".storyforge").exists()
    records(root, bound, vector)
    target.write_bytes(vector["content"].encode())
    snapshot = {p.relative_to(root): p.read_bytes() for p in root.rglob("*") if p.is_file()}
    observed = inspect_native_writeback(bound)
    assert (observed.state, observed.current, observed.receipt_persisted) == ("applied", "after", True)
    assert observed.verified_after == vector["content"]
    assert observed.checkpoint_timestamp == 7
    assert {p.relative_to(root): p.read_bytes() for p in root.rglob("*") if p.is_file()} == snapshot


@pytest.mark.parametrize("content,current", [("before\r\n", "before"), ("after\n", "after"), ("edit", "diverged")])
def test_intent_without_outcome_is_unknown_even_if_target_matches(tmp_path, content, current):
    root, target, bound, _ = fixture(tmp_path)
    records(root, bound, outcome=False)
    target.write_bytes(content.encode())
    observed = inspect_native_writeback(bound)
    assert (observed.state, observed.current, observed.receipt_persisted) == ("outcome_unknown", current, False)
    assert observed.verified_after is None


@pytest.mark.parametrize("mode,current", [("changed", "diverged"), ("missing", "missing"), ("directory", "unreadable")])
def test_applied_history_survives_current_target_drift(tmp_path, mode, current):
    root, target, bound, _ = fixture(tmp_path)
    records(root, bound)
    if mode == "changed":
        target.write_text("author edit")
    else:
        target.unlink()
        if mode == "directory":
            target.mkdir()
    observed = inspect_native_writeback(bound)
    assert (observed.state, observed.current, observed.verified_after) == ("applied", current, None)


def test_not_written_is_not_promoted_by_matching_target_bytes(tmp_path):
    root, target, bound, _ = fixture(tmp_path)
    directory = records(root, bound)
    target.write_bytes(VECTORS[0]["content"].encode())
    (directory / f"{bound.identity.operation_id}.outcome.json").write_text(
        json.dumps({**VECTORS[0]["outcome"], "state": "not_written"}))
    observed = inspect_native_writeback(bound)
    assert (observed.state, observed.current, observed.verified_after) == ("not_written", "after", None)


@pytest.mark.parametrize("suffix,field,value", [
    ("intent", "schemaVersion", True), ("intent", "schemaVersion", 2),
    ("intent", "operationId", "a" * 64), ("intent", "fingerprint", "b" * 64),
    ("intent", "relativePath", "../chapter.md"), ("intent", "beforeHash", "c" * 64),
    ("intent", "afterHash", "d" * 64), ("intent", "checkpointTimestamp", True),
    ("intent", "checkpointTimestamp", -1), ("intent", "unexpected", "ignored?"),
    ("outcome", "state", "outcome_unknown"), ("outcome", "schemaVersion", 2),
    ("outcome", "fingerprint", "e" * 64), ("outcome", "detail", {"secret": "do-not-echo"}),
])
def test_invalid_or_mismatched_receipt_is_explicit_error(tmp_path, suffix, field, value):
    root, _, bound, _ = fixture(tmp_path)
    directory = records(root, bound)
    (directory / f"{bound.identity.operation_id}.{suffix}.json").write_text(
        json.dumps({**VECTORS[0][suffix], field: value}))
    with pytest.raises(NativeReceiptError) as caught:
        inspect_native_writeback(bound)
    assert "do-not-echo" not in str(caught.value)


@pytest.mark.parametrize("raw", [b"{", b"null", b"\xff", b'{"schemaVersion":1,"schemaVersion":1}',
                                  b" " * (MAX_RECEIPT_BYTES + 1)],
                         ids=["truncated", "null", "invalid-utf8", "duplicate-field", "oversized"])
def test_malformed_or_oversized_receipt_is_not_absence(tmp_path, raw):
    root, _, bound, _ = fixture(tmp_path)
    directory = records(root, bound, outcome=False)
    (directory / f"{bound.identity.operation_id}.intent.json").write_bytes(raw)
    with pytest.raises(NativeReceiptError):
        inspect_native_writeback(bound)


def test_orphaned_outcome_is_not_applied(tmp_path):
    root, _, bound, _ = fixture(tmp_path)
    directory = records(root, bound)
    (directory / f"{bound.identity.operation_id}.intent.json").unlink()
    with pytest.raises(NativeReceiptError, match="orphaned"):
        inspect_native_writeback(bound)


def test_raw_crlf_baseline_is_not_normalized_patch_before(tmp_path):
    root, _, bound, _ = fixture(tmp_path)
    records(root, bound)
    with pytest.raises(NativeReceiptError, match="identity"):
        inspect_native_writeback(replace(bound, before_hash=raw_sha256(b"before\n")))


def test_equal_operation_ids_in_other_project_do_not_supply_receipt(tmp_path):
    root, _, first, _ = fixture(tmp_path, name="first")
    other, _, second, _ = fixture(tmp_path, name="second")
    records(root, first)
    assert first.identity.operation_id == second.identity.operation_id
    assert inspect_native_writeback(second) is None
    assert not (other / ".storyforge").exists()


@pytest.mark.parametrize("changes", [
    {"requested_path": "../chapter.md"}, {"requested_path": "/chapter.md"},
    {"requested_path": "C:/chapter.md"}, {"requested_path": "x\\chapter.md"},
    {"requested_path": "./chapter.md"}, {"operation_key": "other"},
    {"source": "changed"}, {"content": "different"}, {"raw_before": b"\xff"},
])
def test_binding_refuses_identity_drift_or_invalid_target(tmp_path, changes):
    root, _, _, args = fixture(tmp_path)
    with pytest.raises(NativeReceiptError):
        bind_native_writeback(**{**args, **changes})
    assert not (root / ".storyforge").exists()


@pytest.mark.parametrize("location", [".storyforge", ".storyforge/writeback-receipts"])
def test_receipt_directory_link_is_refused(tmp_path, location):
    root, _, bound, _ = fixture(tmp_path)
    external = tmp_path / "elsewhere"
    external.mkdir()
    link = root / location
    link.parent.mkdir(exist_ok=True)
    if sys.platform == "win32":
        result = subprocess.run(["cmd", "/c", "mklink", "/J", str(link), str(external)],
                                capture_output=True, timeout=10)
        assert result.returncode == 0, result.stderr.decode(errors="replace")
    else:
        link.symlink_to(external, target_is_directory=True)
    try:
        with pytest.raises(NativeReceiptError):
            inspect_native_writeback(bound)
        assert list(external.iterdir()) == []
    finally:
        # Remove only this test-created link, never recurse into its target.
        if sys.platform == "win32":
            link.rmdir()
        else:
            link.unlink()


def test_deeply_nested_receipt_is_an_explicit_error(tmp_path):
    root, _, bound, _ = fixture(tmp_path)
    directory = records(root, bound, outcome=False)
    (directory / f"{bound.identity.operation_id}.intent.json").write_bytes(
        b'{"a":' * 8000 + b'null' + b'}' * 8000)
    with pytest.raises(NativeReceiptError):
        inspect_native_writeback(bound)


def test_native_receipts_remain_hidden_from_model_fs_tools(tmp_path):
    root, _, bound, _ = fixture(tmp_path)
    records(root, bound)
    assert inspect_native_writeback(bound).state == "applied"
    with pytest.raises(FsToolError):
        fs_read(str(root), f".storyforge/writeback-receipts/{bound.identity.operation_id}.intent.json")
    assert [item["path"] for item in fs_list(str(root))["entries"]] == ["chapter.md"]
    assert fs_list(str(root), ".storyforge/writeback-receipts")["entries"] == []
    assert fs_search(str(root), bound.identity.operation_id, glob="*")["matches"] == []
