"""_call_llm 有界重试 + 退避护栏的真实协议边界测试。

沿用 test_book_generation.py 的惯例：用本地 HTTPServer 模拟 OpenAI 兼容端点，
走真实 urllib 路径，而非 monkeypatch urlopen。退避 base_delay/jitter 置 0 以免拖慢测试。
"""
from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Thread

import pytest

from app.domains.book_runs.book_generation_llm import _call_llm
from app.domains.book_runs.errors import BookGenerationError


class _FlakyChatHandler(BaseHTTPRequestHandler):
    """前 fail_times 次返回 status_code，之后返回正常正文。类级计数器跨请求累计。"""

    fail_times = 0
    status_code = 429
    attempts = 0

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("content-length", "0"))
        self.rfile.read(length)
        cls = self.__class__
        cls.attempts += 1
        if cls.attempts <= cls.fail_times:
            body = json.dumps({"error": {"message": "transient"}}).encode("utf-8")
            self.send_response(cls.status_code)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.send_header("retry-after", "0")  # 0 秒，避免真实 sleep
            self.end_headers()
            self.wfile.write(body)
            return
        body = json.dumps(
            {
                "choices": [{"message": {"content": "真实正文：林岚核对每一处线索并完成调查。"}}],
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
    _FlakyChatHandler.attempts = 0
    server = HTTPServer(("127.0.0.1", 0), _FlakyChatHandler)
    Thread(target=server.serve_forever, daemon=True).start()
    return server


def _source(port: int, **overrides: str) -> dict[str, str]:
    base = {
        "STORYFORGE_LLM_API_KEY": "test-key",
        "STORYFORGE_LLM_BASE_URL": f"http://127.0.0.1:{port}/v1",
        "STORYFORGE_LLM_MODEL": "test-model",
        "STORYFORGE_LLM_PROVIDER": "openai-compatible",
        "STORYFORGE_LLM_RETRY_MAX_ATTEMPTS": "3",
        "STORYFORGE_LLM_RETRY_BASE_DELAY_SECONDS": "0",
        "STORYFORGE_LLM_RETRY_JITTER_SECONDS": "0",
    }
    base.update(overrides)
    return base


def test_call_llm_retries_then_succeeds_after_transient_429() -> None:
    """连续 2 次 429 后成功：返回正文，且恰好尝试 3 次。"""

    _FlakyChatHandler.fail_times = 2
    _FlakyChatHandler.status_code = 429
    server = _serve()
    try:
        result = _call_llm(_source(server.server_address[1]), system_prompt="s", user_prompt="u")
    finally:
        server.shutdown()
    assert "林岚" in result["content"]
    assert _FlakyChatHandler.attempts == 3


def test_call_llm_retries_on_5xx() -> None:
    """5xx 同样可重试。"""

    _FlakyChatHandler.fail_times = 1
    _FlakyChatHandler.status_code = 503
    server = _serve()
    try:
        result = _call_llm(_source(server.server_address[1]), system_prompt="s", user_prompt="u")
    finally:
        server.shutdown()
    assert "林岚" in result["content"]
    assert _FlakyChatHandler.attempts == 2


def test_call_llm_raises_after_exhausting_retries() -> None:
    """持续 5xx 超过 max_attempts：抛 BookGenerationError，尝试次数不超过上限。"""

    _FlakyChatHandler.fail_times = 5
    _FlakyChatHandler.status_code = 503
    server = _serve()
    try:
        with pytest.raises(BookGenerationError):
            _call_llm(_source(server.server_address[1]), system_prompt="s", user_prompt="u")
    finally:
        server.shutdown()
    assert _FlakyChatHandler.attempts == 3


def test_call_llm_does_not_retry_on_client_error() -> None:
    """4xx（非 429）立即失败，不重试，不掩盖真实问题。"""

    _FlakyChatHandler.fail_times = 5
    _FlakyChatHandler.status_code = 400
    server = _serve()
    try:
        with pytest.raises(BookGenerationError):
            _call_llm(_source(server.server_address[1]), system_prompt="s", user_prompt="u")
    finally:
        server.shutdown()
    assert _FlakyChatHandler.attempts == 1
