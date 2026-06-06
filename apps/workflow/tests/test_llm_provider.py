from __future__ import annotations

import http.client
import json
from http.server import BaseHTTPRequestHandler, HTTPServer, ThreadingHTTPServer
from threading import Thread
from urllib.error import HTTPError

import pytest

from storyforge_workflow.provider_client import close_provider_connections, generate_text


class _ChatHandler(BaseHTTPRequestHandler):
    """提供 OpenAI 兼容响应，验证 workflow 使用真实 HTTP provider 协议。"""

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("content-length", "0"))
        payload = json.loads(self.rfile.read(length).decode("utf-8"))
        content = payload["messages"][-1]["content"]
        body = json.dumps({"choices": [{"message": {"content": f"模型响应：{content[:24]}"}}]}).encode("utf-8")
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        return


class _KeepAliveChatHandler(BaseHTTPRequestHandler):
    """提供 HTTP/1.1 keep-alive 响应，用客户端端口验证连接复用。"""

    protocol_version = "HTTP/1.1"
    client_ports: list[int] = []

    def do_POST(self) -> None:  # noqa: N802
        type(self).client_ports.append(self.client_address[1])
        length = int(self.headers.get("content-length", "0"))
        payload = json.loads(self.rfile.read(length).decode("utf-8"))
        content = payload["messages"][-1]["content"]
        body = json.dumps({"choices": [{"message": {"content": f"复用响应：{content}"}}]}).encode("utf-8")
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.send_header("connection", "keep-alive")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        return


def test_generate_text_calls_openai_compatible_provider(monkeypatch) -> None:
    """真实 provider client 通过 HTTP 调用模型端点，而不是返回本地假结果。"""

    server = HTTPServer(("127.0.0.1", 0), _ChatHandler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    monkeypatch.setenv("STORYFORGE_LLM_BASE_URL", f"http://127.0.0.1:{server.server_port}/v1")
    monkeypatch.setenv("STORYFORGE_LLM_API_KEY", "test-key")
    monkeypatch.setenv("STORYFORGE_LLM_MODEL", "test-model")

    try:
        result = generate_text("请根据不同 premise 生成策略。")
    finally:
        close_provider_connections()
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)

    assert result.startswith("模型响应：请根据不同 premise")


def test_generate_text_reuses_http_connection_for_same_provider(monkeypatch) -> None:
    """同一线程连续调用同一 provider 时应复用 HTTP/1.1 连接，避免每次重新建连。"""

    _KeepAliveChatHandler.client_ports = []
    server = ThreadingHTTPServer(("127.0.0.1", 0), _KeepAliveChatHandler)
    server.daemon_threads = True
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    monkeypatch.setenv("STORYFORGE_LLM_BASE_URL", f"http://127.0.0.1:{server.server_port}/v1")
    monkeypatch.setenv("STORYFORGE_LLM_API_KEY", "test-key")
    monkeypatch.setenv("STORYFORGE_LLM_MODEL", "test-model")

    try:
        assert generate_text("第一次") == "复用响应：第一次"
        assert generate_text("第二次") == "复用响应：第二次"
    finally:
        close_provider_connections()
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)

    assert len(_KeepAliveChatHandler.client_ports) == 2
    assert len(set(_KeepAliveChatHandler.client_ports)) == 1


