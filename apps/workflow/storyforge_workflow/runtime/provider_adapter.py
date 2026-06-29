from __future__ import annotations

import os
from collections.abc import Callable
from dataclasses import dataclass, field
from time import perf_counter
from typing import Protocol
from urllib.error import HTTPError

from storyforge_workflow.provider_client import (
    ChatCompletionResult,
    generate_chat_completion,
    generate_text,
    provider_config,
)
from storyforge_workflow.runtime.provider_errors import (
    ProviderError,
    ProviderErrorKind,
    ProviderTimeoutError,
    _classify_http_error,
    _http_error_message,
    _parse_retry_after,
    _read_http_error_body,
)
from storyforge_workflow.runtime.provider_fallback import (
    FallbackProviderAdapter,
    _call_openai_compatible,
    _call_openai_compatible_completion,
)
from storyforge_workflow.runtime.provider_fallback import (
    _attach_fallback_metadata as _attach_fallback_metadata,
)
from storyforge_workflow.runtime.provider_fallback import (
    _default_fallback_observer as _default_fallback_observer,
)
from storyforge_workflow.runtime.provider_fallback import (
    _extract_fallback_chat_content as _extract_fallback_chat_content,
)
from storyforge_workflow.runtime.provider_fallback import (
    _extract_fallback_chat_result as _extract_fallback_chat_result,
)
from storyforge_workflow.runtime.provider_fallback import (
    _malformed_fallback_response as _malformed_fallback_response,
)
from storyforge_workflow.runtime.provider_usage import (
    COST_PER_1K_TOKENS,
    _resolve_usage,
)
from storyforge_workflow.runtime.provider_usage import (
    _estimate_cost as _estimate_cost_impl,
)
from storyforge_workflow.runtime.provider_usage import (
    _estimate_token_count as _estimate_token_count_impl,
)


@dataclass(frozen=True)
class ProviderRequest:
    """workflow runtime 传给 provider 的统一请求快照。"""

    capability: str
    prompt: str
    model_alias: str | None
    metadata: dict[str, object]

    def __post_init__(self) -> None:
        object.__setattr__(self, "metadata", dict(self.metadata))


@dataclass(frozen=True)
class ProviderResponse:
    """provider 返回给 workflow runtime 的统一响应快照。"""

    provider_name: str
    model_name: str
    request_id: str | None
    output_text: str
    latency_ms: int
    token_usage: int
    finish_reason: str | None
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost_estimate: float = 0.0
    fallback_metadata: dict[str, object] | None = field(default=None)

    def __post_init__(self) -> None:
        if self.latency_ms < 0:
            raise ValueError("provider latency_ms 不能为负数。")
        if self.token_usage < 0:
            raise ValueError("provider token_usage 不能为负数。")
        if self.prompt_tokens < 0 or self.completion_tokens < 0:
            raise ValueError("provider prompt/completion tokens 不能为负数。")
        if self.cost_estimate < 0:
            raise ValueError("provider cost_estimate 不能为负数。")


class ProviderAdapter(Protocol):
    """统一 provider 调用边界，真实实现和 Mock 实现共享此协议。"""

    def generate(self, request: ProviderRequest) -> ProviderResponse:
        """根据统一请求生成统一响应。"""


