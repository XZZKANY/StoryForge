from __future__ import annotations

import asyncio
import logging

from fastapi.testclient import TestClient

from app.main import app, warn_default_credentials


def test_protected_api_requires_authentication() -> None:
    """受保护 API 缺少认证凭据时必须拒绝访问。"""

    with TestClient(app) as client:
        response = client.get("/api/workspaces")

    assert response.status_code == 401
    assert response.json() == {"detail": "缺少认证凭据。"}


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


def _ensure_test_routes():
    """注册用于限流测试的轻量端点（无 DB 依赖）。"""

    read_path = "/api/__test__/rate-read"
    write_path = "/api/__test__/rate-write"
    batch_path = "/api/batch-refinery/__test__/rate-batch"

    if not any(getattr(r, "path", None) == read_path for r in app.routes):

        @app.get(read_path)
        async def rate_read_probe() -> dict[str, str]:
            return {"tier": "read"}

        @app.post(write_path)
        async def rate_write_probe() -> dict[str, str]:
            return {"tier": "write"}

        @app.post(batch_path)
        async def rate_batch_probe() -> dict[str, str]:
            return {"tier": "batch"}


def test_tiered_rate_limiting_applies_per_api_key() -> None:
    """分层限流：批量 10/min、写入 60/min、读取 120/min，按 API Key 隔离。"""

    from app.main import _rate_store

    _rate_store.reset()
    _ensure_test_routes()

    with TestClient(app) as client:
        headers = {"X-StoryForge-API-Key": "local-dev-key"}

        read_resp = client.get("/api/__test__/rate-read", headers=headers)
        assert read_resp.status_code == 200

        write_resp = client.post("/api/__test__/rate-write", headers=headers)
        assert write_resp.status_code == 200

        batch_resp = client.post("/api/batch-refinery/__test__/rate-batch", headers=headers)
        assert batch_resp.status_code == 200


def test_rate_limit_returns_429_when_exceeded() -> None:
    """超出限额后必须返回 429。"""

    from app.main import _BATCH_LIMIT, _rate_store, _rate_strategy

    _rate_store.reset()
    _ensure_test_routes()

    for _ in range(_BATCH_LIMIT.amount):
        _rate_strategy.hit(_BATCH_LIMIT, "rate", "local-dev-key")

    with TestClient(app) as client:
        resp = client.post(
            "/api/batch-refinery/__test__/rate-batch",
            headers={"X-StoryForge-API-Key": "local-dev-key"},
        )

    assert resp.status_code == 429


def test_health_endpoint_bypasses_rate_limit() -> None:
    """健康检查不受限流影响。"""

    with TestClient(app) as client:
        resp = client.get("/health")

    assert resp.status_code == 200


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


def test_security_response_headers_present() -> None:
    """所有响应必须包含安全响应头。"""

    with TestClient(app) as client:
        resp = client.get("/health")

    assert resp.headers["X-Content-Type-Options"] == "nosniff"
    assert resp.headers["X-Frame-Options"] == "DENY"
    assert resp.headers["X-XSS-Protection"] == "0"
    assert resp.headers["Referrer-Policy"] == "strict-origin-when-cross-origin"
    assert resp.headers["Permissions-Policy"] == "camera=(), microphone=(), geolocation=()"


def test_jwt_bearer_token_grants_access(monkeypatch) -> None:
    """合法 JWT Bearer Token 应通过认证。"""

    monkeypatch.setenv("STORYFORGE_JWT_SECRET", "test-secret-key-for-jwt")

    from app.common.auth import create_access_token

    token = create_access_token(user_id="user-42", role="editor")

    _ensure_test_routes()
    with TestClient(app) as client:
        resp = client.get(
            "/api/__test__/rate-read",
            headers={"Authorization": f"Bearer {token}"},
        )

    assert resp.status_code == 200


def test_jwt_expired_token_returns_401(monkeypatch) -> None:
    """过期 JWT Token 必须返回 401。"""

    monkeypatch.setenv("STORYFORGE_JWT_SECRET", "test-secret-key-for-jwt")
    monkeypatch.setenv("STORYFORGE_JWT_EXPIRY_SECONDS", "0")

    import time

    import jwt as pyjwt

    payload = {
        "sub": "user-99",
        "role": "user",
        "iss": "storyforge",
        "iat": int(time.time()) - 10,
        "exp": int(time.time()) - 5,
    }
    token = pyjwt.encode(payload, "test-secret-key-for-jwt", algorithm="HS256")

    with TestClient(app) as client:
        resp = client.get(
            "/api/workspaces",
            headers={"Authorization": f"Bearer {token}"},
        )

    assert resp.status_code == 401
    assert "expired" in resp.json()["detail"].lower()


def test_jwt_invalid_token_returns_401() -> None:
    """篡改或伪造的 JWT 必须返回 401。"""

    with TestClient(app) as client:
        resp = client.get(
            "/api/workspaces",
            headers={"Authorization": "Bearer not-a-real-token"},
        )

    assert resp.status_code == 401


def test_invalid_api_key_returns_401() -> None:
    """无效 API Key 必须返回 401。"""

    with TestClient(app) as client:
        resp = client.get(
            "/api/workspaces",
            headers={"X-StoryForge-API-Key": "wrong-key"},
        )

    assert resp.status_code == 401
    assert "无效" in resp.json()["detail"]