def test_generate_text_retries_rate_limit_with_exponential_backoff(monkeypatch) -> None:
    """provider 遇到 429 时应有限重试并退避，避免一次限流丢整章。"""

    attempts: list[int] = []
    sleeps: list[float] = []

    def flaky_post_chat_completion(**kwargs):
        attempts.append(1)
        if len(attempts) < 3:
            raise HTTPError(url="https://provider.test", code=429, msg="Too Many Requests", hdrs=None, fp=None)
        return {"choices": [{"message": {"content": "重试后正文"}}]}

    monkeypatch.setenv("STORYFORGE_LLM_API_KEY", "test-key")
    monkeypatch.setenv("STORYFORGE_LLM_RETRY_MAX_ATTEMPTS", "3")
    monkeypatch.setenv("STORYFORGE_LLM_RETRY_BASE_DELAY_SECONDS", "0.25")
    monkeypatch.setenv("STORYFORGE_LLM_RETRY_JITTER_SECONDS", "0")
    monkeypatch.setattr(
        "storyforge_workflow.provider_client._request_json_with_reused_connection", flaky_post_chat_completion
    )
    monkeypatch.setattr(
        "storyforge_workflow.provider_client.sleep", lambda seconds: sleeps.append(seconds), raising=False
    )

    assert generate_text("需要重试的章节") == "重试后正文"
    assert len(attempts) == 3
    assert sleeps == [0.25, 0.5]


def test_generate_text_retries_server_error_with_exponential_backoff(monkeypatch) -> None:
    """provider 遇到 5xx 时应按同一策略有限重试。"""

    attempts: list[int] = []
    sleeps: list[float] = []

    def flaky_post_chat_completion(**kwargs):
        attempts.append(1)
        if len(attempts) == 1:
            raise HTTPError(url="https://provider.test", code=500, msg="Server Error", hdrs=None, fp=None)
        return {"choices": [{"message": {"content": "服务端恢复后正文"}}]}

    monkeypatch.setenv("STORYFORGE_LLM_API_KEY", "test-key")
    monkeypatch.setenv("STORYFORGE_LLM_RETRY_MAX_ATTEMPTS", "3")
    monkeypatch.setenv("STORYFORGE_LLM_RETRY_BASE_DELAY_SECONDS", "0.25")
    monkeypatch.setenv("STORYFORGE_LLM_RETRY_JITTER_SECONDS", "0")
    monkeypatch.setattr(
        "storyforge_workflow.provider_client._request_json_with_reused_connection", flaky_post_chat_completion
    )
    monkeypatch.setattr(
        "storyforge_workflow.provider_client.sleep", lambda seconds: sleeps.append(seconds), raising=False
    )

    assert generate_text("服务端错误后重试") == "服务端恢复后正文"
    assert len(attempts) == 2
    assert sleeps == [0.25]


def test_generate_text_does_not_retry_non_retryable_client_error(monkeypatch) -> None:
    """普通 4xx 表示请求配置或权限问题，应立即透传，避免浪费调用配额。"""

    attempts: list[int] = []
    sleeps: list[float] = []

    def failing_post_chat_completion(**kwargs):
        attempts.append(1)
        raise HTTPError(url="https://provider.test", code=400, msg="Bad Request", hdrs=None, fp=None)

    monkeypatch.setenv("STORYFORGE_LLM_API_KEY", "test-key")
    monkeypatch.setenv("STORYFORGE_LLM_RETRY_MAX_ATTEMPTS", "3")
    monkeypatch.setenv("STORYFORGE_LLM_RETRY_BASE_DELAY_SECONDS", "0.25")
    monkeypatch.setenv("STORYFORGE_LLM_RETRY_JITTER_SECONDS", "0")
    monkeypatch.setattr(
        "storyforge_workflow.provider_client._request_json_with_reused_connection", failing_post_chat_completion
    )
    monkeypatch.setattr(
        "storyforge_workflow.provider_client.sleep", lambda seconds: sleeps.append(seconds), raising=False
    )

    with pytest.raises(HTTPError):
        generate_text("普通客户端错误")
    assert len(attempts) == 1
    assert sleeps == []


