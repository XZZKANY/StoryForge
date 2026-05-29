from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Thread

from storyforge_workflow.provider_client import generate_text


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
        server.shutdown()
        thread.join(timeout=2)

    assert result.startswith("模型响应：请根据不同 premise")

def test_provider_config_normalizes_user_facing_model_alias(monkeypatch) -> None:
    """用户口语化模型名应归一为网关实际暴露的 OpenAI 兼容模型 ID。"""

    from storyforge_workflow.provider_client import provider_config

    monkeypatch.setenv("STORYFORGE_LLM_API_KEY", "test-key")
    monkeypatch.setenv("STORYFORGE_LLM_MODEL", "GPT5.4mini")

    assert provider_config()["model"] == "gpt-5.4-mini"



def test_generate_text_uses_gateway_friendly_default_system_prompt(monkeypatch) -> None:
    """默认 system prompt 应使用英文任务边界，适配 Codex 类网关模型。"""

    captured: dict[str, object] = {}

    class _Response:
        def __enter__(self) -> _Response:
            return self

        def __exit__(self, exc_type: object, exc: object, tb: object) -> None:
            return None

        def read(self) -> bytes:
            return json.dumps({"choices": [{"message": {"content": "正文"}}]}).encode("utf-8")

    def fake_urlopen(http_request, timeout: float):
        captured["payload"] = json.loads(http_request.data.decode("utf-8"))
        captured["timeout"] = timeout
        return _Response()

    monkeypatch.setenv("STORYFORGE_LLM_API_KEY", "test-key")
    monkeypatch.setenv("STORYFORGE_LLM_MAX_TOKENS", "512")
    monkeypatch.setattr("storyforge_workflow.provider_client.request.urlopen", fake_urlopen)

    assert generate_text("继续正文") == "正文"
    payload = captured["payload"]
    assert payload["messages"][0]["content"].startswith("You are a creative writing engine")
    assert payload["max_tokens"] == 512
