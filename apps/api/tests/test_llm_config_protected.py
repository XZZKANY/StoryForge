from __future__ import annotations

import json

import pytest

from app.common.llm_config_file import LlmConfigError
from app.common.llm_env import PolishLlmNotConfiguredError, resolve_polish_llm, resolved_llm_env


def config_v2(key=None):
    return {
        "schemaVersion": 2,
        "provider": "openai-compatible",
        "baseUrl": "https://example.invalid/v1",
        "model": "test-model",
        "apiKey": key,
    }


@pytest.fixture
def config_file(tmp_path, monkeypatch):
    path = tmp_path / "llm-provider.json"
    monkeypatch.setenv("STORYFORGE_LLM_CONFIG_FILE", str(path))
    monkeypatch.setenv("STORYFORGE_LLM_CONFIG_MODE", "desktop-managed-v2")
    monkeypatch.setenv("STORYFORGE_LLM_API_KEY", "stale-test-key")
    return path


@pytest.mark.parametrize("raw", [None, "{broken", "[]", '{"apiKey":"legacy-test-secret"}'])
def test_managed_invalid_config_never_falls_back(config_file, raw):
    if raw is not None:
        config_file.write_text(raw, encoding="utf-8")
    for resolve in (resolved_llm_env, resolve_polish_llm):
        with pytest.raises(LlmConfigError, match="LLM 配置"):
            resolve()


def test_managed_missing_path_is_error(monkeypatch):
    monkeypatch.setenv("STORYFORGE_LLM_CONFIG_MODE", "desktop-managed-v2")
    with pytest.raises(LlmConfigError, match="LLM 配置"):
        resolved_llm_env()


def test_cleared_v2_key_and_base_alias_override_stale_env(config_file, monkeypatch):
    data = config_v2()
    data["baseUrl"] = ""
    config_file.write_text(json.dumps(data), encoding="utf-8")
    monkeypatch.setenv("STORYFORGE_LLM_API_BASE_URL", "https://stale.invalid")
    result = resolved_llm_env()
    assert result["STORYFORGE_LLM_API_KEY"] == ""
    assert result["STORYFORGE_LLM_BASE_URL"] == ""
    assert result["STORYFORGE_LLM_API_BASE_URL"] == ""


@pytest.mark.parametrize("mode", ["", "desktop-managed-v2"])
@pytest.mark.parametrize(
    "change",
    [
        {"schemaVersion": 99},
        {"schemaVersion": "2"},
        {"schemaVersion": None},
        {"apiKey": "plaintext-test-secret"},
        {"apiKey": {"scheme": "unknown", "ciphertext": "test-secret"}},
        {"apiKey": {"scheme": "windows-dpapi-user-v1", "ciphertext": "%%%"}},
        {"polish": {"apiKey": "test-secret"}},
        {"model": []},
    ],
)
def test_bad_version_or_protection_is_safe_error(config_file, monkeypatch, mode, change):
    monkeypatch.setenv("STORYFORGE_LLM_CONFIG_MODE", mode)
    data = config_v2()
    data.update(change)
    config_file.write_text(json.dumps(data), encoding="utf-8")
    with pytest.raises(LlmConfigError, match="LLM 配置") as error:
        resolved_llm_env()
    assert "test-secret" not in str(error.value)


def test_v2_missing_key_is_not_legacy_fallback(config_file):
    data = config_v2()
    del data["apiKey"]
    config_file.write_text(json.dumps(data), encoding="utf-8")
    with pytest.raises(LlmConfigError, match="LLM 配置"):
        resolved_llm_env()


def test_missing_polish_does_not_revive_polish_environment(config_file, monkeypatch):
    config_file.write_text(json.dumps(config_v2()), encoding="utf-8")
    for key, value in (
        ("PROVIDER", "gemini"),
        ("MODEL", "old"),
        ("BASE_URL", "https://old.invalid"),
        ("API_KEY", "old-polish-test-key"),
    ):
        monkeypatch.setenv("STORYFORGE_POLISH_LLM_" + key, value)
    with pytest.raises(PolishLlmNotConfiguredError):
        resolve_polish_llm()


def test_explicit_env_still_bypasses_managed_file(config_file):
    explicit = {"STORYFORGE_LLM_API_KEY": "explicit-test-key"}
    assert resolved_llm_env(explicit) is explicit


def test_config_error_is_safe_and_visible_at_http_boundary(config_file, client):
    config_file.write_text("{broken-secret-test-data", encoding="utf-8")
    response = client.get("/api/assistant/provider-health")
    assert response.status_code == 200
    assert response.json()["status"] == "misconfigured"
    assert response.json()["reachable"] is False
    assert "LLM 配置" in response.json()["detail"]
    assert "secret-test-data" not in response.text


def test_invalid_key_stops_revise_with_safe_503_before_network(config_file, client, monkeypatch):
    from app.domains.assistant import service

    def unexpected_call(*args, **kwargs):
        raise AssertionError("configuration error must stop provider dispatch")

    monkeypatch.setattr(service, "_call_llm", unexpected_call)
    monkeypatch.setattr(service, "_call_llm_streamed", unexpected_call)
    config_file.write_text(
        json.dumps(config_v2({"scheme": "windows-dpapi-user-v1", "ciphertext": "AAAA"})), encoding="utf-8"
    )
    response = client.post(
        "/api/assistant/revise",
        json={
            "file_path": "test.md",
            "content": "测试句子。",
            "instruction": "润色",
        },
    )
    assert response.status_code == 503
    assert "LLM 配置" in response.json()["detail"]
    assert "AAAA" not in response.text and "stale-test-key" not in response.text
