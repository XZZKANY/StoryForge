from __future__ import annotations

import asyncio
import json
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest

from app.common.performance import RunMeasurement, current_measurement, measure_stage, measured, measurement_scope


class Clock:
    value = 10.0

    def __call__(self):
        return self.value


def test_nested_stages_have_exact_offsets_and_do_not_sum_children():
    clock = Clock()
    recorder = RunMeasurement(clock=clock)
    with measurement_scope(recorder), measure_stage("revision.total"):
        clock.value += 0.01
        with measure_stage("revision.model"):
            clock.value += 0.02
        clock.value += 0.01
    outer, inner = recorder.snapshot()["stages"]
    assert outer["duration_ms"] == pytest.approx(40)
    assert inner["duration_ms"] == pytest.approx(20)
    assert inner["started_offset_ms"] == pytest.approx(10)
    assert inner["parent_id"] == outer["span_id"]
    assert outer["parent_id"] is None
    assert current_measurement() is None


@pytest.mark.parametrize(
    "failure,status",
    [
        (ValueError("SECRET manuscript"), "error"),
        (asyncio.CancelledError(), "cancelled"),
        (GeneratorExit(), "cancelled"),
    ],
)
def test_failure_identity_and_private_message_are_not_changed(failure, status):
    recorder = RunMeasurement()
    with pytest.raises(type(failure)) as caught, measurement_scope(recorder), measure_stage("revision.model"):
        raise failure
    assert caught.value is failure
    summary = recorder.snapshot()
    assert summary["stages"][0]["status"] == status
    assert "SECRET" not in json.dumps(summary)


def test_business_outcomes_and_skip_are_explicit():
    recorder = RunMeasurement()
    with measurement_scope(recorder):
        with measure_stage("polish.select") as stage:
            stage.outcome("degraded")
        recorder.mark("revision.quality", status="skipped")
    assert [s["status"] for s in recorder.snapshot()["stages"]] == ["degraded", "skipped"]


def test_bad_clock_and_sink_do_not_change_value_or_exception():
    def broken(*_args):
        raise RuntimeError("SECRET")

    recorder = RunMeasurement(clock=broken, sink=broken)

    @measured("revision.model")
    def compute():
        return 42

    with measurement_scope(recorder):
        assert compute() == 42
    recorder.publish("complete")
    summary = recorder.snapshot()
    assert summary["stages"][0]["duration_ms"] is None
    assert summary["timing_failures"] > 0
    assert summary["sink_failures"] == 1
    assert "SECRET" not in json.dumps(summary)


@pytest.mark.parametrize("invalid", [float("nan"), float("inf"), "secret", None])
def test_invalid_clock_never_fabricates_zero_duration(invalid):
    recorder = RunMeasurement(clock=lambda: invalid)
    with measurement_scope(recorder), measure_stage("revision.model"):
        pass
    assert recorder.snapshot()["stages"][0]["duration_ms"] is None


def test_bounded_storage_and_invalid_names_never_echo_input():
    recorder = RunMeasurement(max_spans=2)
    with measurement_scope(recorder):
        for _ in range(5):
            with measure_stage("revision.prompt"):
                pass
        with measure_stage("SECRET/prompt/private-file"):
            pass
    result = recorder.snapshot()
    assert len(result["stages"]) == 2
    assert result["dropped_observations"] == 4
    assert "SECRET" not in json.dumps(result)


def test_snapshot_is_detached_and_publication_is_once_per_phase():
    outputs = []
    recorder = RunMeasurement(sink=outputs.append)
    recorder.mark("sse.first_yield")
    recorder.publish("worker_finished")
    recorder.publish("worker_finished")
    recorder.mark("sse.end", status="cancelled")
    recorder.publish("transport_finished")
    outputs[0]["stages"][0]["status"] = "changed"
    assert len(outputs) == 2
    assert len(outputs[1]["stages"]) == 2
    assert recorder.snapshot()["stages"][0]["status"] == "ok"


def test_run_association_uses_actual_identity_hash_only():
    recorder = RunMeasurement()
    recorder.associate_run("actual-run-SECRET")
    result = recorder.snapshot()
    assert len(result["run_key"]) == 64
    assert "SECRET" not in json.dumps(result)


def test_two_threads_do_not_share_parent_or_current_run():
    barrier = Barrier(2)

    def execute(_index):
        rec = RunMeasurement()
        with measurement_scope(rec), measure_stage("agent.run"):
            barrier.wait(timeout=10)
            with measure_stage("agent.model"):
                assert current_measurement() is rec
        assert current_measurement() is None
        return rec.snapshot()

    with ThreadPoolExecutor(max_workers=2) as executor:
        first, second = list(executor.map(execute, range(2)))
    assert first["measurement_id"] != second["measurement_id"]
    assert [s["parent_id"] for s in first["stages"]] == [None, 1]
    assert [s["parent_id"] for s in second["stages"]] == [None, 1]


def test_async_scopes_restore_nested_context_without_leaking():
    async def scenario():
        async def run():
            rec = RunMeasurement()
            with measurement_scope(rec), measure_stage("agent.run"):
                await asyncio.sleep(0)
                with measure_stage("agent.model"):
                    assert current_measurement() is rec
            assert current_measurement() is None
            return rec.snapshot()

        return await asyncio.gather(run(), run())

    results = asyncio.run(scenario())
    assert results[0]["measurement_id"] != results[1]["measurement_id"]


def test_cross_thread_explicit_binding_shares_records_not_parent_context():
    recorder = RunMeasurement()

    def worker():
        with measurement_scope(recorder), measure_stage("agent.model"):
            pass

    with measurement_scope(recorder), measure_stage("agent.run"), ThreadPoolExecutor(max_workers=1) as pool:
        pool.submit(worker).result(timeout=10)
    assert [s["parent_id"] for s in recorder.snapshot()["stages"]] == [None, None]


def test_no_scope_is_noop_and_wrapper_preserves_signature():
    @measured("revision.prompt")
    def example(value: int) -> int:
        return value + 1

    assert example(2) == 3
    assert example.__name__ == "example"
    assert current_measurement() is None
