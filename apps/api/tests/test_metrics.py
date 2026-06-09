from __future__ import annotations

from fastapi.testclient import TestClient

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


def test_metrics_endpoint_does_not_require_api_key() -> None:
    with TestClient(app) as client:
        resp = client.get("/metrics")
    assert resp.status_code != 401
