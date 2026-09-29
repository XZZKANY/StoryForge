from __future__ import annotations

import json

import pytest
from authoring_measurement_support import SyntheticPolishProvider, fixture_resolution, fixture_revision, fixture_text

from app.common.performance import RunMeasurement, measurement_scope
from app.domains.agent_runs.patches import run_controlled_polish
from app.domains.assistant.revision import RevisionQualityRejected, revise_text


def stages(recorder):
    return {item["name"]: item for item in recorder.snapshot()["stages"]}


def test_revision_stages_preserve_exact_result_and_usage_absence():
    request = fixture_revision(fixture_text())
    expected = request.content + "\n林岚收起刀。"
    recorder = RunMeasurement()
    with measurement_scope(recorder):
        result = revise_text(request, generate=lambda **_: {"content": expected, "completion_tokens": 0})
    assert result.after == expected
    assert result.telemetry == {"completion_tokens": 0}
    assert set(stages(recorder)) == {
        "revision.total",
        "revision.prompt",
        "revision.model",
        "revision.punctuation",
        "revision.quality",
    }
    assert stages(recorder)["revision.quality"]["status"] == "skipped"
    assert request.content not in json.dumps(recorder.snapshot(), ensure_ascii=False)


def test_revision_failure_retains_exception_and_missing_later_stages():
    failure = RuntimeError("PRIVATE token and manuscript")

    def fail(**_):
        raise failure

    recorder = RunMeasurement()
    with pytest.raises(RuntimeError) as caught, measurement_scope(recorder):
        revise_text(fixture_revision(fixture_text()), generate=fail)
    assert caught.value is failure
    assert stages(recorder)["revision.model"]["status"] == "error"
    assert "revision.punctuation" not in stages(recorder)
    assert "PRIVATE" not in json.dumps(recorder.snapshot())


def test_revision_quality_rejection_is_not_a_successful_stage():
    recorder = RunMeasurement()
    with pytest.raises(RevisionQualityRejected), measurement_scope(recorder):
        revise_text(fixture_revision(fixture_text(4), gated=True), generate=lambda **_: {"content": "短"})
    assert stages(recorder)["revision.quality"]["status"] == "rejected"


@pytest.mark.parametrize(
    "scenario,model_status,select_status",
    [
        ("success", "ok", "ok"),
        ("provider_failure", "error", "degraded"),
        ("invalid_json", "ok", "degraded"),
        ("noop", "ok", "noop"),
        ("truncated", "ok", "degraded"),
    ],
)
def test_polish_real_provider_boundary_and_candidate_selection_are_measured(scenario, model_status, select_status):
    provider = SyntheticPolishProvider(scenario)
    recorder = RunMeasurement()
    with measurement_scope(recorder):
        result = run_controlled_polish(fixture_text(), provider=provider, resolution=fixture_resolution())
    assert provider.calls == 1
    assert stages(recorder)["polish.model"]["status"] == model_status
    assert stages(recorder)["polish.select"]["status"] == select_status
    assert result.decision.status == ("accepted" if select_status == "ok" else select_status)
    if scenario == "invalid_json":
        assert stages(recorder)["polish.parse"]["status"] == "error"
    assert "PRIVATE" not in json.dumps(recorder.snapshot())
    assert "fixture-only-key" not in json.dumps(recorder.snapshot())


def test_polish_disabled_online_is_explicitly_skipped():
    recorder = RunMeasurement()
    with measurement_scope(recorder):
        result = run_controlled_polish(fixture_text(), online_enabled=False)
    assert not result.online_attempted
    assert stages(recorder)["polish.model"]["status"] == "skipped"
    assert "polish.resolve" not in stages(recorder)


def test_same_recorder_can_compare_both_capabilities_without_db_or_configuration():
    recorder = RunMeasurement()
    with measurement_scope(recorder):
        revise_text(fixture_revision(fixture_text()), generate=lambda **_: {"content": fixture_text()})
        run_controlled_polish(fixture_text(), online_enabled=False)
    assert stages(recorder)["revision.total"]["parent_id"] is None
    assert stages(recorder)["polish.total"]["parent_id"] is None
    assert recorder.snapshot()["pending_spans"] == 0