def test_generate_text_closes_cached_connection_before_retrying_transport_error(monkeypatch) -> None:
    """传输层异常后应丢弃坏连接，再重试生成。"""

    attempts: list[int] = []
    closed_urls: list[str] = []

    def flaky_post_chat_completion(**kwargs):
        attempts.append(1)
        if len(attempts) == 1:
            raise http.client.RemoteDisconnected("远端关闭连接")
        return {"choices": [{"message": {"content": "重建连接后正文"}}]}

    def fake_close_cached_connection(*, url: str, timeout: float) -> None:
        closed_urls.append(url)

    monkeypatch.setenv("STORYFORGE_LLM_API_KEY", "test-key")
    monkeypatch.setenv("STORYFORGE_LLM_RETRY_MAX_ATTEMPTS", "2")
    monkeypatch.setenv("STORYFORGE_LLM_RETRY_BASE_DELAY_SECONDS", "0")
    monkeypatch.setenv("STORYFORGE_LLM_RETRY_JITTER_SECONDS", "0")
    monkeypatch.setattr(
        "storyforge_workflow.provider_client._request_json_with_reused_connection", flaky_post_chat_completion
    )
    monkeypatch.setattr("storyforge_workflow.provider_client._close_cached_connection", fake_close_cached_connection)

    assert generate_text("传输异常后重试") == "重建连接后正文"
    assert len(attempts) == 2
    assert closed_urls == ["https://api.openai.com/v1/chat/completions"]


def test_provider_config_normalizes_user_facing_model_alias(monkeypatch) -> None:
    """用户口语化模型名应归一为网关实际暴露的 OpenAI 兼容模型 ID。"""

    from storyforge_workflow.provider_client import provider_config

    monkeypatch.setenv("STORYFORGE_LLM_API_KEY", "test-key")
    monkeypatch.setenv("STORYFORGE_LLM_MODEL", "GPT5.4mini")

    assert provider_config()["model"] == "gpt-5.4-mini"


def test_generate_text_uses_gateway_friendly_default_system_prompt(monkeypatch) -> None:
    """默认 system prompt 应使用英文任务边界，适配 Codex 类网关模型。"""

    captured: dict[str, object] = {}

    def fake_post_chat_completion(*, config: dict[str, str], body: bytes, timeout: float):
        captured["payload"] = json.loads(body.decode("utf-8"))
        captured["timeout"] = timeout
        return {"choices": [{"message": {"content": "正文"}}]}

    monkeypatch.setenv("STORYFORGE_LLM_API_KEY", "test-key")
    monkeypatch.setenv("STORYFORGE_LLM_MAX_TOKENS", "512")
    monkeypatch.setattr("storyforge_workflow.provider_client._post_chat_completion", fake_post_chat_completion)

    assert generate_text("继续正文") == "正文"
    payload = captured["payload"]
    assert payload["messages"][0]["content"].startswith("You are a creative writing engine")
    assert payload["max_tokens"] == 512


def test_generate_text_threads_temperature_and_model_override(monkeypatch) -> None:
    """显式 temperature/model 应进入请求体，支撑规划低温、正文高温的分层采样。"""

    captured: dict[str, object] = {}

    def fake_post_chat_completion(*, config: dict[str, str], body: bytes, timeout: float):
        captured["payload"] = json.loads(body.decode("utf-8"))
        return {"choices": [{"message": {"content": "正文"}}]}

    monkeypatch.setenv("STORYFORGE_LLM_API_KEY", "test-key")
    monkeypatch.setenv("STORYFORGE_LLM_MODEL", "default-model")
    monkeypatch.setattr("storyforge_workflow.provider_client._post_chat_completion", fake_post_chat_completion)

    assert generate_text("正文段落", temperature=0.85, model="draft-model") == "正文"
    payload = captured["payload"]
    assert payload["temperature"] == 0.85
    assert payload["model"] == "draft-model"


def test_generate_text_injects_openai_prompt_cache_fields_when_configured(monkeypatch) -> None:
    """启用 prompt caching 配置时，应把 OpenAI 缓存路由字段写入请求体。"""

    captured: dict[str, object] = {}

    def fake_post_chat_completion(*, config: dict[str, str], body: bytes, timeout: float):
        captured["payload"] = json.loads(body.decode("utf-8"))
        return {"choices": [{"message": {"content": "正文"}}]}

    monkeypatch.setenv("STORYFORGE_LLM_API_KEY", "test-key")
    monkeypatch.setenv("STORYFORGE_LLM_PROMPT_CACHE_KEY", "book:42:stable-context")
    monkeypatch.setenv("STORYFORGE_LLM_PROMPT_CACHE_RETENTION", "24h")
    monkeypatch.setattr("storyforge_workflow.provider_client._post_chat_completion", fake_post_chat_completion)

    assert generate_text("正文段落") == "正文"
    payload = captured["payload"]
    assert payload["prompt_cache_key"] == "book:42:stable-context"
    assert payload["prompt_cache_retention"] == "24h"
    assert "cache_control" not in payload


