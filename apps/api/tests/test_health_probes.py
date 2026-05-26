from __future__ import annotations

from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.main import app


def _healthy_probe_dependencies() -> tuple[MagicMock, MagicMock]:
    mock_conn = MagicMock()
    mock_conn.execute.return_value.scalar.return_value = 3
    mock_cm = MagicMock()
    mock_cm.__enter__ = MagicMock(return_value=mock_conn)
    mock_cm.__exit__ = MagicMock(return_value=False)

    mock_engine = MagicMock()
    mock_engine.connect.return_value = mock_cm
    return mock_engine, MagicMock()


def test_liveness_returns_alive() -> None:
    with TestClient(app) as client:
        resp = client.get("/health/live")
    assert resp.status_code == 200
    assert resp.json() == {"status": "alive"}


def test_readiness_returns_ready_when_all_healthy() -> None:
    mock_engine, mock_redis = _healthy_probe_dependencies()

    with (
        patch("app.domains.health.router.get_engine", return_value=mock_engine),
        patch("app.domains.health.router._redis_client", return_value=mock_redis),
        TestClient(app) as client,
    ):
        resp = client.get("/health/ready")

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ready"
    assert body["checks"]["db"] == "ok"
    assert body["checks"]["redis"] == "ok"


def test_readiness_degraded_when_db_unreachable() -> None:
    mock_engine = MagicMock()
    mock_engine.connect.side_effect = Exception("connection refused")

    mock_redis = MagicMock()

    with (
        patch("app.domains.health.router.get_engine", return_value=mock_engine),
        patch("app.domains.health.router._redis_client", return_value=mock_redis),
        TestClient(app) as client,
    ):
        resp = client.get("/health/ready")

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "degraded"
    assert "error" in body["checks"]["db"]
    assert body["checks"]["redis"] == "ok"


def test_readiness_degraded_when_redis_unreachable() -> None:
    mock_engine, _ = _healthy_probe_dependencies()

    import redis

    mock_redis = MagicMock()
    mock_redis.ping.side_effect = redis.ConnectionError("redis down")

    with (
        patch("app.domains.health.router.get_engine", return_value=mock_engine),
        patch("app.domains.health.router._redis_client", return_value=mock_redis),
        TestClient(app) as client,
    ):
        resp = client.get("/health/ready")

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "degraded"
    assert body["checks"]["db"] == "ok"
    assert "error" in body["checks"]["redis"]


def test_readiness_degraded_when_tables_missing() -> None:
    mock_conn = MagicMock()
    mock_conn.execute.return_value.scalar.return_value = 1
    mock_cm = MagicMock()
    mock_cm.__enter__ = MagicMock(return_value=mock_conn)
    mock_cm.__exit__ = MagicMock(return_value=False)

    mock_engine = MagicMock()
    mock_engine.connect.return_value = mock_cm

    mock_redis = MagicMock()

    with (
        patch("app.domains.health.router.get_engine", return_value=mock_engine),
        patch("app.domains.health.router._redis_client", return_value=mock_redis),
        TestClient(app) as client,
    ):
        resp = client.get("/health/ready")

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "degraded"
    assert "1/3" in body["checks"]["db"]


def test_health_endpoints_do_not_require_api_key() -> None:
    """Both /health/live and /health/ready are public (no API key needed)."""
    mock_engine, mock_redis = _healthy_probe_dependencies()
    with (
        patch("app.domains.health.router.get_engine", return_value=mock_engine),
        patch("app.domains.health.router._redis_client", return_value=mock_redis),
        TestClient(app) as client,
    ):
        live = client.get("/health/live")
        ready = client.get("/health/ready")
    assert live.status_code == 200
    assert ready.status_code != 401


def test_legacy_health_endpoint_still_works() -> None:
    with TestClient(app) as client:
        resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"
