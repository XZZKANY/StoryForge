from __future__ import annotations

import io
import json
from urllib import error

import pytest

from app.common import llm_client, llm_http
from app.domains.assistant import service
from app.domains.book_runs.book_generation import missing_book_generation_env

OPAQUE = "Q7v9K2m8R4u6W1x3"
SOURCE = {
    "STORYFORGE_LLM_PROVIDER": "deepseek",
    "STORYFORGE_LLM_BASE_URL": "https://fixture.invalid/v1",
    "STORYFORGE_LLM_MODEL": "fixture-model",
    "STORYFORGE_LLM_API_KEY": OPAQUE,
}


def source_fixture(monkeypatch, **overrides):
    source = {**SOURCE, **overrides}
    reads = []

    def resolve():
        reads.append(1)
        return dict(source)

    # 保留真实缺项判定；旧入口在缺项检查中无参数解析配置，会显露第二次读取。
    def missing(env=None):
        return missing_book_generation_env(resolve() if env is None else env)

    monkeypatch.setattr(service, "resolved_llm_env", resolve)
    monkeypatch.setattr(service, "missing_book_generation_env", missing)
    return source, reads


def reply(monkeypatch, payload, captured=None):
    raw = payload if isinstance(payload, bytes) else json.dumps(payload).encode()

    def fetch(req, *, timeout):
        if captured is not None:
            captured.append((req, timeout))
        return io.BytesIO(raw)

    monkeypatch.setattr(llm_client.request, "urlopen", fetch)


@pytest.mark.parametrize(
    "provider,auth,expected_header",
    [
        ("openai", "bearer", "authorization"),
        ("deepseek", "api-key", "api-key"),
        ("unknown-compatible", "bearer", "authorization"),
        ("anthropic", "bearer", "x-api-key"),
        ("claude", "bearer", "x-api-key"),
        ("gemini", "bearer", "x-goog-api-key"),
        ("google", "bearer", "x-goog-api-key"),
    ],
)
def test_diagnostic_uses_generation_family_headers_and_model_identifiers(monkeypatch, provider, auth, expected_header):
    native_gemini = provider in {"gemini", "google"}
    base = "https://fixture.invalid/v1beta" if native_gemini else "https://fixture.invalid/v1"
    _, reads = source_fixture(
        monkeypatch, STORYFORGE_LLM_PROVIDER=provider, STORYFORGE_LLM_BASE_URL=base, STORYFORGE_LLM_AUTH_HEADER=auth
    )
    captured = []
    reply(
        monkeypatch,
        {"models": [{"name": "models/fixture-model-002"}]}
        if native_gemini
        else {"data": [{"id": "fixture-model-002"}]},
        captured,
    )
    result = service.probe_provider_health()
    assert result.status == "ok"
    assert result.models == ["fixture-model-002"]
    assert result.model_count == 1
    assert reads == [1]
    req, timeout = captured[0]
    assert req.full_url == base + "/models"
    assert req.method == "GET"
    assert 0 < timeout <= 15
    headers = {key.lower(): value for key, value in req.header_items()}
    assert headers[expected_header] == ("Bearer " + OPAQUE if expected_header == "authorization" else OPAQUE)
    if expected_header.startswith("x-"):
        assert "authorization" not in headers
    if expected_header == "x-api-key":
        assert headers["anthropic-version"] == "2023-06-01"
    assert OPAQUE not in req.full_url


@pytest.mark.parametrize("provider", ["deepseek", "anthropic", "gemini"])
@pytest.mark.parametrize("code", [401, 403, 500])
def test_http_errors_never_reflect_resolved_key_in_object_or_http(client, monkeypatch, provider, code, caplog):
    source_fixture(monkeypatch, STORYFORGE_LLM_PROVIDER=provider)

    def broken(req, *, timeout):
        body = ("x" * 492 + OPAQUE + " private response").encode()
        raise error.HTTPError(req.full_url, code, OPAQUE, {}, io.BytesIO(body))

    monkeypatch.setattr(llm_client.request, "urlopen", broken)
    result = service.probe_provider_health()
    response = client.get("/api/assistant/provider-health")
    assert response.status_code == 200
    expected = "unauthorized" if code in {401, 403} else "unreachable"
    assert result.status == response.json()["status"] == expected
    for text in (repr(result), result.model_dump_json(), response.text, caplog.text):
        assert OPAQUE not in text
        assert OPAQUE[:8] not in text
        assert "private response" not in text