def test_generate_text_omits_prompt_cache_fields_by_default(monkeypatch) -> None:
    """未配置时不应向 OpenAI 兼容网关发送额外缓存字段。"""

    captured: dict[str, object] = {}

    def fake_post_chat_completion(*, config: dict[str, str], body: bytes, timeout: float):
        captured["payload"] = json.loads(body.decode("utf-8"))
        return {"choices": [{"message": {"content": "正文"}}]}

    monkeypatch.setenv("STORYFORGE_LLM_API_KEY", "test-key")
    monkeypatch.delenv("STORYFORGE_LLM_PROMPT_CACHE_KEY", raising=False)
    monkeypatch.delenv("STORYFORGE_LLM_PROMPT_CACHE_RETENTION", raising=False)
    monkeypatch.setattr("storyforge_workflow.provider_client._post_chat_completion", fake_post_chat_completion)

    assert generate_text("正文段落") == "正文"
    payload = captured["payload"]
    assert "prompt_cache_key" not in payload
    assert "prompt_cache_retention" not in payload
    assert "cache_control" not in payload


def test_generate_text_falls_back_to_global_temperature_and_model(monkeypatch) -> None:
    """未显式传参时 temperature/model 回退全局 env，保证旧调用方行为不变。"""

    captured: dict[str, object] = {}

    def fake_post_chat_completion(*, config: dict[str, str], body: bytes, timeout: float):
        captured["payload"] = json.loads(body.decode("utf-8"))
        return {"choices": [{"message": {"content": "正文"}}]}

    monkeypatch.setenv("STORYFORGE_LLM_API_KEY", "test-key")
    monkeypatch.setenv("STORYFORGE_LLM_MODEL", "default-model")
    monkeypatch.setenv("STORYFORGE_LLM_TEMPERATURE", "0.55")
    monkeypatch.setattr("storyforge_workflow.provider_client._post_chat_completion", fake_post_chat_completion)

    assert generate_text("默认参数段落") == "正文"
    payload = captured["payload"]
    assert payload["temperature"] == 0.55
    assert payload["model"] == "default-model"


def test_sampling_helpers_expose_layered_defaults(monkeypatch) -> None:
    """规划/正文温度助手在无 env 时给出分层默认值，可被 env 覆盖。"""

    from storyforge_workflow.provider_client import (
        draft_model,
        draft_temperature,
        planning_model,
        planning_temperature,
    )

    monkeypatch.delenv("STORYFORGE_LLM_PLANNING_TEMPERATURE", raising=False)
    monkeypatch.delenv("STORYFORGE_LLM_DRAFT_TEMPERATURE", raising=False)
    monkeypatch.delenv("STORYFORGE_LLM_PLANNING_MODEL", raising=False)
    monkeypatch.delenv("STORYFORGE_LLM_DRAFT_MODEL", raising=False)
    assert planning_temperature() == 0.3
    assert draft_temperature() == 0.85
    assert planning_model() is None
    assert draft_model() is None

    monkeypatch.setenv("STORYFORGE_LLM_PLANNING_TEMPERATURE", "0.2")
    monkeypatch.setenv("STORYFORGE_LLM_DRAFT_TEMPERATURE", "0.9")
    monkeypatch.setenv("STORYFORGE_LLM_DRAFT_MODEL", "writer-model")
    assert planning_temperature() == 0.2
    assert draft_temperature() == 0.9
    assert draft_model() == "writer-model"
