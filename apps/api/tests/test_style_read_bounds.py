from __future__ import annotations

import importlib.util
import json
from dataclasses import asdict
from pathlib import Path

import pytest
from style_read_support import ReadProbe, make_corpus

from app.common import author_voice, style_baseline
from app.common.style_fingerprint import split_sentences


def write_three(root, data):
    directory = root / "正文"
    directory.mkdir(parents=True, exist_ok=True)
    files = []
    for index in range(3):
        path = directory / f"{index}.md"
        path.write_bytes(data)
        files.append(path)
    return files


def test_large_files_are_bounded_at_read_not_after_allocating_all_bytes(tmp_path):
    files, _ = make_corpus(tmp_path, "large_suffix")
    with ReadProbe(files) as probe:
        baseline = style_baseline.build_style_baseline(str(tmp_path))
    assert baseline is not None and baseline.file_count == 3
    assert len(probe.calls) == 3
    assert all(0 <= call["requested"] <= style_baseline.MAX_FILE_BYTES for call in probe.calls)
    assert probe.summary()["returned_bytes"] == 3 * style_baseline.MAX_FILE_BYTES


@pytest.mark.parametrize("case,count,read_count", [("ascii_budget", 4, 5), ("unicode_budget", 10, 10)])
def test_total_budget_remains_characters_and_over_budget_file_is_read_then_excluded(tmp_path, case, count, read_count):
    files, _ = make_corpus(tmp_path, case)
    with ReadProbe(files) as probe:
        baseline = style_baseline.build_style_baseline(str(tmp_path))
    assert baseline is not None and baseline.file_count == count
    assert len(probe.calls) == read_count
    assert probe.summary()["returned_bytes"] == read_count * style_baseline.MAX_FILE_BYTES
    prefix = files[0].read_bytes()[: style_baseline.MAX_FILE_BYTES].decode("utf-8", errors="replace").strip()
    assert baseline.sentence_count == count * len(split_sentences(prefix))


@pytest.mark.parametrize(
    "data",
    [
        ("他" * 66_666 + "好").encode(),
        ("  他把灯芯捻短一寸。\r\n她关窗。\r  " * 100).encode(),
        b"x" * 1024 + b"\x00" + b"y" * 400,
    ],
    ids=["utf8-split", "newlines", "nul-after-prefix"],
)
def test_decoding_prefix_normalization_and_late_nul_match_existing_contract(tmp_path, data):
    full = tmp_path / "full"
    write_three(full, data)
    expected_text = (
        data[: style_baseline.MAX_FILE_BYTES]
        .decode("utf-8", errors="replace")
        .replace("\r\n", "\n")
        .replace("\r", "\n")
        .strip()
    )
    actual = style_baseline.build_style_baseline(str(full))
    assert actual is not None
    assert actual.sentence_count == 3 * len(split_sentences(expected_text))
    assert actual.average_sentence_length is not None
    expected_length = round(
        sum(len(s) for s in split_sentences(expected_text)) / len(split_sentences(expected_text)), 3
    )
    assert actual.average_sentence_length.value == expected_length
    if len(data) > style_baseline.MAX_FILE_BYTES:
        assert expected_text.endswith("\ufffd")


@pytest.mark.parametrize(
    "data,valid",
    [(b"a" * 399, False), (b"a" * 400, True), (b"a" * 500 + b"\x00", False)],
    ids=["399-chars", "400-chars", "nul-in-prefix"],
)
def test_minimum_and_initial_binary_detection_remain_unchanged(tmp_path, data, valid):
    write_three(tmp_path, data)
    assert (style_baseline.build_style_baseline(str(tmp_path)) is not None) is valid


def test_read_oserror_skips_only_failed_candidate(tmp_path, monkeypatch):
    files, _ = make_corpus(tmp_path, "normal")
    original_open = Path.open

    def read(path, mode="r", *args, **kwargs):
        if path == files[0] and mode == "rb":
            raise OSError("synthetic unreadable file")
        return original_open(path, mode, *args, **kwargs)

    monkeypatch.setattr(Path, "open", read)
    baseline = style_baseline.build_style_baseline(str(tmp_path))
    assert baseline is not None and baseline.file_count == 4


