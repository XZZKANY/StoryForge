"""W3：单一 chat 出网通道（app.common.llm_client）行为矩阵。

用本地 HTTPServer 走真实 urllib 路径，断言双鉴权（bearer / api-key）、429 重试、思维链剥离
三条路径行为一致，且凭据不落日志 / 不进异常消息。另覆盖 story_state grounding 改吃
resolved_llm_env 覆盖链（修 W3 漏迁）与失败日志脱敏。
"""
from __future__ import annotations

import json
import logging
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Thread
from types import SimpleNamespace

import pytest

from app.common.llm_client import LLMError, _call_llm, _call_llm_messages, redact_secrets

_API_KEY = "sk-secret-test-key-123456"


class _ChatHandler(BaseHTTPRequestHandler):
    fail_times = 0
    status_code = 429
    attempts = 0
    last_headers: dict[str, str] | None = None
    response_message: dict[str, object] | None = None

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("content-length", "0"))
        self.rfile.read(length)
        cls = self.__class__
        cls.last_headers = {key.lower(): value for key, value in self.headers.items()}
        cls.attempts += 1
        if cls.attempts <= cls.fail_times:
            body = json.dumps({"error": {"message": "transient"}}).encode("utf-8")
            self.send_response(cls.status_code)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.send_header("retry-after", "0")
            self.end_headers()
            self.wfile.write(body)
            return
        message = cls.response_message or {"content": "真实正文：林岚核对线索。"}
        body = json.dumps(
            {
                "choices": [{"message": message}],
                "usage": {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30},
            },
            ensure_ascii=False,
        ).encode("utf-8")
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        return


def _serve() -> HTTPServer:
    _ChatHandler.attempts = 0
    _ChatHandler.last_headers = None
    _ChatHandler.response_message = None
    server = HTTPServer(("127.0.0.1", 0), _ChatHandler)
    Thread(target=server.serve_forever, daemon=True).start()
    return server


def _source(port: int, **overrides: str) -> dict[str, str]:
    base = {
        "STORYFORGE_LLM_API_KEY": _API_KEY,
        "STORYFORGE_LLM_BASE_URL": f"http://127.0.0.1:{port}/v1",
        "STORYFORGE_LLM_MODEL": "test-model",
        "STORYFORGE_LLM_RETRY_MAX_ATTEMPTS": "3",
        "STORYFORGE_LLM_RETRY_BASE_DELAY_SECONDS": "0",
        "STORYFORGE_LLM_RETRY_JITTER_SECONDS": "0",
    }
    base.update(overrides)
    return base


def test_channel_bearer_auth_header_default() -> None:
    """默认 bearer：Authorization: Bearer <key>，无 api-key 头。"""

    _ChatHandler.fail_times = 0
    server = _serve()
    try:
        _call_llm(_source(server.server_address[1]), system_prompt="s", user_prompt="u")
    finally:
        server.shutdown()
    headers = _ChatHandler.last_headers or {}
    assert headers.get("authorization") == f"Bearer {_API_KEY}"
    assert "api-key" not in headers


def test_channel_api_key_auth_header() -> None:
    """STORYFORGE_LLM_AUTH_HEADER=api-key：走 api-key 头，无 Authorization。"""

    _ChatHandler.fail_times = 0
    server = _serve()
    try:
        _call_llm(
            _source(server.server_address[1], STORYFORGE_LLM_AUTH_HEADER="api-key"),
            system_prompt="s",
            user_prompt="u",
        )
    finally:
        server.shutdown()
    headers = _ChatHandler.last_headers or {}
    assert headers.get("api-key") == _API_KEY
    assert "authorization" not in headers


@pytest.mark.parametrize("auth_header", ["bearer", "api-key"])
def test_channel_retries_429_then_succeeds_both_auth_paths(auth_header: str) -> None:
    """两种鉴权路径下 429→重试→成功行为一致：恰好尝试 2 次。"""

    _ChatHandler.fail_times = 1
    _ChatHandler.status_code = 429
    server = _serve()
    overrides = {} if auth_header == "bearer" else {"STORYFORGE_LLM_AUTH_HEADER": "api-key"}
    try:
        result = _call_llm(
            _source(server.server_address[1], **overrides), system_prompt="s", user_prompt="u"
        )
    finally:
        server.shutdown()
    assert "林岚" in result["content"]
    assert _ChatHandler.attempts == 2


def test_channel_strips_reasoning_leak() -> None:
    """<think> 泄漏被剥离，剩正文，并标记 reasoning_leak_stripped。"""

    _ChatHandler.fail_times = 0
    server = _serve()
    _ChatHandler.response_message = {"content": "<think>模型内部推理不该外泄</think>沈砚在钟楼下停步。"}
    try:
        result = _call_llm(_source(server.server_address[1]), system_prompt="s", user_prompt="u")
    finally:
        server.shutdown()
    assert result["content"] == "沈砚在钟楼下停步。"
    assert result.get("reasoning_leak_stripped") is True


