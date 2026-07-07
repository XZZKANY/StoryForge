from __future__ import annotations

from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.common.version import APP_VERSION
from app.db.base import Base
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
        patch("app.domains.health.router._core_table_count", return_value=3),
        patch("app.domains.health.router._redis_client", return_value=mock_redis),
        TestClient(app) as client,
    ):
        resp = client.get("/health/ready")

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ready"
    assert body["checks"]["db"] == "ok"
    assert body["checks"]["redis"] == "ok"
    # sidecar 版本握手依赖 /health/ready 暴露 app_version（W1）。
    assert body["app_version"] == APP_VERSION


def test_health_openapi_uses_named_response_models() -> None:
    openapi = app.openapi()
    schemas = openapi["components"]["schemas"]

    assert set(schemas["LivenessResponse"]["properties"]) == {"status"}
    readiness = schemas["ReadinessResponse"]["properties"]
    assert set(readiness) == {"status", "app_version", "checks"}
    live_response = openapi["paths"]["/health/live"]["get"]["responses"]["200"]
    ready_response = openapi["paths"]["/health/ready"]["get"]["responses"]["200"]
    live_schema = live_response["content"]["application/json"]["schema"]
    ready_schema = ready_response["content"]["application/json"]["schema"]
    assert live_schema["$ref"] == "#/components/schemas/LivenessResponse"
    assert ready_schema["$ref"] == "#/components/schemas/ReadinessResponse"


def test_readiness_degraded_when_db_unreachable() -> None:
    mock_engine = MagicMock()
    mock_engine.connect.side_effect = Exception("connection refused")

    mock_redis = MagicMock()

    with (
        patch("app.domains.health.router.get_engine", return_value=mock_engine),
        patch("app.domains.health.router._core_table_count", return_value=3),
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
        patch("app.domains.health.router._core_table_count", return_value=3),
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
        patch("app.domains.health.router._core_table_count", return_value=1),
        patch("app.domains.health.router._redis_client", return_value=mock_redis),
        TestClient(app) as client,
    ):
        resp = client.get("/health/ready")

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "degraded"
    assert "1/3" in body["checks"]["db"]


def test_health_endpoints_do_not_require_api_key() -> None:
    """live 与 ready 探针不要求 API Key。"""
    mock_engine, mock_redis = _healthy_probe_dependencies()
    with (
        patch("app.domains.health.router.get_engine", return_value=mock_engine),
        patch("app.domains.health.router._core_table_count", return_value=3),
        patch("app.domains.health.router._redis_client", return_value=mock_redis),
        TestClient(app) as client,
    ):
        live = client.get("/health/live")
        ready = client.get("/health/ready")
    assert live.status_code == 200
    assert ready.status_code != 401


def test_readiness_supports_sqlite_and_skips_redis_in_desktop_mode(monkeypatch) -> None:
    """桌面本地模式只要求 sqlite 核心表可用，外部 Redis 可以显式跳过。"""

    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    monkeypatch.setenv("STORYFORGE_DESKTOP_SKIP_SERVICES", "1")

    with (
        patch("app.domains.health.router.get_engine", return_value=engine),
        patch("app.domains.health.router._redis_client") as redis_client,
        TestClient(app) as client,
    ):
        resp = client.get("/health/ready")

    engine.dispose()
    redis_client.assert_not_called()
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ready"
    assert body["checks"]["db"] == "ok"
    assert body["checks"]["redis"] == "skipped"


def test_legacy_top_level_health_endpoint_is_not_registered() -> None:
    """旧顶层 /health 不应继续作为路由或 OpenAPI 路径注册。"""

    registered_paths = {route.path for route in app.routes}
    openapi_paths = set(app.openapi()["paths"])

    assert "/health" not in registered_paths
    assert "/health" not in openapi_paths
    assert "/health/live" in registered_paths
    assert "/health/ready" in registered_paths
