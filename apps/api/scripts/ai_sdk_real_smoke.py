from __future__ import annotations

import http.client
import json
import os
import time
from collections.abc import Iterable, Iterator, Mapping
from urllib.parse import quote, urlsplit

from app.platform.ai_sdk import (
    ChatMessage,
    ChatRequest,
    MessageRole,
    ProviderError,
    ProviderErrorCategory,
    ProviderErrorDetails,
    StreamEventKind,
    ToolSpec,
)
from app.platform.ai_sdk.provider import LLMProvider
from app.platform.ai_sdk.providers import AnthropicProvider, GeminiProvider, OpenAICompatibleProvider


def _required(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise ProviderError(
            ProviderErrorDetails(
                ProviderErrorCategory.CONFIGURATION,
                f"Real AI SDK smoke requires {name}.",
                provider_code="missing_smoke_configuration",
            )
        )
    return value


def _url(base_url: str, suffix: str) -> str:
    return f"{base_url.rstrip('/')}/{suffix.lstrip('/')}"


def _connection(url: str) -> tuple[http.client.HTTPConnection, str]:
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ProviderError(
            ProviderErrorDetails(
                ProviderErrorCategory.CONFIGURATION,
                "Real AI SDK smoke base URL must be an absolute HTTP(S) URL.",
                provider_code="invalid_smoke_url",
            )
        )
    connection_type = http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection
    connection = connection_type(parsed.hostname, parsed.port, timeout=120)
    path = parsed.path or "/"
    if parsed.query:
        path = f"{path}?{parsed.query}"
    return connection, path


def _request(url: str, headers: Mapping[str, str], payload: Mapping[str, object]) -> http.client.HTTPResponse:
    connection, path = _connection(url)
    try:
        connection.request(
            "POST",
            path,
            body=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={"Content-Type": "application/json", **headers},
        )
        response = connection.getresponse()
    except (OSError, TimeoutError, http.client.HTTPException) as exc:
        connection.close()
        raise ProviderError(
            ProviderErrorDetails(
                ProviderErrorCategory.CONNECTION,
                f"Real AI SDK smoke connection failed ({type(exc).__name__}).",
                retryable=True,
            )
        ) from exc
    if 200 <= response.status < 300:
        return response
    status = response.status
    response.read()
    connection.close()
    category = {
        400: ProviderErrorCategory.INVALID_REQUEST,
        401: ProviderErrorCategory.AUTHENTICATION,
        403: ProviderErrorCategory.AUTHENTICATION,
        429: ProviderErrorCategory.RATE_LIMIT,
    }.get(status, ProviderErrorCategory.CONNECTION if status >= 500 else ProviderErrorCategory.RESPONSE)
    raise ProviderError(
        ProviderErrorDetails(
            category,
            f"Real AI SDK smoke received HTTP {status}.",
            retryable=category in {ProviderErrorCategory.RATE_LIMIT, ProviderErrorCategory.CONNECTION},
            status_code=status,
        )
    )


def _post_json(url: str, headers: Mapping[str, str], payload: Mapping[str, object]) -> dict[str, object]:
    response = _request(url, headers, payload)
    try:
        try:
            data = json.loads(response.read().decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ProviderError(
                ProviderErrorDetails(
                    ProviderErrorCategory.RESPONSE,
                    "Real AI SDK smoke received malformed JSON.",
                    provider_code="malformed_json",
                )
            ) from exc
    finally:
        response.close()
    if not isinstance(data, dict):
        raise ProviderError(
            ProviderErrorDetails(ProviderErrorCategory.RESPONSE, "Real AI SDK smoke received non-object JSON.")
        )
    return data


def _sse_json(url: str, headers: Mapping[str, str], payload: Mapping[str, object]) -> Iterator[dict[str, object]]:
    response = _request(url, headers, payload)
    try:
        while raw_line := response.readline():
            line = raw_line.decode("utf-8", errors="replace").strip()
            if not line.startswith("data:"):
                continue
            data_text = line[5:].strip()
            if not data_text or data_text == "[DONE]":
                continue
            try:
                data = json.loads(data_text)
            except json.JSONDecodeError as exc:
                raise ProviderError(
                    ProviderErrorDetails(
                        ProviderErrorCategory.RESPONSE,
                        "Real AI SDK smoke received a malformed SSE event.",
                        provider_code="malformed_sse_event",
                    )
                ) from exc
            if isinstance(data, dict):
                yield data
    finally:
        response.close()


def _openai_provider(base_url: str, key: str) -> OpenAICompatibleProvider:
    url = _url(base_url, "chat/completions")
    headers = {"Authorization": f"Bearer {key}"}

    def complete(payload: dict[str, object]):
        started_at = time.monotonic()
        return _post_json(url, headers, payload), started_at

    def stream(payload: dict[str, object]) -> Iterable[Mapping[str, object]]:
        content: list[str] = []
        usage: dict[str, object] = {}
        finish_reason: str | None = None
        for chunk in _sse_json(url, headers, payload):
            if isinstance(chunk.get("usage"), dict):
                usage = chunk["usage"]
            choices = chunk.get("choices")
            if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
                continue
            choice = choices[0]
            delta = choice.get("delta")
            text = delta.get("content") if isinstance(delta, dict) else None
            if isinstance(text, str) and text:
                content.append(text)
                yield {"type": "delta", "text": text}
            if choice.get("finish_reason") is not None:
                finish_reason = str(choice["finish_reason"])
        yield {
            "type": "done",
            "content": "".join(content),
            "prompt_tokens": int(usage.get("prompt_tokens") or 0),
            "completion_tokens": int(usage.get("completion_tokens") or 0),
            "token_usage": int(usage.get("total_tokens") or 0),
            "token_usage_source": "provider_usage" if usage else "unavailable",
            "finish_reason": finish_reason,
        }

    return OpenAICompatibleProvider(complete_transport=complete, stream_transport=stream)


def _anthropic_provider(base_url: str, key: str) -> AnthropicProvider:
    url = _url(base_url, "messages")
    headers = {"x-api-key": key, "anthropic-version": "2023-06-01"}

    def complete(payload: dict[str, object]):
        started_at = time.monotonic()
        return _post_json(url, headers, payload), started_at

    return AnthropicProvider(
        complete_transport=complete,
        stream_transport=lambda payload: _sse_json(url, headers, payload),
    )


def _gemini_provider(base_url: str, key: str, model: str) -> GeminiProvider:
    model_path = quote(model, safe="-._")
    complete_url = _url(base_url, f"models/{model_path}:generateContent")
    stream_url = _url(base_url, f"models/{model_path}:streamGenerateContent?alt=sse")
    headers = {"x-goog-api-key": key}

    def complete(request_model: str, payload: dict[str, object]):
        del request_model
        started_at = time.monotonic()
        return _post_json(complete_url, headers, payload), started_at

    def stream(request_model: str, payload: dict[str, object]):
        del request_model
        return _sse_json(stream_url, headers, payload)

    return GeminiProvider(complete_transport=complete, stream_transport=stream)


def _provider() -> tuple[str, str, LLMProvider]:
    name = _required("STORYFORGE_AI_SDK_SMOKE_PROVIDER").lower()
    model = _required("STORYFORGE_AI_SDK_SMOKE_MODEL")
    base_url = _required("STORYFORGE_AI_SDK_SMOKE_BASE_URL")
    key = _required("STORYFORGE_AI_SDK_SMOKE_API_KEY")
    if name == "openai-compatible":
        return name, model, _openai_provider(base_url, key)
    if name == "anthropic":
        return name, model, _anthropic_provider(base_url, key)
    if name == "gemini":
        return name, model, _gemini_provider(base_url, key, model)
    raise ProviderError(
        ProviderErrorDetails(
            ProviderErrorCategory.CONFIGURATION,
            "Real AI SDK smoke provider must be openai-compatible, anthropic, or gemini.",
            provider_code="unsupported_smoke_provider",
        )
    )


def _run() -> dict[str, object]:
    provider_name, model, provider = _provider()
    message = ChatMessage(MessageRole.USER, "Reply with the single word OK.")
    complete = provider.complete(ChatRequest(model=model, messages=(message,), max_tokens=64))
    stream_events = list(provider.stream(ChatRequest(model=model, messages=(message,), max_tokens=64)))
    tool = ToolSpec(
        "smoke_echo",
        "Return the supplied value.",
        {"type": "object", "properties": {"value": {"type": "string"}}, "required": ["value"]},
    )
    tool_response = provider.complete(
        ChatRequest(
            model=model,
            messages=(ChatMessage(MessageRole.USER, "Call smoke_echo with value OK."),),
            tools=(tool,),
            tool_choice="required",
            max_tokens=128,
        )
    )
    if not complete.content:
        raise ProviderError(
            ProviderErrorDetails(ProviderErrorCategory.RESPONSE, "Real AI SDK complete smoke returned no text.")
        )
    if not any(event.kind is StreamEventKind.COMPLETED for event in stream_events):
        raise ProviderError(
            ProviderErrorDetails(ProviderErrorCategory.RESPONSE, "Real AI SDK stream smoke did not complete.")
        )
    if not tool_response.tool_calls:
        raise ProviderError(
            ProviderErrorDetails(ProviderErrorCategory.RESPONSE, "Real AI SDK tool smoke returned no tool call.")
        )
    return {
        "provider": provider_name,
        "complete": True,
        "stream_events": len(stream_events),
        "tool_calls": len(tool_response.tool_calls),
        "usage_tokens": complete.usage.total_tokens,
    }


def main() -> int:
    if os.getenv("STORYFORGE_AI_SDK_REAL_SMOKE", "").strip() != "1":
        print(json.dumps({"status": "skipped", "reason": "explicit opt-in required"}))
        return 0
    try:
        result = _run()
    except ProviderError as exc:
        print(
            json.dumps(
                {
                    "status": "failed",
                    "category": exc.details.category.value,
                    "code": exc.details.provider_code,
                    "message": exc.details.safe_message,
                }
            )
        )
        return 1
    print(json.dumps({"status": "passed", **result}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
