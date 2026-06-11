from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Thread

import pytest

from storyforge_workflow.runtime.provider_adapter import (
    FallbackProviderAdapter,
    MockProviderAdapter,
    ProviderAdapter,
    ProviderClientAdapter,
    ProviderError,
    ProviderErrorKind,
    ProviderRequest,
    ProviderResponse,
    build_default_provider_adapter,
)


class _MalformedFallbackHandler(BaseHTTPRequestHandler):
    """返回指定畸形 JSON，模拟 fallback provider 的兼容端点。"""

    response_payload: dict[str, object] = {}

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("content-length", "0"))
        self.rfile.read(length)
        body = json.dumps(self.response_payload, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        return


def _make_request() -> ProviderRequest:
    return ProviderRequest(
        capability="llm",
        prompt="原始提示。",
        model_alias=None,
        metadata={"request_id": "req-fallback-1"},
    )


def test_fallback_provider_adapter_returns_primary_response_when_primary_succeeds() -> None:
    primary = MockProviderAdapter(
        provider_name="primary",
        model_name="primary-model",
        response_factory=lambda request: "主 provider 响应",
    )
    fallback = MockProviderAdapter(
        provider_name="fallback",
        model_name="fallback-model",
        response_factory=lambda request: "备用 provider 响应",
    )
    observed: list[tuple[str, dict[str, object]]] = []
    adapter = FallbackProviderAdapter(
        primary=primary,
        fallback=fallback,
        on_fallback=lambda error, metadata: observed.append((str(error), dict(metadata))),
    )

    response = adapter.generate(_make_request())

    assert response.provider_name == "primary"
    assert response.output_text == "主 provider 响应"
    assert response.fallback_metadata is None
    assert observed == []
    assert adapter.last_fallback_metadata is None


def test_fallback_provider_adapter_routes_to_fallback_on_provider_error() -> None:
    class FailingPrimary:
        def generate(self, request: ProviderRequest) -> ProviderResponse:
            raise ProviderError(
                "主 provider 限流",
                status_code=429,
                kind=ProviderErrorKind.RATE_LIMIT,
                retry_after_seconds=9,
            )

    fallback = MockProviderAdapter(
        provider_name="fallback",
        model_name="fallback-model",
        response_factory=lambda request: "备用 provider 响应",
    )
    observed: list[tuple[str, dict[str, object]]] = []
    adapter = FallbackProviderAdapter(
        primary=FailingPrimary(),
        fallback=fallback,
        on_fallback=lambda error, metadata: observed.append((str(error), dict(metadata))),
    )

    response = adapter.generate(_make_request())

    assert response.provider_name == "fallback"
    assert response.output_text == "备用 provider 响应"
    assert response.fallback_metadata is not None
    assert response.fallback_metadata["primary_provider_error"] == "主 provider 限流"
    assert response.fallback_metadata["primary_provider_status_code"] == 429
    assert response.fallback_metadata["primary_provider_error_kind"] == "rate_limit"
    assert response.fallback_metadata["primary_provider_retry_after_seconds"] == 9
    assert response.fallback_metadata["request_id"] == "req-fallback-1"
    assert response.fallback_metadata["capability"] == "llm"
    assert observed and observed[0][0] == "主 provider 限流"
    assert adapter.last_fallback_metadata == response.fallback_metadata


def test_fallback_provider_adapter_propagates_fallback_errors() -> None:
    class FailingPrimary:
        def generate(self, request: ProviderRequest) -> ProviderResponse:
            raise ProviderError("主失败")

    class FailingFallback:
        def generate(self, request: ProviderRequest) -> ProviderResponse:
            raise ProviderError("备用也失败")

    adapter = FallbackProviderAdapter(
        primary=FailingPrimary(),
        fallback=FailingFallback(),
        on_fallback=lambda error, metadata: None,
    )

    with pytest.raises(ProviderError, match="备用"):
        adapter.generate(_make_request())


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"choices": []},
        {"choices": [{}]},
        {"choices": [{"message": {}}]},
        {"choices": [{"message": {"content": ""}}]},
    ],
)
def test_default_fallback_provider_rejects_malformed_response(
    monkeypatch: pytest.MonkeyPatch,
    payload: dict[str, object],
) -> None:
    """fallback provider 响应结构错误时应抛出语义明确的 ProviderError。"""

    class FailingPrimary:
        def generate(self, request: ProviderRequest) -> ProviderResponse:
            raise ProviderError("主失败")

    _MalformedFallbackHandler.response_payload = payload
    server = HTTPServer(("127.0.0.1", 0), _MalformedFallbackHandler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    monkeypatch.setenv("STORYFORGE_LLM_FALLBACK_PROVIDER", "fallback-provider")
    monkeypatch.setenv("STORYFORGE_LLM_FALLBACK_MODEL", "fallback-model")
    monkeypatch.setenv("STORYFORGE_LLM_FALLBACK_API_KEY", "test-key")
    monkeypatch.setenv("STORYFORGE_LLM_FALLBACK_BASE_URL", f"http://127.0.0.1:{server.server_port}/v1")

    try:
        adapter = build_default_provider_adapter(primary_factory=lambda: FailingPrimary())
        with pytest.raises(ProviderError, match="fallback provider 响应格式无效"):
            adapter.generate(_make_request())
    finally:
        server.shutdown()
        thread.join(timeout=2)


def test_build_default_provider_adapter_without_fallback_env_returns_primary(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("STORYFORGE_LLM_FALLBACK_PROVIDER", raising=False)
    monkeypatch.delenv("STORYFORGE_LLM_FALLBACK_MODEL", raising=False)

    sentinel = MockProviderAdapter(provider_name="primary", model_name="primary-model")
    adapter = build_default_provider_adapter(
        primary_factory=lambda: sentinel,
        fallback_factory=lambda: pytest.fail("fallback factory should not run"),
    )

    assert adapter is sentinel


def test_build_default_provider_adapter_wraps_when_fallback_env_present(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("STORYFORGE_LLM_FALLBACK_PROVIDER", "openai")
    monkeypatch.setenv("STORYFORGE_LLM_FALLBACK_MODEL", "gpt-4o-mini")

    primary = MockProviderAdapter(provider_name="primary", model_name="primary-model")
    fallback = MockProviderAdapter(provider_name="fallback", model_name="fallback-model")
    adapter = build_default_provider_adapter(
        primary_factory=lambda: primary,
        fallback_factory=lambda: fallback,
    )

    assert isinstance(adapter, FallbackProviderAdapter)


def test_provider_client_adapter_populates_token_breakdown_and_cost_estimate() -> None:
    ticks = iter([0.0, 0.012])

    def generate_text_fn(prompt: str) -> str:
        return "模型输出文本长度大约。"

    def config_loader() -> dict[str, str]:
        return {"provider_name": "openai", "model": "gpt-4o-mini"}

    adapter = ProviderClientAdapter(
        generate_text_fn=generate_text_fn,
        config_loader=config_loader,
        timer=lambda: next(ticks),
    )

    response = adapter.generate(
        ProviderRequest(
            capability="llm",
            prompt="一个比较长的提示内容用来产生若干个 token 的估算。",
            model_alias=None,
            metadata={"request_id": "req-cost"},
        )
    )

    assert response.prompt_tokens > 0
    assert response.completion_tokens > 0
    assert response.token_usage == response.prompt_tokens + response.completion_tokens
    assert response.cost_estimate > 0
    assert response.fallback_metadata is None


def test_provider_client_adapter_zero_cost_for_unknown_model() -> None:
    def config_loader() -> dict[str, str]:
        return {"provider_name": "custom-llm", "model": "custom-unknown-model"}

    adapter = ProviderClientAdapter(
        generate_text_fn=lambda prompt: "短",
        config_loader=config_loader,
    )

    response = adapter.generate(
        ProviderRequest(
            capability="llm",
            prompt="短",
            model_alias=None,
            metadata={},
        )
    )

    assert response.cost_estimate == 0.0
    assert response.prompt_tokens >= 1
    assert response.completion_tokens >= 1


def test_provider_response_rejects_negative_breakdown_fields() -> None:
    with pytest.raises(ValueError):
        ProviderResponse(
            provider_name="p",
            model_name="m",
            request_id=None,
            output_text="o",
            latency_ms=0,
            token_usage=0,
            finish_reason="stop",
            prompt_tokens=-1,
        )
    with pytest.raises(ValueError):
        ProviderResponse(
            provider_name="p",
            model_name="m",
            request_id=None,
            output_text="o",
            latency_ms=0,
            token_usage=0,
            finish_reason="stop",
            cost_estimate=-0.1,
        )


def test_provider_adapter_protocol_includes_fallback_attribute() -> None:
    """Static smoke: FallbackProviderAdapter should satisfy ProviderAdapter."""

    adapter: ProviderAdapter = FallbackProviderAdapter(
        primary=MockProviderAdapter(),
        fallback=MockProviderAdapter(),
    )
    assert callable(adapter.generate)
