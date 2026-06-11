from __future__ import annotations

import json
import logging
import os
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from enum import StrEnum
from time import perf_counter
from typing import Protocol
from urllib.error import HTTPError

from storyforge_workflow.provider_client import (
    ChatCompletionResult,
    ChatCompletionUsage,
    _post_chat_completion,
    generate_chat_completion,
    generate_text,
    provider_config,
)

logger = logging.getLogger(__name__)


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


class ProviderErrorKind(StrEnum):
    """provider 失败分类，供 fallback、生命周期和 ModelRun 统一观测。"""

    RATE_LIMIT = "rate_limit"
    CONTEXT_LENGTH_EXCEEDED = "context_length_exceeded"
    CONTENT_FILTER = "content_filter"
    AUTH = "auth"
    SERVER = "server"
    TIMEOUT = "timeout"
    NETWORK = "network"
    UNKNOWN = "unknown"


class ProviderError(RuntimeError):
    """provider 调用失败的统一异常，隐藏底层 HTTP 客户端细节。"""

    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        kind: ProviderErrorKind | str = ProviderErrorKind.UNKNOWN,
        retry_after_seconds: int | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.kind = ProviderErrorKind(kind)
        self.retry_after_seconds = retry_after_seconds


class ProviderTimeoutError(ProviderError):
    """provider 调用超时。"""


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


class FallbackProviderAdapter:
    """先尝试主 provider，遇到可重试错误时降级到备用 provider 并记录原因。"""

    def __init__(
        self,
        *,
        primary: ProviderAdapter,
        fallback: ProviderAdapter,
        on_fallback: Callable[[ProviderError, dict[str, object]], None] | None = None,
    ) -> None:
        self._primary = primary
        self._fallback = fallback
        self._on_fallback = on_fallback or _default_fallback_observer
        self.last_fallback_metadata: dict[str, object] | None = None

    def generate(self, request: ProviderRequest) -> ProviderResponse:
        try:
            response = self._primary.generate(request)
        except ProviderError as primary_error:
            metadata = {
                "primary_provider_error": str(primary_error),
                "primary_provider_status_code": primary_error.status_code,
                "primary_provider_error_kind": primary_error.kind.value,
                "primary_provider_retry_after_seconds": primary_error.retry_after_seconds,
                "request_id": _request_id(request.metadata),
                "capability": request.capability,
            }
            self._on_fallback(primary_error, metadata)
            fallback_response = self._fallback.generate(request)
            self.last_fallback_metadata = metadata
            return _attach_fallback_metadata(fallback_response, metadata)
        self.last_fallback_metadata = None
        return response


def _default_fallback_observer(error: ProviderError, metadata: dict[str, object]) -> None:
    logger.warning(
        "provider_fallback_engaged",
        extra={
            "primary_error": str(error),
            "primary_status_code": metadata.get("primary_provider_status_code"),
            "request_id": metadata.get("request_id"),
            "capability": metadata.get("capability"),
        },
    )
    try:
        import sentry_sdk

        sentry_sdk.add_breadcrumb(
            category="provider.fallback",
            message=str(error),
            level="warning",
            data={k: v for k, v in metadata.items() if v is not None},
        )
        sentry_sdk.capture_message(
            "provider fallback engaged",
            level="warning",
        )
    except Exception:
        pass


