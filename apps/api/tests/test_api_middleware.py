from __future__ import annotations

import asyncio
import logging

from fastapi.testclient import TestClient

from app.main import app, warn_default_credentials


def test_protected_api_requires_storyforge_api_key() -> None:
    """受保护 API 缺少 API Key 时必须拒绝访问。"""

    with TestClient(app) as client:
        response = client.get("/api/workspaces")

    assert response.status_code == 401
    assert response.json() == {"detail": "缺少或无效的 API Key。"}


def test_health_endpoint_and_cors_preflight_are_public() -> None:
    """健康检查与浏览器预检不要求 API Key。"""

    with TestClient(app) as client:
        health = client.get("/health")
        preflight = client.options(
            "/api/workspaces",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "GET",
            },
        )

    assert health.status_code == 200
    assert health.json()["status"] == "ok"
    assert preflight.status_code == 200
    assert preflight.headers["access-control-allow-origin"] == "http://localhost:3000"


def test_cors_preflight_uses_explicit_method_and_header_allowlists() -> None:
    """浏览器预检只能公开计划内的方法和请求头。"""

    with TestClient(app) as client:
        preflight = client.options(
            "/api/workspaces",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "PATCH",
                "Access-Control-Request-Headers": "content-type,x-storyforge-api-key",
            },
        )
        rejected_header = client.options(
            "/api/workspaces",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "PATCH",
                "Access-Control-Request-Headers": "x-debug-token",
            },
        )

    assert preflight.status_code == 200
    allowed_methods = {method.strip() for method in preflight.headers["access-control-allow-methods"].split(",")}
    allowed_headers = {
        header.strip().lower() for header in preflight.headers["access-control-allow-headers"].split(",")
    }
    assert allowed_methods == {"GET", "POST", "PATCH", "DELETE", "OPTIONS"}
    assert {"content-type", "x-storyforge-api-key"}.issubset(allowed_headers)
    assert "x-debug-token" not in allowed_headers
    assert rejected_header.status_code == 400


def test_app_configures_default_rate_limiter_and_exempts_health() -> None:
    """应用必须配置默认限流器，并让健康检查保持不受限。"""

    limiter = app.state.limiter
    default_limit = limiter._default_limits[0]._LimitGroup__limit_provider

    assert default_limit == "60/minute"
    assert "app.main.health_check" in limiter._exempt_routes


def test_request_timeout_middleware_returns_504_for_slow_handlers(monkeypatch) -> None:
    """请求处理超过配置上限时必须返回 504。"""

    route_path = "/api/__test__/slow-timeout"

    if not any(route.path == route_path for route in app.routes):
        @app.get(route_path)
        async def slow_timeout_probe() -> dict[str, str]:
            await asyncio.sleep(0.05)
            return {"status": "too-slow"}

    monkeypatch.setenv("STORYFORGE_REQUEST_TIMEOUT_SECONDS", "0.01")

    with TestClient(app, headers={"X-StoryForge-API-Key": "local-dev-key"}) as client:
        response = client.get(route_path)

    assert response.status_code == 504
    assert response.json() == {"detail": "请求处理超时。"}


def test_warn_default_credentials_logs_warning_in_non_development(monkeypatch, caplog) -> None:
    """非开发环境使用默认 API Key 时必须留下启动告警。"""

    monkeypatch.setenv("STORYFORGE_ENV", "production")
    monkeypatch.setenv("STORYFORGE_API_KEY", "local-dev-key")

    with caplog.at_level(logging.WARNING, logger="app.main"):
        warn_default_credentials()

    assert "STORYFORGE_API_KEY is set to default value in non-development environment!" in caplog.text


def test_warn_default_credentials_allows_development_default(monkeypatch, caplog) -> None:
    """开发环境可以继续使用本地默认 API Key。"""

    monkeypatch.setenv("STORYFORGE_ENV", "development")
    monkeypatch.setenv("STORYFORGE_API_KEY", "local-dev-key")

    with caplog.at_level(logging.WARNING, logger="app.main"):
        warn_default_credentials()

    assert "STORYFORGE_API_KEY is set to default value" not in caplog.text