@pytest.mark.parametrize("exception", [error.URLError(OPAQUE), TimeoutError(OPAQUE), ConnectionResetError(OPAQUE)])
def test_connection_errors_do_not_reflect_reason(monkeypatch, exception):
    source_fixture(monkeypatch)

    def broken(req, *, timeout):
        raise exception

    monkeypatch.setattr(llm_client.request, "urlopen", broken)
    result = service.probe_provider_health()
    assert result.status == "unreachable"
    assert OPAQUE not in repr(result)
    assert OPAQUE not in result.model_dump_json()


@pytest.mark.parametrize("payload", [b"{broken", b"\xff", [], {}, {"data": {}}, {"data": [1]}, {"data": [{"id": ""}]}])
def test_malformed_response_is_explicit_diagnostic_not_empty_success(monkeypatch, payload):
    source_fixture(monkeypatch)
    reply(monkeypatch, payload)
    result = service.probe_provider_health()
    assert result.status == "unreachable"
    assert result.models == []
    assert result.detail


@pytest.mark.parametrize(
    "provider,payload",
    [
        ("anthropic", {"data": [{"id": "writer-1"}], "has_more": True}),
        ("gemini", {"models": [{"name": "models/writer-1"}], "nextPageToken": "next"}),
        ("deepseek", {"data": [{"id": str(i)} for i in range(201)]}),
    ],
)
def test_partial_list_is_disclosed_without_automatic_paging(monkeypatch, provider, payload):
    source_fixture(monkeypatch, STORYFORGE_LLM_PROVIDER=provider)
    calls = []
    reply(monkeypatch, payload, calls)
    result = service.probe_provider_health()
    assert result.status == "ok"
    assert result.detail and "部分" in result.detail
    assert len(result.models) <= 200
    assert len(calls) == 1


def test_empty_model_list_is_distinct_from_invalid_payload(monkeypatch):
    source_fixture(monkeypatch)
    reply(monkeypatch, {"data": []})
    result = service.probe_provider_health()
    assert (result.status, result.models, result.model_count) == ("ok", [], 0)


@pytest.mark.parametrize(
    "url",
    [
        f"https://user:{OPAQUE}@fixture.invalid/v1",
        f"https://fixture.invalid/v1?api_key={OPAQUE}",
        f"https://fixture.invalid/v1?access_token={OPAQUE}#private-fragment",
    ],
)
def test_url_credentials_are_not_sent_or_returned(monkeypatch, url):
    source_fixture(monkeypatch, STORYFORGE_LLM_BASE_URL=url)
    calls = []
    reply(monkeypatch, {"data": []}, calls)
    result = service.probe_provider_health()
    assert result.status == "misconfigured"
    assert calls == []
    assert OPAQUE not in repr(result)
    assert "user:" not in (result.base_url or "")
    assert "?" not in (result.base_url or "")
    assert "#" not in (result.base_url or "")


@pytest.mark.parametrize("url", ["not-a-url", "file:///fixture", "https://[invalid", "https://fixture.invalid:bad/v1"])
def test_bad_endpoint_returns_safe_configuration_error(monkeypatch, url):
    source_fixture(monkeypatch, STORYFORGE_LLM_BASE_URL=url)
    calls = []
    reply(monkeypatch, {"data": []}, calls)
    result = service.probe_provider_health()
    assert result.status == "misconfigured"
    assert calls == []


