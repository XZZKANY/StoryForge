from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest


@pytest.fixture(scope="module")
def runner():
    path = Path(__file__).resolve().parents[3] / "scripts/measure-authoring.py"
    spec = importlib.util.spec_from_file_location("measure_authoring", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize(
    "feature,scenario,expected",
    [
        ("revision", "success", "success"),
        ("revision", "provider_failure", "failed"),
        ("revision", "rejected", "rejected"),
        ("polish", "provider_failure", "degraded"),
        ("polish", "invalid_json", "degraded"),
        ("polish", "noop", "noop"),
    ],
)
def test_shared_runner_preserves_failed_samples_and_availability(runner, feature, scenario, expected):
    row = runner.sample(feature, scenario, "capability", 2)
    assert row["outcome"] == expected
    assert row["correctness"]["expected_result_match"]
    assert row["resources"]["model_calls"] == 1
    assert row["resources"]["sql_count"] is None
    assert row["cost"] == {"state": "not_applicable", "amount": None}
    assert len(row["fixture"]["content_hash"]) == 64
    assert row["measurement"]["stages"]
    assert "PRIVATE" not in json.dumps(row)
    summary = next(iter(runner.summarize([row]).values()))
    assert summary["failure_rate"] == (1 if expected == "failed" else 0)
    assert summary["correctness_passed"]


def test_absent_patch_is_not_an_incorrect_expected_failure(runner):
    row = runner.sample("revision", "provider_failure", "capability", 2)
    row["correctness"]["patch_present"] = False
    assert next(iter(runner.summarize([row]).values()))["correctness_passed"]


def test_unexpected_error_is_retained_without_faking_unchanged_manuscript(runner, monkeypatch):
    def broken(*_, **__):
        raise ValueError("PRIVATE token")

    monkeypatch.setattr(runner, "revise_text", broken)
    row = runner.sample("revision", "provider_failure", "capability", 2)
    assert row["error_code"] == "unexpected_experiment_error"
    assert not row["correctness"]["expected_result_match"]
    assert row["correctness"]["original_unchanged"] is None
    assert "PRIVATE" not in json.dumps(row)