def test_invalid_recent_files_do_not_backfill_older_chapters_and_no_cache(tmp_path):
    files, _ = make_corpus(tmp_path, "normal")
    directory = files[0].parent
    for index in range(10):
        (directory / f"第{index + 100:03d}章.md").write_bytes(b"short")
    assert style_baseline.build_style_baseline(str(tmp_path)) is None
    for index in range(3):
        (directory / f"第{index + 100:03d}章.md").write_bytes(files[0].read_bytes())
    baseline = style_baseline.build_style_baseline(str(tmp_path))
    assert baseline is not None and baseline.file_count == 3


@pytest.fixture(scope="module")
def runner():
    path = Path(__file__).resolve().parents[3] / "scripts/measure-style-read.py"
    spec = importlib.util.spec_from_file_location("measure_style_read", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_snapshot_loader_and_complete_prompt_comparison_preserve_author_priority(tmp_path, runner, monkeypatch):
    make_corpus(tmp_path, "normal")
    snapshot = tmp_path / "saved_style.py"
    snapshot.write_bytes(Path(style_baseline.__file__).read_bytes())
    loaded = runner.load_baseline(snapshot)
    before = runner.direct_sample(tmp_path, loaded)
    after = runner.direct_sample(tmp_path, style_baseline)
    assert before["signature"] == after["signature"]
    assert after["signature"]["baseline"] == asdict(style_baseline.build_style_baseline(str(tmp_path)))
    assert after["signature"]["author_last"]
    monkeypatch.setattr(
        author_voice, "append_style_baseline_to_system_prompt", loaded.append_style_baseline_to_system_prompt
    )
    prompt = author_voice.build_generation_system_prompt("通用准则", str(tmp_path))
    assert prompt.index("通用准则") < prompt.index("文风基线") < prompt.index("保持短句")


@pytest.mark.parametrize("failure", [False, True])
def test_agent_experiment_uses_real_revision_and_stage_feedback(tmp_path, runner, failure):
    make_corpus(tmp_path, "normal")
    row = runner.agent_sample(tmp_path, style_baseline, failure)
    assert row["expected_match"]
    assert row["signature"]["original_unchanged"]
    assert row["resources"]["model_calls"] == 3
    stages = row["measurement"]["stages"]
    assert sum(s["name"] == "revision.system_prompt" for s in stages) == 1
    model = next(s for s in stages if s["name"] == "revision.model")
    assert model["status"] == ("error" if failure else "ok")
    assert row["cost"] == {"state": "not_applicable", "amount": None}


def test_experiment_keeps_unexpected_failures_without_private_messages(runner):
    def fail():
        raise RuntimeError("PRIVATE secret")

    failed = runner.safe_sample(fail)
    assert failed == {"ok": False, "error_code": "unexpected_experiment_error", "elapsed_ms": None}
    common = {"variant": "candidate", "case": "normal", "entry": "baseline", "phase": "sample"}
    summary = runner.summarize([{**common, **failed}, {**common, "ok": True, "elapsed_ms": 2}])
    assert summary["candidate:normal:baseline"]["samples"] == 2
    assert summary["candidate:normal:baseline"]["failures"] == 1
    assert "PRIVATE" not in json.dumps([failed, summary])


def test_resource_probe_failure_keeps_timing_rows_and_fails_report(runner, monkeypatch):
    monkeypatch.setattr(runner, "CASES", ("normal",))
    monkeypatch.setattr(runner, "direct_sample", lambda *_: {"signature": {}, "elapsed_ms": 1})
    monkeypatch.setattr(runner, "agent_sample", lambda *_: {"signature": {}, "elapsed_ms": 1})

    def broken_probe(*_):
        raise RuntimeError("PRIVATE resource probe failure")

    monkeypatch.setattr(runner, "resource_sample", broken_probe)
    report = runner.experiment(samples=1, warmup=1)
    assert report["passed"] is False
    assert len(report["rows"]) == 6
    assert all(row["ok"] for row in report["rows"])
    assert report["probes"][0]["ok"] is False
    assert report["probes"][0]["error_code"] == "unexpected_experiment_error"
    assert "PRIVATE" not in json.dumps(report)