def test_metadata_and_model_list_are_redacted_before_serialization(monkeypatch):
    source_fixture(monkeypatch, STORYFORGE_LLM_MODEL=OPAQUE)
    reply(monkeypatch, {"data": [{"id": OPAQUE}, {"id": "valid-model"}]})
    result = service.probe_provider_health()
    assert result.status == "ok"
    assert OPAQUE not in repr(result)
    assert OPAQUE not in result.model_dump_json()
    assert "valid-model" in result.models


@pytest.mark.parametrize("timeout", ["nan", "inf", "-1", "0", "30s"])
def test_probe_timeout_is_positive_finite_and_bounded(monkeypatch, timeout):
    import math

    source_fixture(monkeypatch, STORYFORGE_LLM_TIMEOUT_SECONDS=timeout)
    calls = []
    reply(monkeypatch, {"data": []}, calls)
    assert service.probe_provider_health().status == "ok"
    value = calls[0][1]
    assert math.isfinite(value) and 0 < value <= 15


def test_missing_config_uses_one_snapshot_and_never_calls_provider(monkeypatch):
    _, reads = source_fixture(monkeypatch, STORYFORGE_LLM_API_KEY="")
    calls = []
    reply(monkeypatch, {"data": []}, calls)
    result = service.probe_provider_health()
    assert result.status == "misconfigured"
    assert "STORYFORGE_LLM_API_KEY" in result.missing_env
    assert reads == [1]
    assert calls == []


@pytest.mark.parametrize("header", ["Authorization", "api-key", "x-api-key", "x-goog-api-key"])
def test_json_transport_redacts_before_truncation(monkeypatch, caplog, header):
    def broken(req, *, timeout):
        body = ("x" * 1992 + OPAQUE + " tail").encode()
        raise error.HTTPError(req.full_url, 500, "error", {}, io.BytesIO(body))

    monkeypatch.setattr(llm_client.request, "urlopen", broken)
    value = "Bearer " + OPAQUE if header == "Authorization" else OPAQUE
    with pytest.raises(llm_client.LLMError) as caught:
        llm_client.post_json_with_retry(
            "https://fixture.invalid",
            {},
            {header: value},
            timeout_seconds=1,
            max_attempts=1,
            service_label="fixture",
        )
    assert OPAQUE[:8] not in str(caught.value)
    assert OPAQUE[:8] not in caplog.text
    assert len(str(caught.value)) < 2200


def test_reasoning_filter_logs_only_metrics_not_manuscript(monkeypatch):
    captured = []

    class Logger:
        def warning(self, name, **fields):
            captured.append((name, fields))

    monkeypatch.setattr(llm_http, "get_logger", lambda name: Logger())
    content = "<think>" + OPAQUE + "</think>私有原稿片段"
    assert llm_http.strip_reasoning_leak(content) == "私有原稿片段"
    assert len(captured) == 1
    assert captured[0][1]["raw_chars"] == len(content)
    assert captured[0][1]["cleaned_chars"] == len("私有原稿片段")
    assert "raw_head" not in captured[0][1]
    assert "raw_tail" not in captured[0][1]
    assert OPAQUE not in repr(captured)
    assert "私有原稿片段" not in repr(captured)


@pytest.mark.parametrize("stream", [False, True])
def test_openai_chat_error_redacts_before_truncation(monkeypatch, stream):
    def broken(req, *, timeout):
        raise error.HTTPError(req.full_url, 500, "error", {}, io.BytesIO(("x" * 1992 + OPAQUE).encode()))

    monkeypatch.setattr(llm_client.request, "urlopen", broken)
    with pytest.raises(llm_client.LLMError) as caught:
        if stream:
            list(llm_client.stream_chat_completions(SOURCE, {"model": "fixture-model", "messages": []}, max_attempts=1))
        else:
            llm_client.request_chat_completions(SOURCE, {"model": "fixture-model", "messages": []}, max_attempts=1)
    assert OPAQUE[:8] not in str(caught.value)