class ProviderClientAdapter:
    """把现有 provider client 包装为 workflow runtime adapter。"""

    def __init__(
        self,
        *,
        generate_text_fn: Callable[[str], str] = generate_text,
        generate_chat_completion_fn: Callable[[str], ChatCompletionResult] | None = None,
        config_loader: Callable[[], dict[str, str]] = provider_config,
        timer: Callable[[], float] = perf_counter,
    ) -> None:
        self._generate_text = generate_text_fn
        self._generate_chat_completion = generate_chat_completion_fn
        self._config_loader = config_loader
        self._timer = timer

    def generate(self, request: ProviderRequest) -> ProviderResponse:
        """调用真实 provider client，并把结果归一化为 ProviderResponse。"""

        config = self._config_loader()
        started_at = self._timer()
        try:
            result = self._generate_completion_result(request.prompt)
        except ProviderError:
            raise
        except TimeoutError as exc:
            raise ProviderTimeoutError("provider 调用超时。", kind=ProviderErrorKind.TIMEOUT) from exc
        except HTTPError as exc:
            body = _read_http_error_body(exc)
            raise ProviderError(
                _http_error_message(exc.code, body),
                status_code=exc.code,
                kind=_classify_http_error(exc.code, body),
                retry_after_seconds=_parse_retry_after(exc),
            ) from exc
        except (ConnectionError, OSError) as exc:
            raise ProviderError(f"provider 网络调用失败：{exc}", kind=ProviderErrorKind.NETWORK) from exc
        except Exception as exc:
            raise ProviderError(f"provider 调用失败：{exc}", kind=ProviderErrorKind.UNKNOWN) from exc
        latency_ms = int((self._timer() - started_at) * 1000)
        output_text = result.content
        prompt_tokens, completion_tokens, token_usage = _resolve_usage(
            usage=result.usage,
            prompt=request.prompt,
            output_text=output_text,
        )
        resolved_model_name = result.model or config["model"]
        cost_estimate = _estimate_cost(resolved_model_name, prompt_tokens, completion_tokens)
        return ProviderResponse(
            provider_name=config["provider_name"],
            model_name=resolved_model_name,
            request_id=result.request_id or _request_id(request.metadata),
            output_text=output_text,
            latency_ms=max(0, latency_ms),
            token_usage=token_usage,
            finish_reason=result.finish_reason or "stop",
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            cost_estimate=cost_estimate,
        )

    def _generate_completion_result(self, prompt: str) -> ChatCompletionResult:
        if self._generate_chat_completion is not None:
            return self._generate_chat_completion(prompt)
        output_text = self._generate_text(prompt)
        return ChatCompletionResult(
            content=output_text,
            usage=None,
            finish_reason="stop",
            request_id=None,
            model=None,
        )


class MockProviderAdapter:
    """确定性 Mock Provider，用于本地验收和 parity harness。"""

    def __init__(
        self,
        *,
        provider_name: str = "mock-provider",
        model_name: str = "mock-model",
        latency_ms: int = 0,
        token_usage: int = 1,
        finish_reason: str | None = "stop",
        response_factory: Callable[[ProviderRequest], str] | None = None,
    ) -> None:
        if latency_ms < 0:
            raise ValueError("Mock Provider latency_ms 不能为负数。")
        if token_usage < 0:
            raise ValueError("Mock Provider token_usage 不能为负数。")
        self.provider_name = provider_name
        self.model_name = model_name
        self.latency_ms = latency_ms
        self.token_usage = token_usage
        self.finish_reason = finish_reason
        self._response_factory = response_factory or _default_mock_response

    def generate(self, request: ProviderRequest) -> ProviderResponse:
        output_text = self._response_factory(request)
        return ProviderResponse(
            provider_name=self.provider_name,
            model_name=self.model_name,
            request_id=_request_id(request.metadata),
            output_text=output_text,
            latency_ms=self.latency_ms,
            token_usage=self.token_usage,
            finish_reason=self.finish_reason,
        )


def build_default_provider_adapter(
    *,
    primary_factory: Callable[[], ProviderAdapter] | None = None,
    fallback_factory: Callable[[], ProviderAdapter] | None = None,
) -> ProviderAdapter:
    """按环境变量装配生产 provider；配置了 fallback 时返回 FallbackProviderAdapter。"""

    primary = (primary_factory or _default_primary_factory)()
    fallback_provider = (os.getenv("STORYFORGE_LLM_FALLBACK_PROVIDER") or "").strip()
    fallback_model = (os.getenv("STORYFORGE_LLM_FALLBACK_MODEL") or "").strip()
    if not fallback_provider or not fallback_model:
        return primary
    fallback = (fallback_factory or _default_fallback_factory)()
    return FallbackProviderAdapter(primary=primary, fallback=fallback)


def _default_primary_factory() -> ProviderAdapter:
    return ProviderClientAdapter(
        generate_text_fn=generate_text,
        generate_chat_completion_fn=generate_chat_completion,
        config_loader=provider_config,
    )


