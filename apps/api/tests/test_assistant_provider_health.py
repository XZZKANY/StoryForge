from __future__ import annotations

from urllib import error

import pytest
from fastapi.testclient import TestClient

from app.domains.assistant import service as assistant_service

_PROVIDER_SOURCE = {
    "STORYFORGE_LLM_BASE_URL": "https://provider.test/v1",
    "STORYFORGE_LLM_MODEL": "deepseek-v4-flash",
}


def test_provider_health_ok_lists_models(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """配置齐全且 /models 可达：返回 ok，带模型名、模型数与延迟。"""

    monkeypatch.setattr(assistant_service, "missing_book_generation_env", lambda: [])
    monkeypatch.setattr(assistant_service, "resolved_llm_env", lambda: dict(_PROVIDER_SOURCE))
    monkeypatch.setattr(
        assistant_service,
        "_fetch_provider_models",
        lambda source, *, timeout: {"data": [{"id": "deepseek-v4-flash"}, {"id": "deepseek-v4-pro"}]},
    )

    response = client.get("/api/assistant/provider-health")
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["status"] == "ok"
    assert data["reachable"] is True
    assert data["model"] == "deepseek-v4-flash"
    assert data["model_count"] == 2
    assert data["base_url"] == "https://provider.test/v1"
    assert isinstance(data["latency_ms"], int)
    assert data["missing_env"] == []


def test_provider_health_misconfigured_skips_network(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """缺必填环境变量时直接判 misconfigured，且绝不发起网络探测。"""

    monkeypatch.setattr(
        assistant_service, "missing_book_generation_env", lambda: ["STORYFORGE_LLM_API_KEY"]
    )

    def explode(source, *, timeout):  # noqa: ANN001 - 测试桩：被调用即失败
        raise AssertionError("misconfigured 时不应发起网络探测")

    monkeypatch.setattr(assistant_service, "_fetch_provider_models", explode)

    response = client.get("/api/assistant/provider-health")
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["status"] == "misconfigured"
    assert data["reachable"] is False
    assert "STORYFORGE_LLM_API_KEY" in data["missing_env"]


def test_provider_health_unauthorized_maps_401(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """provider 返回 401 时判 unauthorized（服务可达但鉴权失败）。"""

    monkeypatch.setattr(assistant_service, "missing_book_generation_env", lambda: [])
    monkeypatch.setattr(assistant_service, "resolved_llm_env", lambda: dict(_PROVIDER_SOURCE))

    def raise_401(source, *, timeout):  # noqa: ANN001 - 测试桩
        raise error.HTTPError("https://provider.test/v1/models", 401, "Unauthorized", {}, None)

    monkeypatch.setattr(assistant_service, "_fetch_provider_models", raise_401)

    response = client.get("/api/assistant/provider-health")
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["status"] == "unauthorized"
    assert data["reachable"] is True


def test_provider_health_unreachable_maps_connection_error(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """连接失败/超时时判 unreachable。"""

    monkeypatch.setattr(assistant_service, "missing_book_generation_env", lambda: [])
    monkeypatch.setattr(assistant_service, "resolved_llm_env", lambda: dict(_PROVIDER_SOURCE))

    def raise_conn(source, *, timeout):  # noqa: ANN001 - 测试桩
        raise error.URLError("Connection refused")

    monkeypatch.setattr(assistant_service, "_fetch_provider_models", raise_conn)

    response = client.get("/api/assistant/provider-health")
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["status"] == "unreachable"
    assert data["reachable"] is False


def test_provider_health_never_leaks_credential(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """诊断响应在任何分支都不得回显凭据（密钥在请求头、不在响应体）。"""

    monkeypatch.setattr(assistant_service, "missing_book_generation_env", lambda: [])
    monkeypatch.setattr(
        assistant_service,
        "resolved_llm_env",
        lambda: {**_PROVIDER_SOURCE, "STORYFORGE_LLM_API_KEY": "super-secret-credential"},
    )

    def raise_500(source, *, timeout):  # noqa: ANN001 - 测试桩
        raise error.HTTPError("https://provider.test/v1/models", 500, "boom", {}, None)

    monkeypatch.setattr(assistant_service, "_fetch_provider_models", raise_500)

    response = client.get("/api/assistant/provider-health")
    assert response.status_code == 200, response.text
    assert "super-secret-credential" not in response.text
    assert response.json()["status"] == "unreachable"
