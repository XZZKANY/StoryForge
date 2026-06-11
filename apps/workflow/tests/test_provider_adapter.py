from __future__ import annotations

from dataclasses import FrozenInstanceError
import io
from email.message import Message
from urllib.error import HTTPError

import pytest

import storyforge_workflow.runtime.provider_adapter as provider_adapter_module
from storyforge_workflow.provider_client import ChatCompletionResult, ChatCompletionUsage
from storyforge_workflow.runtime.provider_adapter import (
    MockProviderAdapter,
    ProviderClientAdapter,
    ProviderError,
    ProviderErrorKind,
    ProviderRequest,
    ProviderResponse,
    ProviderTimeoutError,
)
from storyforge_workflow.runtime.provider_execution import execute_provider_text


def _http_error(
    code: int,
    *,
    msg: str | None = None,
    headers: dict[str, str] | None = None,
    body: bytes = b"",
) -> HTTPError:
    message = Message()
    for key, value in (headers or {}).items():
        message[key] = value
    return HTTPError(
        url="https://provider.test",
        code=code,
        msg=msg or "provider error",
        hdrs=message,
        fp=io.BytesIO(body),
    )


def test_provider_request_and_response_are_frozen_snapshots() -> None:
    """provider 请求和响应应固定为不可变快照，避免运行中被改写。"""

    request = ProviderRequest(
        capability="llm",
        prompt="请生成章节摘要。",
        model_alias="draft-writer",
        metadata={"request_id": "req-1", "thread_id": "thread-1"},
    )
    response = ProviderResponse(
        provider_name="mock-provider",
        model_name="storyforge-writer",
        request_id="req-1",
        output_text="章节摘要。",
        latency_ms=12,
        token_usage=18,
        finish_reason="stop",
    )

    with pytest.raises(FrozenInstanceError):
        request.prompt = "被错误改写。"  # type: ignore[misc]
    with pytest.raises(FrozenInstanceError):
        response.output_text = "被错误改写。"  # type: ignore[misc]