def _attach_fallback_metadata(response: ProviderResponse, metadata: dict[str, object]) -> ProviderResponse:
    return ProviderResponse(
        provider_name=response.provider_name,
        model_name=response.model_name,
        request_id=response.request_id,
        output_text=response.output_text,
        latency_ms=response.latency_ms,
        token_usage=response.token_usage,
        finish_reason=response.finish_reason,
        prompt_tokens=response.prompt_tokens,
        completion_tokens=response.completion_tokens,
        cost_estimate=response.cost_estimate,
        fallback_metadata=dict(metadata),
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


def _call_openai_compatible(prompt: str, *, api_key: str, base_url: str, model: str) -> str:
    """fallback provider 默认走 OpenAI 兼容 Chat Completions 端点。"""

    return _call_openai_compatible_completion(
        prompt,
        api_key=api_key,
        base_url=base_url,
        model=model,
    ).content


def _call_openai_compatible_completion(
    prompt: str,
    *,
    api_key: str,
    base_url: str,
    model: str,
) -> ChatCompletionResult:
    """fallback provider 默认走 OpenAI 兼容 Chat Completions 端点并保留 usage。"""

    if not api_key:
        raise ProviderError("缺少 fallback provider 的 API key。")
    body = json.dumps(
        {
            "model": model,
            "messages": [
                {"role": "system", "content": "你是 StoryForge 的中文长篇创作助手。"},
                {"role": "user", "content": prompt},
            ],
            "temperature": float(os.getenv("STORYFORGE_LLM_FALLBACK_TEMPERATURE", "0.7")),
        },
        ensure_ascii=False,
    ).encode("utf-8")
    timeout = float(os.getenv("STORYFORGE_LLM_FALLBACK_TIMEOUT_SECONDS", "30"))
    try:
        data = _post_chat_completion(
            config={
                "api_key": api_key,
                "base_url": base_url,
                "model": model,
                "provider_name": "fallback",
            },
            body=body,
            timeout=timeout,
        )
    except HTTPError as exc:
        body = _read_http_error_body(exc)
        raise ProviderError(
            _http_error_message(exc.code, body),
            status_code=exc.code,
            kind=_classify_http_error(exc.code, body),
            retry_after_seconds=_parse_retry_after(exc),
        ) from exc
    except TimeoutError as exc:
        raise ProviderTimeoutError("fallback provider 调用超时。", kind=ProviderErrorKind.TIMEOUT) from exc
    except (ConnectionError, OSError) as exc:
        raise ProviderError(f"fallback provider 网络调用失败：{exc}", kind=ProviderErrorKind.NETWORK) from exc
    except Exception as exc:
        raise ProviderError(f"fallback provider 调用失败：{exc}") from exc
    return _extract_fallback_chat_result(data)


def _extract_fallback_chat_content(data: object) -> str:
    return _extract_fallback_chat_result(data).content


def _extract_fallback_chat_result(data: object) -> ChatCompletionResult:
    if not isinstance(data, dict):
        raise _malformed_fallback_response()
    choices = data.get("choices")
    if not isinstance(choices, list) or not choices:
        raise _malformed_fallback_response()
    first_choice = choices[0]
    if not isinstance(first_choice, dict):
        raise _malformed_fallback_response()
    message = first_choice.get("message")
    if not isinstance(message, dict):
        raise _malformed_fallback_response()
    content = message.get("content")
    if not isinstance(content, str) or not content.strip():
        raise _malformed_fallback_response()
    usage = _chat_completion_usage_from_payload(data.get("usage"))
    request_id = data.get("id")
    model = data.get("model")
    finish_reason = first_choice.get("finish_reason")
    return ChatCompletionResult(
        content=content.strip(),
        usage=usage,
        finish_reason=finish_reason if isinstance(finish_reason, str) and finish_reason else None,
        request_id=request_id if isinstance(request_id, str) and request_id else None,
        model=model if isinstance(model, str) and model else None,
    )


def _malformed_fallback_response() -> ProviderError:
    return ProviderError("fallback provider 响应格式无效：缺少非空 choices[0].message.content。")


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
    return max(1, len(text) // 4)


# 粗粒度成本估算（USD per 1K token），仅用于内部观测，不参与计费。
_COST_PER_1K_TOKENS = {
    "gpt-4o-mini": (0.00015, 0.0006),
    "gpt-4o": (0.005, 0.015),
    "gpt-4.1-mini": (0.00015, 0.0006),
    "gpt-4.1": (0.005, 0.015),
    "deepseek-chat": (0.00014, 0.00028),
}


def _estimate_cost(model_name: str, prompt_tokens: int, completion_tokens: int) -> float:
    rates = _COST_PER_1K_TOKENS.get(model_name.lower())
    if rates is None:
        return 0.0
    prompt_rate, completion_rate = rates
    cost = (prompt_tokens / 1000) * prompt_rate + (completion_tokens / 1000) * completion_rate
    return round(cost, 6)


def _resolve_usage(
    *,
    usage: ChatCompletionUsage | None,
    prompt: str,
    output_text: str,
) -> tuple[int, int, int]:
    if usage is None:
        prompt_tokens = _estimate_token_count(prompt)
        completion_tokens = _estimate_token_count(output_text)
        return prompt_tokens, completion_tokens, max(1, prompt_tokens + completion_tokens)
    prompt_tokens = max(0, usage.prompt_tokens)
    completion_tokens = max(0, usage.completion_tokens)
    total_tokens = max(0, usage.total_tokens)
    if total_tokens == 0:
        total_tokens = prompt_tokens + completion_tokens
    return prompt_tokens, completion_tokens, total_tokens


def _chat_completion_usage_from_payload(value: object) -> ChatCompletionUsage | None:
    if not isinstance(value, dict):
        return None
    prompt_tokens = _optional_nonnegative_int(value.get("prompt_tokens"))
    completion_tokens = _optional_nonnegative_int(value.get("completion_tokens"))
    total_tokens = _optional_nonnegative_int(value.get("total_tokens"))
    if prompt_tokens is None and completion_tokens is None and total_tokens is None:
        return None
    resolved_prompt = prompt_tokens or 0
    resolved_completion = completion_tokens or 0
    resolved_total = total_tokens if total_tokens is not None else resolved_prompt + resolved_completion
    return ChatCompletionUsage(
        prompt_tokens=resolved_prompt,
        completion_tokens=resolved_completion,
        total_tokens=resolved_total,
    )


def _optional_nonnegative_int(value: object) -> int | None:
    if type(value) is int and value >= 0:
        return value
    return None


def _http_error_message(status_code: int, body: str = "") -> str:
    if status_code == 429:
        return "provider 返回 HTTP 429，触发限流。"
    return f"provider 返回 HTTP {status_code}。"


def _classify_http_error(status_code: int, body: str) -> ProviderErrorKind:
    normalized = body.lower()
    if status_code == 429:
        return ProviderErrorKind.RATE_LIMIT
    if status_code in {401, 403} and _looks_like_auth_error(normalized):
        return ProviderErrorKind.AUTH
    if status_code in {401, 403}:
        return ProviderErrorKind.AUTH
    if status_code == 413 or _looks_like_context_error(normalized):
        return ProviderErrorKind.CONTEXT_LENGTH_EXCEEDED
    if _looks_like_content_filter(normalized):
        return ProviderErrorKind.CONTENT_FILTER
    if 500 <= status_code <= 599:
        return ProviderErrorKind.SERVER
    return ProviderErrorKind.UNKNOWN


def _looks_like_auth_error(normalized_body: str) -> bool:
    return any(keyword in normalized_body for keyword in ("auth", "api key", "apikey", "unauthorized", "forbidden"))


def _looks_like_context_error(normalized_body: str) -> bool:
    return any(
        keyword in normalized_body
        for keyword in ("context length", "maximum context", "token limit", "too many tokens")
    )


def _looks_like_content_filter(normalized_body: str) -> bool:
    return any(keyword in normalized_body for keyword in ("content filter", "safety", "policy violation"))


def _parse_retry_after(error: HTTPError) -> int | None:
    raw_value = error.headers.get("Retry-After") if error.headers is not None else None
    if not raw_value:
        return None
    stripped = raw_value.strip()
    if stripped.isdigit():
        return int(stripped)
    try:
        retry_at = parsedate_to_datetime(stripped)
    except (TypeError, ValueError):
        return None
    if retry_at.tzinfo is None:
        retry_at = retry_at.replace(tzinfo=UTC)
    seconds = int((retry_at - datetime.now(UTC)).total_seconds())
    return max(0, seconds)


def _read_http_error_body(error: HTTPError) -> str:
    fp = getattr(error, "fp", None)
    if fp is None:
        return ""
    try:
        payload = fp.read()
    except Exception:
        return ""
    if isinstance(payload, bytes):
        return payload.decode("utf-8", errors="replace")
    return str(payload)


def _field_difference(field: str, reference: ProviderResponse, candidate: ProviderResponse) -> str | None:
    if not hasattr(reference, field) or not hasattr(candidate, field):
        raise ValueError(f"未知 provider parity 字段：{field}")
    reference_value = getattr(reference, field)
    candidate_value = getattr(candidate, field)
    if reference_value == candidate_value:
        return None
    return f"{field}: {reference_value} != {candidate_value}"