def _default_fallback_factory() -> ProviderAdapter:
    fallback_provider = (os.getenv("STORYFORGE_LLM_FALLBACK_PROVIDER") or "").strip()
    fallback_model = (os.getenv("STORYFORGE_LLM_FALLBACK_MODEL") or "").strip()
    fallback_api_key = (
        os.getenv("STORYFORGE_LLM_FALLBACK_API_KEY") or os.getenv("STORYFORGE_LLM_API_KEY") or ""
    ).strip()
    fallback_base_url = (
        os.getenv("STORYFORGE_LLM_FALLBACK_BASE_URL")
        or os.getenv("STORYFORGE_LLM_BASE_URL")
        or "https://api.openai.com/v1"
    ).strip()

    def config_loader() -> dict[str, str]:
        return {
            "api_key": fallback_api_key,
            "base_url": fallback_base_url,
            "model": fallback_model,
            "provider_name": fallback_provider,
        }

    return ProviderClientAdapter(
        generate_text_fn=lambda prompt: _call_openai_compatible(
            prompt,
            api_key=fallback_api_key,
            base_url=fallback_base_url,
            model=fallback_model,
        ),
        generate_chat_completion_fn=lambda prompt: _call_openai_compatible_completion(
            prompt,
            api_key=fallback_api_key,
            base_url=fallback_base_url,
            model=fallback_model,
        ),
        config_loader=config_loader,
    )


@dataclass(frozen=True)
class ProviderParityCase:
    """单条 provider parity 验收用例。"""

    name: str
    request: ProviderRequest


@dataclass(frozen=True)
class ProviderParityResult:
    """记录候选 provider 与参考 provider 的字段级比较结果。"""

    case_name: str
    passed: bool
    differences: tuple[str, ...]
    reference: ProviderResponse
    candidate: ProviderResponse


class ProviderParityHarness:
    """用同一请求比较参考 provider 与候选 provider 的验收工具。"""

    _DEFAULT_COMPARED_FIELDS = ("provider_name", "model_name", "output_text", "finish_reason")

    def __init__(
        self,
        *,
        reference_adapter: ProviderAdapter,
        candidate_adapter: ProviderAdapter,
        compared_fields: tuple[str, ...] | None = None,
    ) -> None:
        fields = compared_fields or self._DEFAULT_COMPARED_FIELDS
        if not fields:
            raise ValueError("provider parity 至少需要比较一个字段。")
        self.reference_adapter = reference_adapter
        self.candidate_adapter = candidate_adapter
        self.compared_fields = fields

    def run_case(self, case: ProviderParityCase) -> ProviderParityResult:
        reference = self.reference_adapter.generate(case.request)
        candidate = self.candidate_adapter.generate(case.request)
        differences = tuple(_field_difference(field, reference, candidate) for field in self.compared_fields)
        differences = tuple(difference for difference in differences if difference is not None)
        return ProviderParityResult(
            case_name=case.name,
            passed=not differences,
            differences=differences,
            reference=reference,
            candidate=candidate,
        )

    def assert_case(self, case: ProviderParityCase) -> ProviderParityResult:
        result = self.run_case(case)
        if not result.passed:
            details = "；".join(result.differences)
            raise AssertionError(f"provider parity 失败：{case.name}：{details}")
        return result


def _default_mock_response(request: ProviderRequest) -> str:
    return f"Mock Provider 响应：{request.prompt}"


def _request_id(metadata: dict[str, object]) -> str | None:
    value = metadata.get("request_id")
    return value if isinstance(value, str) and value else None


def _estimate_token_count(text: str) -> int:
    return _estimate_token_count_impl(text)


_COST_PER_1K_TOKENS = COST_PER_1K_TOKENS


def _estimate_cost(model_name: str, prompt_tokens: int, completion_tokens: int) -> float:
    return _estimate_cost_impl(model_name, prompt_tokens, completion_tokens)


def _field_difference(field: str, reference: ProviderResponse, candidate: ProviderResponse) -> str | None:
    if not hasattr(reference, field) or not hasattr(candidate, field):
        raise ValueError(f"未知 provider parity 字段：{field}")
    reference_value = getattr(reference, field)
    candidate_value = getattr(candidate, field)
    if reference_value == candidate_value:
        return None
    return f"{field}: {reference_value} != {candidate_value}"