def test_safe_query_and_custom_version_are_kept_in_request_but_not_display(monkeypatch):
    source_fixture(monkeypatch, STORYFORGE_LLM_BASE_URL="https://fixture.invalid/custom/v42?api-version=2026-01")
    calls = []
    reply(monkeypatch, {"data": []}, calls)
    result = service.probe_provider_health()
    assert result.status == "ok"
    assert result.base_url == "https://fixture.invalid/custom/v42"
    assert calls[0][0].full_url == "https://fixture.invalid/custom/v42/models?api-version=2026-01"


def test_invalid_auth_configuration_is_safe_and_skips_network(monkeypatch):
    source_fixture(monkeypatch, STORYFORGE_LLM_AUTH_HEADER=OPAQUE)
    calls = []
    reply(monkeypatch, {"data": []}, calls)
    result = service.probe_provider_health()
    assert result.status == "misconfigured"
    assert OPAQUE not in repr(result)
    assert calls == []


def test_gemini_uses_resource_name_not_display_label_or_base_model(monkeypatch):
    source_fixture(monkeypatch, STORYFORGE_LLM_PROVIDER="gemini")
    reply(
        monkeypatch, {"models": [{"name": "models/writer-002", "displayName": "Human label", "baseModelId": "writer"}]}
    )
    assert service.probe_provider_health().models == ["writer-002"]


@pytest.mark.parametrize(
    "payload", [{"models": [{}]}, {"models": [{"name": "models/"}]}, {"models": [{"name": "writer"}]}]
)
def test_invalid_gemini_resource_is_not_silently_accepted(monkeypatch, payload):
    source_fixture(monkeypatch, STORYFORGE_LLM_PROVIDER="gemini")
    reply(monkeypatch, payload)
    assert service.probe_provider_health().status == "unreachable"


@pytest.mark.parametrize("provider", ["anthropic", "claude", "gemini", "google"])
def test_http_discovered_native_model_can_reach_existing_generation_transport(client, monkeypatch, provider):
    from app.platform.ai_sdk.contracts import ChatMessage, ChatRequest, MessageRole

    gemini = provider in {"gemini", "google"}
    base_url = "https://fixture.invalid/v1beta" if gemini else "https://fixture.invalid/v1"
    source, reads = source_fixture(monkeypatch, STORYFORGE_LLM_PROVIDER=provider, STORYFORGE_LLM_BASE_URL=base_url)
    calls = []

    def exchange(req, *, timeout):
        calls.append(req)
        if req.method == "GET":
            payload = {"models": [{"name": "models/writer-002"}]} if gemini else {"data": [{"id": "writer-002"}]}
        elif gemini:
            payload = {
                "candidates": [{"content": {"role": "model", "parts": [{"text": "离线响应"}]}, "finishReason": "STOP"}]
            }
        else:
            payload = {
                "id": "fixture-message",
                "type": "message",
                "role": "assistant",
                "model": "writer-002",
                "content": [{"type": "text", "text": "离线响应"}],
                "stop_reason": "end_turn",
                "usage": {"input_tokens": 1, "output_tokens": 1},
            }
        return io.BytesIO(json.dumps(payload).encode())

    monkeypatch.setattr(llm_client.request, "urlopen", exchange)
    health = client.get("/api/assistant/provider-health")
    assert health.status_code == 200 and health.json()["status"] == "ok"
    model = health.json()["models"][0]
    result = llm_client.build_llm_provider({**source, "STORYFORGE_LLM_MODEL": model}).complete(
        ChatRequest(model=model, messages=(ChatMessage(role=MessageRole.USER, content="测试"),))
    )
    assert result.content == "离线响应"
    assert reads == [1]
    assert [req.method for req in calls] == ["GET", "POST"]
    assert calls[1].full_url == base_url + ("/models/writer-002:generateContent" if gemini else "/messages")
    assert dict(calls[0].header_items()) == dict(calls[1].header_items())