def test_channel_messages_variant_allows_tool_calls_only() -> None:
    """messages 版允许 content 为空、只回 tool_calls（工具循环合法中间态）。"""

    _ChatHandler.fail_times = 0
    server = _serve()
    _ChatHandler.response_message = {
        "content": "",
        "tool_calls": [
            {"id": "c1", "type": "function", "function": {"name": "fs_read", "arguments": "{}"}}
        ],
    }
    try:
        result = _call_llm_messages(
            _source(server.server_address[1]),
            messages=[{"role": "user", "content": "读一下"}],
        )
    finally:
        server.shutdown()
    assert result["content"] == ""
    assert result["tool_calls"][0]["function"]["name"] == "fs_read"


def test_channel_error_message_never_contains_key(caplog) -> None:
    """4xx 立即失败：抛出的异常消息与相关日志都不得含凭据子串。"""

    _ChatHandler.fail_times = 5
    _ChatHandler.status_code = 400
    server = _serve()
    try:
        with caplog.at_level(logging.WARNING), pytest.raises(LLMError) as excinfo:
            _call_llm(_source(server.server_address[1]), system_prompt="s", user_prompt="u")
    finally:
        server.shutdown()
    assert _API_KEY not in str(excinfo.value)
    assert _API_KEY not in caplog.text
    assert _ChatHandler.attempts == 1


def test_redact_secrets_scrubs_key_substring() -> None:
    assert redact_secrets(f"boom key={_API_KEY} tail", [_API_KEY]) == "boom key=*** tail"
    # 过短的密钥不脱敏（避免误伤正常文本）；None 安全跳过。
    assert redact_secrets("abc", ["ab"]) == "abc"
    assert redact_secrets("abc", [None]) == "abc"


def _change(seq: int) -> SimpleNamespace:
    return SimpleNamespace(
        seq=seq,
        change_type="update",
        entity_kind="character",
        entity_id="lin-lan",
        canonical_name="林岚",
        surface_forms=["林岚"],
        payload={},
    )


def test_story_state_grounding_reads_resolved_llm_env(monkeypatch) -> None:
    """W3 修漏迁：story_state grounding 必须吃 resolved_llm_env（含 llm-provider.json 覆盖），
    而非裸 os.getenv——否则 sidecar 下 grounding 静默失活。"""

    from app.domains.story_state import semantic as story_semantic

    _ChatHandler.fail_times = 0
    server = _serve()
    _ChatHandler.response_message = {"content": json.dumps([{"seq": 1, "score": 90, "reason": "ok"}])}
    # 清掉进程 env 的 JUDGE/LLM key，证明配置只能来自 resolved_llm_env 覆盖链。
    for key in ("STORYFORGE_JUDGE_LLM_API_KEY", "STORYFORGE_LLM_API_KEY"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setattr(
        story_semantic,
        "resolved_llm_env",
        lambda: {
            "STORYFORGE_LLM_API_KEY": _API_KEY,
            "STORYFORGE_LLM_BASE_URL": f"http://127.0.0.1:{server.server_address[1]}/v1",
            "STORYFORGE_LLM_MODEL": "test-model",
        },
    )
    try:
        advisories = story_semantic.semantic_ground_story_state_changes("正文", [_change(1)])
    finally:
        server.shutdown()
    assert advisories[1].semantic_score == 90
    assert (_ChatHandler.last_headers or {}).get("authorization") == f"Bearer {_API_KEY}"


def test_story_state_grounding_unconfigured_returns_empty(monkeypatch) -> None:
    """resolved_llm_env 无 key 时静默跳过（返回空 advisory），不伪造、不报错。"""

    from app.domains.story_state import semantic as story_semantic

    for key in ("STORYFORGE_JUDGE_LLM_API_KEY", "STORYFORGE_LLM_API_KEY"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setattr(story_semantic, "resolved_llm_env", dict)
    assert story_semantic.semantic_ground_story_state_changes("正文", [_change(1)]) == {}


def test_story_state_grounding_failure_redacts_key(monkeypatch, caplog) -> None:
    """grounding 远程失败时，失败日志不得含凭据子串（脱敏三件套之一）。"""

    from app.domains.story_state import semantic as story_semantic

    _ChatHandler.fail_times = 9
    _ChatHandler.status_code = 500
    server = _serve()
    for key in ("STORYFORGE_JUDGE_LLM_API_KEY", "STORYFORGE_LLM_API_KEY"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setattr(
        story_semantic,
        "resolved_llm_env",
        lambda: {
            "STORYFORGE_LLM_API_KEY": _API_KEY,
            "STORYFORGE_LLM_BASE_URL": f"http://127.0.0.1:{server.server_address[1]}/v1",
            "STORYFORGE_LLM_MODEL": "test-model",
        },
    )
    try:
        with caplog.at_level(logging.WARNING):
            advisories = story_semantic.semantic_ground_story_state_changes("正文", [_change(1)])
    finally:
        server.shutdown()
    assert advisories[1].semantic_reason == "semantic_grounding_failed"
    assert _API_KEY not in caplog.text