def test_provider_client_adapter_uses_gateway_config_and_normalizes_response() -> None:
    """真实 adapter 只使用 provider 配置真相源，并统一响应字段。"""

    calls: list[str] = []
    ticks = iter([10.0, 10.025])

    def generate_text_fn(prompt: str) -> str:
        calls.append(prompt)
        return "模型输出：章节冲突升级。"

    def config_loader() -> dict[str, str]:
        return {"provider_name": "gateway-provider", "model": "gateway-model"}

    adapter = ProviderClientAdapter(
        generate_text_fn=generate_text_fn,
        config_loader=config_loader,
        timer=lambda: next(ticks),
    )

    response = adapter.generate(
        ProviderRequest(
            capability="llm",
            prompt="输入提示。",
            model_alias="请求侧别名不应覆盖网关模型",
            metadata={"request_id": "req-2"},
        )
    )

    assert calls == ["输入提示。"]
    assert response.provider_name == "gateway-provider"
    assert response.model_name == "gateway-model"
    assert response.request_id == "req-2"
    assert response.output_text == "模型输出：章节冲突升级。"
    assert response.latency_ms == 25
    assert response.token_usage == max(1, (len("输入提示。") + len("模型输出：章节冲突升级。")) // 4)
    assert response.finish_reason == "stop"


def test_provider_client_adapter_prefers_real_chat_completion_usage() -> None:
    """真实 Chat Completion usage 应优先进入响应字段，不能再被估算覆盖。"""

    ticks = iter([20.0, 20.042])

    def generate_chat_completion_fn(prompt: str) -> ChatCompletionResult:
        assert prompt == "输入提示。"
        return ChatCompletionResult(
            content="模型输出：章节冲突升级。",
            usage=ChatCompletionUsage(prompt_tokens=123, completion_tokens=45, total_tokens=168),
            finish_reason="length",
            request_id="chatcmpl-real-usage",
            model="gpt-4o-mini",
        )

    adapter = ProviderClientAdapter(
        generate_chat_completion_fn=generate_chat_completion_fn,
        config_loader=lambda: {"provider_name": "openai", "model": "gpt-4o-mini"},
        timer=lambda: next(ticks),
    )

    response = adapter.generate(
        ProviderRequest(
            capability="llm",
            prompt="输入提示。",
            model_alias=None,
            metadata={"request_id": "fallback-request-id"},
        )
    )

    assert response.provider_name == "openai"
    assert response.model_name == "gpt-4o-mini"
    assert response.request_id == "chatcmpl-real-usage"
    assert response.output_text == "模型输出：章节冲突升级。"
    assert response.latency_ms == 42
    assert response.prompt_tokens == 123
    assert response.completion_tokens == 45
    assert response.token_usage == 168
    assert response.finish_reason == "length"
    assert response.cost_estimate > 0


def test_default_provider_adapter_uses_real_chat_completion_result(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """默认生产装配必须使用完整 Chat Completion 结果，而不是旧字符串接口。"""

    def generate_chat_completion_fn(prompt: str) -> ChatCompletionResult:
        return ChatCompletionResult(
            content="默认装配模型输出。",
            usage=ChatCompletionUsage(prompt_tokens=77, completion_tokens=33, total_tokens=110),
            finish_reason="stop",
            request_id="chatcmpl-default",
            model="gpt-4o-mini",
        )

    monkeypatch.setattr(provider_adapter_module, "generate_chat_completion", generate_chat_completion_fn)
    monkeypatch.setattr(
        provider_adapter_module,
        "provider_config",
        lambda: {"provider_name": "openai", "model": "gpt-4o-mini"},
    )

    adapter = provider_adapter_module.build_default_provider_adapter()
    response = adapter.generate(
        ProviderRequest(
            capability="llm",
            prompt="输入提示。",
            model_alias=None,
            metadata={},
        )
    )

    assert response.request_id == "chatcmpl-default"
    assert response.prompt_tokens == 77
    assert response.completion_tokens == 33
    assert response.token_usage == 110


def test_provider_client_adapter_estimates_cost_from_actual_response_model() -> None:
    """成本估算应与响应中的实际模型一致，避免网关改写模型名后观测失真。"""

    def generate_chat_completion_fn(prompt: str) -> ChatCompletionResult:
        return ChatCompletionResult(
            content="模型输出。",
            usage=ChatCompletionUsage(prompt_tokens=1000, completion_tokens=1000, total_tokens=2000),
            finish_reason="stop",
            request_id=None,
            model="gpt-4o",
        )

    adapter = ProviderClientAdapter(
        generate_chat_completion_fn=generate_chat_completion_fn,
        config_loader=lambda: {"provider_name": "openai", "model": "custom-router-model"},
    )

    response = adapter.generate(
        ProviderRequest(capability="llm", prompt="输入提示。", model_alias=None, metadata={})
    )

    assert response.model_name == "gpt-4o"
    assert response.cost_estimate == 0.02


def test_mock_provider_adapter_returns_deterministic_acceptance_response() -> None:
    """Mock Provider 应按同一请求稳定返回验收响应。"""

    adapter = MockProviderAdapter(
        provider_name="mock-provider",
        model_name="mock-writer",
        latency_ms=7,
        token_usage=11,
        response_factory=lambda request: f"验收响应：{request.capability}:{request.prompt}",
    )
    request = ProviderRequest(
        capability="llm",
        prompt="固定输入。",
        model_alias=None,
        metadata={"request_id": "mock-req"},
    )

    first = adapter.generate(request)
    second = adapter.generate(request)

    assert first == second
    assert first.provider_name == "mock-provider"
    assert first.model_name == "mock-writer"
    assert first.request_id == "mock-req"
    assert first.output_text == "验收响应：llm:固定输入。"
    assert first.latency_ms == 7
    assert first.token_usage == 11
    assert first.finish_reason == "stop"


def test_execute_provider_text_delegates_to_provider_adapter() -> None:
    """既有 provider_execution 入口应委托统一 adapter，同时保持返回结构兼容。"""

    adapter = MockProviderAdapter(
        provider_name="mock-provider",
        model_name="mock-writer",
        latency_ms=5,
        token_usage=9,
        response_factory=lambda request: f"adapter 摘要：{request.prompt}",
    )

    result = execute_provider_text(capability="llm", prompt_summary="章节输入。", adapter=adapter)

    assert result.capability == "llm"
    assert result.provider_name == "mock-provider"
    assert result.model_name == "mock-writer"
    assert result.latency_ms == 5
    assert result.token_usage == 9
    assert result.summary == "adapter 摘要：章节输入。"


def test_provider_client_adapter_maps_rate_limit_to_clear_provider_error() -> None:
    """HTTP 429 应转换为带状态码的 provider 错误，调用方不需要理解 urllib。"""

    def generate_text_fn(prompt: str) -> str:
        raise _http_error(429, headers={"Retry-After": "12"})

    adapter = ProviderClientAdapter(
        generate_text_fn=generate_text_fn,
        config_loader=lambda: {"provider_name": "gateway-provider", "model": "gateway-model"},
    )

    with pytest.raises(ProviderError) as exc_info:
        adapter.generate(ProviderRequest(capability="llm", prompt="输入提示。", model_alias=None, metadata={}))

    assert exc_info.value.status_code == 429
    assert exc_info.value.kind == ProviderErrorKind.RATE_LIMIT
    assert exc_info.value.retry_after_seconds == 12
    assert "429" in str(exc_info.value)
    assert "限流" in str(exc_info.value)


@pytest.mark.parametrize(
    ("error", "expected_kind"),
    [
        (_http_error(401), ProviderErrorKind.AUTH),
        (_http_error(403), ProviderErrorKind.AUTH),
        (_http_error(403, body=b'{"error":{"message":"invalid api key"}}'), ProviderErrorKind.AUTH),
        (_http_error(413), ProviderErrorKind.CONTEXT_LENGTH_EXCEEDED),
        (_http_error(400, body=b'{"error":{"message":"maximum context length exceeded"}}'), ProviderErrorKind.CONTEXT_LENGTH_EXCEEDED),
        (_http_error(400, body=b'{"error":{"message":"content filter triggered"}}'), ProviderErrorKind.CONTENT_FILTER),
        (_http_error(500), ProviderErrorKind.SERVER),
        (ConnectionError("连接被重置"), ProviderErrorKind.NETWORK),
        (OSError("网络不可达"), ProviderErrorKind.NETWORK),
    ],
)
def test_provider_client_adapter_classifies_provider_errors(
    error: Exception,
    expected_kind: ProviderErrorKind,
) -> None:
    """adapter 应把底层失败稳定归类，供 fallback 和 ModelRun 观测。"""

    def generate_text_fn(prompt: str) -> str:
        raise error

    adapter = ProviderClientAdapter(
        generate_text_fn=generate_text_fn,
        config_loader=lambda: {"provider_name": "gateway-provider", "model": "gateway-model"},
    )

    with pytest.raises(ProviderError) as exc_info:
        adapter.generate(ProviderRequest(capability="llm", prompt="输入提示。", model_alias=None, metadata={}))

    assert exc_info.value.kind == expected_kind


def test_provider_client_adapter_maps_server_error_with_status_code() -> None:
    """HTTP 500 应转换为带状态码的 provider 错误。"""

    def generate_text_fn(prompt: str) -> str:
        raise HTTPError(url="https://provider.test", code=500, msg="Internal Server Error", hdrs=None, fp=None)

    adapter = ProviderClientAdapter(
        generate_text_fn=generate_text_fn,
        config_loader=lambda: {"provider_name": "gateway-provider", "model": "gateway-model"},
    )

    with pytest.raises(ProviderError) as exc_info:
        adapter.generate(ProviderRequest(capability="llm", prompt="输入提示。", model_alias=None, metadata={}))

    assert exc_info.value.status_code == 500
    assert "500" in str(exc_info.value)


def test_provider_client_adapter_maps_timeout_to_dedicated_error() -> None:
    """provider 连接超时应转换为专用 timeout 异常。"""

    def generate_text_fn(prompt: str) -> str:
        raise TimeoutError("provider 连接超时")

    adapter = ProviderClientAdapter(
        generate_text_fn=generate_text_fn,
        config_loader=lambda: {"provider_name": "gateway-provider", "model": "gateway-model"},
    )

    with pytest.raises(ProviderTimeoutError) as exc_info:
        adapter.generate(ProviderRequest(capability="llm", prompt="输入提示。", model_alias=None, metadata={}))

    assert exc_info.value.status_code is None
    assert exc_info.value.kind == ProviderErrorKind.TIMEOUT
    assert "超时" in str(exc_info.value)
