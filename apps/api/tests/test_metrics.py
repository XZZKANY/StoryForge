from __future__ import annotations

from fastapi.testclient import TestClient

from app.common.metrics import (
    book_generation_cost_cny_total,
    book_generation_failure_count_total,
    judge_calls_total,
    observe_book_generation_chapter,
    observe_book_generation_failure,
    repair_patches_total,
)
from app.main import app


def test_metrics_endpoint_returns_prometheus_format() -> None:
    with TestClient(app) as client:
        resp = client.get("/metrics")
    assert resp.status_code == 200
    body = resp.text
    assert "http_request_duration_seconds" in body or "http_requests" in body
    assert "judge_calls_total" in body
    assert "repair_patches_total" in body
    assert "batch_refinery_jobs_total" in body
    assert "continuity_conflicts_total" in body
    assert "book_generation_failure_count_total" in body
    assert "book_generation_cost_cny_total" in body


def test_metrics_endpoint_does_not_require_api_key() -> None:
    with TestClient(app) as client:
        resp = client.get("/metrics")
    assert resp.status_code != 401


def test_book_generation_observability_helpers_update_prometheus_counters() -> None:
    judge_before = judge_calls_total._value.get()
    repair_before = repair_patches_total._value.get()
    cost_before = book_generation_cost_cny_total._value.get()
    failure_before = book_generation_failure_count_total._value.get()

    observe_book_generation_chapter(
        judge_call_count=2,
        repair_patch_count=3,
        cost_cny_estimated=1.25,
    )
    observe_book_generation_failure()

    assert judge_calls_total._value.get() == judge_before + 2
    assert repair_patches_total._value.get() == repair_before + 3
    assert book_generation_cost_cny_total._value.get() == cost_before + 1.25
    assert book_generation_failure_count_total._value.get() == failure_before + 1
