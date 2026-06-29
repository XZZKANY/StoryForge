from __future__ import annotations

import json
import logging
import os
from collections.abc import Callable
from dataclasses import replace
from typing import TYPE_CHECKING
from urllib.error import HTTPError

from storyforge_workflow.provider_client import ChatCompletionResult, _post_chat_completion
from storyforge_workflow.runtime.provider_errors import (
    ProviderError,
    ProviderErrorKind,
    ProviderTimeoutError,
    _classify_http_error,
    _http_error_message,
    _parse_retry_after,
    _read_http_error_body,
)
from storyforge_workflow.runtime.provider_usage import _chat_completion_usage_from_payload

if TYPE_CHECKING:
    from storyforge_workflow.runtime.provider_adapter import ProviderAdapter, ProviderRequest, ProviderResponse


logger = logging.getLogger("storyforge_workflow.runtime.provider_adapter")


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
    return replace(response, fallback_metadata=dict(metadata))


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


def _request_id(metadata: dict[str, object]) -> str | None:
    value = metadata.get("request_id")
    return value if isinstance(value, str) and value else None
