from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app


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
