from __future__ import annotations

import io
import time
from urllib import error

import pytest

from app.common import llm_client
from app.common.llm_client import LLMError, build_llm_provider
from app.platform.ai_sdk.contracts import ChatMessage, ChatRequest, MessageRole


def _request(model: str = "writer-model") -> ChatRequest:
    return ChatRequest(
        model=model,
        messages=(ChatMessage(role=MessageRole.USER, content="润色这一段"),),
    )


def test_anthropic_config_uses_native_adapter(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_post(url, payload, headers, **kwargs):
        captured.update(url=url, payload=payload, headers=headers, kwargs=kwargs)
        return {
            "id": "msg_1",
            "type": "message",
            "role": "assistant",
            "content": [{"type": "text", "text": "润色完成"}],
            "model": "writer-model",
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 5, "output_tokens": 4},
        }

    monkeypatch.setattr(llm_client, "post_json_with_retry", fake_post)
    source = {
        "STORYFORGE_LLM_PROVIDER": "anthropic",
        "STORYFORGE_LLM_BASE_URL": "https://api.example/v1",
        "STORYFORGE_LLM_MODEL": "writer-model",
        "STORYFORGE_LLM_API_KEY": "secret-key",
    }

    response = build_llm_provider(source).complete(_request())

    assert response.content == "润色完成"
    assert captured["url"] == "https://api.example/v1/messages"
    assert captured["headers"]["x-api-key"] == "secret-key"
    assert "messages" in captured["payload"]
    assert "Authorization" not in captured["headers"]


def test_gemini_config_uses_native_adapter_without_query_secret(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_post(url, payload, headers, **kwargs):
        captured.update(url=url, payload=payload, headers=headers, kwargs=kwargs)
        return {
            "candidates": [
                {
                    "content": {"role": "model", "parts": [{"text": "润色完成"}]},
                    "finishReason": "STOP",
                }
            ],
            "usageMetadata": {
                "promptTokenCount": 5,
                "candidatesTokenCount": 4,
                "totalTokenCount": 9,
            },
        }

    monkeypatch.setattr(llm_client, "post_json_with_retry", fake_post)
    source = {
        "STORYFORGE_LLM_PROVIDER": "gemini",
        "STORYFORGE_LLM_BASE_URL": "https://api.example/v1beta",
        "STORYFORGE_LLM_MODEL": "writer/model",
        "STORYFORGE_LLM_API_KEY": "secret-key",
    }

    response = build_llm_provider(source).complete(_request("writer/model"))

    assert response.content == "润色完成"
    assert captured["url"] == "https://api.example/v1beta/models/writer%2Fmodel:generateContent"
    assert captured["headers"]["x-goog-api-key"] == "secret-key"
    assert "secret-key" not in captured["url"]
    assert "contents" in captured["payload"]


def test_existing_provider_names_remain_openai_compatible(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_request(source, payload, **kwargs):
        captured.update(source=source, payload=payload, kwargs=kwargs)
        return (
            {
                "choices": [{"message": {"role": "assistant", "content": "兼容结果"}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 2, "completion_tokens": 2, "total_tokens": 4},
            },
            time.monotonic(),
        )

    monkeypatch.setattr(llm_client, "_request_chat_completions", fake_request)
    source = {
        "STORYFORGE_LLM_PROVIDER": "deepseek",
        "STORYFORGE_LLM_BASE_URL": "https://api.example/v1",
        "STORYFORGE_LLM_MODEL": "writer-model",
        "STORYFORGE_LLM_API_KEY": "secret-key",
    }

    response = build_llm_provider(source).complete(_request())

    assert response.content == "兼容结果"
    assert "messages" in captured["payload"]


def test_native_stream_http_error_never_exposes_response_body(monkeypatch) -> None:
    leaked_body = b'{"error":"upstream private detail secret-key"}'

    def fake_urlopen(request, timeout):
        raise error.HTTPError(
            request.full_url,
            401,
            "Unauthorized",
            {},
            io.BytesIO(leaked_body),
        )

    monkeypatch.setattr(llm_client.request, "urlopen", fake_urlopen)
    source = {
        "STORYFORGE_LLM_PROVIDER": "anthropic",
        "STORYFORGE_LLM_BASE_URL": "https://api.example/v1",
        "STORYFORGE_LLM_MODEL": "writer-model",
        "STORYFORGE_LLM_API_KEY": "secret-key",
    }

    with pytest.raises(LLMError) as caught:
        list(build_llm_provider(source).stream(_request()))

    assert str(caught.value) == "Anthropic 流式返回 HTTP 401。"
    assert "private detail" not in str(caught.value)
    assert "secret-key" not in str(caught.value)
