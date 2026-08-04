"""StoryForge 唯一的 LLM chat/completions 出网通道（W3，蓝图 §7 F16）。

自 `book_runs/book_generation_llm.py` 原样下沉（移动不重写）：带重试的 urllib
POST、429/5xx 退避 + Retry-After、双鉴权（bearer / api-key）、token 记账与成本估算、
思维链剥离。此前主产品循环寄生在已降级 book_runs 域的私有函数上，judge/story_state
则各自裸 httpx 无重试——本模块把 chat 出网收敛到一处，errors 由本模块定义，
`common` 不再反向依赖任何 domain。

密钥红线：凭据只进请求头，不入 URL query、不进日志、不进异常消息；异常仅携带服务端
响应体（≤2000 字符，不含本端凭据）与连接原因。`redact_secrets` 供上层日志兜底脱敏。
"""

from __future__ import annotations

import http.client
import json
import logging
import time
from collections.abc import Iterable, Iterator, Mapping
from dataclasses import replace
from random import random
from urllib import error, request

from app.common import llm_http
from app.common.exceptions import DomainError
from app.common.redaction import redact_sensitive_text
from app.platform.ai_sdk.capabilities import ProviderCapabilities
from app.platform.ai_sdk.contracts import (
    ChatRequest,
    ChatResponse,
    StreamEvent,
    StreamEventKind,
    messages_from_openai,
    tools_from_openai,
)
from app.platform.ai_sdk.errors import ProviderError
from app.platform.ai_sdk.provider import LLMProvider, ProviderHealth
from app.platform.ai_sdk.providers.openai_compatible import OpenAICompatibleProvider

logger = logging.getLogger(__name__)

THINK_BLOCK_RE = llm_http.THINK_BLOCK_RE
THINK_OPEN_RE = llm_http.THINK_OPEN_RE
THINK_CLOSE_RE = llm_http.THINK_CLOSE_RE
_strip_reasoning_leak = llm_http.strip_reasoning_leak
_env_value = llm_http.env_value
_optional_int = llm_http.optional_int
_optional_float = llm_http.optional_float

# 连接成功后、读取/解码/解析响应体阶段的瞬时故障：网关 200 却回非 JSON（代理错误页）、
# 读到一半连接被重置、截断读、非 UTF-8 正文。这些既非 HTTPError 也非 URLError，旧代码
# 会让裸异常逃逸出重试与 LLMError 包装 → 上层 loop 只 catch LLMError，整个 agent run 被判失败。
_RESPONSE_READ_ERRORS = (
    http.client.IncompleteRead,
    ConnectionError,
    json.JSONDecodeError,
    UnicodeDecodeError,
)
# 上游给出超长 Retry-After（抖动/限流误配）时不让同步 worker 空转数小时。
_RETRY_DELAY_CEILING_SECONDS = 60.0


class LLMConfigError(DomainError, RuntimeError):
    """真实 LLM 调用缺少私有运行配置（缺 key / base_url / model 等）。"""

    status_code = 422


class LLMError(DomainError, RuntimeError):
    """真实 LLM 调用运行失败（HTTP 错误、超时、响应格式异常）。"""

    status_code = 502


def redact_secrets(text: str, secrets: Iterable[str | None]) -> str:
    """把给定密钥子串从任意文本中替换为 ***，供日志/证据兜底脱敏。"""

    redacted = text
    for secret in secrets:
        if secret and len(secret) >= 6:
            redacted = redacted.replace(secret, "***")
    return redact_sensitive_text(redacted, extra_secrets=secrets)


def _credential_header_values(headers: Mapping[str, str]) -> list[str]:
    secrets: list[str] = []
    for name, value in headers.items():
        if name.lower() not in ("authorization", "api-key"):
            continue
        secrets.append(value)
        if value.lower().startswith("bearer "):
            secrets.append(value[7:])
    return secrets


def post_json_with_retry(
    url: str,
    payload: dict[str, object],
    headers: dict[str, str],
    *,
    timeout_seconds: float,
    max_attempts: int = 3,
    service_label: str,
) -> dict[str, object]:
    """向非 chat JSON 端点 POST，复用 common 重试、退避、脱敏与 LLMError 语义。"""

    # 对齐 httpx(json=...) 的线格式，迁移 transport 不改变 retrieval 请求体字节。
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    http_request = request.Request(url, data=body, headers=headers, method="POST")
    attempt_limit = max(1, max_attempts)
    started_at = time.monotonic()
    secrets = _credential_header_values(headers)
    data: dict[str, object] | None = None

    for attempt in range(1, attempt_limit + 1):
        try:
            with request.urlopen(http_request, timeout=timeout_seconds) as response:
                data = json.loads(response.read().decode("utf-8"))
            break
        except error.HTTPError as exc:
            elapsed_ms = int((time.monotonic() - started_at) * 1000)
            if _is_retryable_status(exc.code) and attempt < attempt_limit:
                _sleep_before_retry(
                    attempt=attempt,
                    base_delay=0.5,
                    jitter=0.25,
                    retry_after=_retry_after_seconds(exc),
                )
                continue
            try:
                error_body = exc.read().decode("utf-8", errors="replace")[:2000]
            except Exception:  # noqa: BLE001 - 诊断失败不能掩盖原始 HTTP 错误
                error_body = "<无法读取响应体>"
            message = redact_secrets(
                f"{service_label}返回 HTTP {exc.code}（耗时 {elapsed_ms}ms，尝试 {attempt}/{attempt_limit}）：{error_body}",
                secrets,
            )
            logger.warning("%s", message)
            raise LLMError(message) from exc
        except (error.URLError, TimeoutError) as exc:
            elapsed_ms = int((time.monotonic() - started_at) * 1000)
            if attempt < attempt_limit:
                _sleep_before_retry(
                    attempt=attempt,
                    base_delay=0.5,
                    jitter=0.25,
                    retry_after=None,
                )
                continue
            reason = getattr(exc, "reason", exc)
            message = redact_secrets(
                f"{service_label}调用超时或连接失败（耗时 {elapsed_ms}ms，timeout={timeout_seconds}s，"
                f"尝试 {attempt}/{attempt_limit}）：{reason}",
                secrets,
            )
            logger.warning("%s", message)
            raise LLMError(message) from exc
        except _RESPONSE_READ_ERRORS as exc:
            elapsed_ms = int((time.monotonic() - started_at) * 1000)
            if attempt < attempt_limit:
                _sleep_before_retry(
                    attempt=attempt,
                    base_delay=0.5,
                    jitter=0.25,
                    retry_after=None,
                )
                continue
            message = redact_secrets(
                f"{service_label}响应读取或解析失败（耗时 {elapsed_ms}ms，尝试 {attempt}/{attempt_limit}）："
                f"{type(exc).__name__}",
                secrets,
            )
            logger.warning("%s", message)
            raise LLMError(message) from exc

    if data is None:
        raise LLMError(f"{service_label}重试后仍无响应数据。")
    return data


def _build_chat_payload(
    source: Mapping[str, str | None],
    *,
    messages: list[dict[str, object]],
    tools: list[dict[str, object]] | None,
    tool_choice: str | dict[str, object] | None,
    stream: bool = False,
    temperature: float | None = None,
    max_completion_tokens: int | None = None,
) -> dict[str, object]:
    """组 chat/completions 请求体；三个 per-call 覆盖不传时输出与既有调用方逐字节一致。"""

    payload: dict[str, object] = {
        "model": _required_env(source, "STORYFORGE_LLM_MODEL"),
        "messages": messages,
        "temperature": (
            temperature
            if temperature is not None
            else _optional_float(source, "STORYFORGE_LLM_TEMPERATURE", 0.7)
        ),
    }
    resolved_max_tokens = (
        max_completion_tokens
        if max_completion_tokens is not None
        else _optional_int(source, "STORYFORGE_LLM_MAX_COMPLETION_TOKENS", 0)
    )
    if resolved_max_tokens > 0:
        payload["max_completion_tokens"] = resolved_max_tokens
    reasoning_effort = _env_value(source, "STORYFORGE_LLM_REASONING_EFFORT")
    if reasoning_effort:
        payload["reasoning_effort"] = reasoning_effort
    if tools:
        payload["tools"] = tools
        if tool_choice is not None:
            payload["tool_choice"] = tool_choice
    if stream:
        payload["stream"] = True
        # 要 usage 必须显式开；部分兼容端点不认这个字段，_stream_chat_completions 收到
        # 400 会摘掉它重试一次，届时 usage 回落既有字符估算。
        payload["stream_options"] = {"include_usage": True}
    return payload


def _request_chat_completions(
    source: Mapping[str, str | None],
    payload: dict[str, object],
    *,
    timeout_seconds: float | None = None,
    max_attempts: int | None = None,
) -> tuple[dict[str, object], float]:
    """POST /chat/completions；per-call 覆盖供必须保持既有 timeout / 尝试次数的调用方使用。"""

    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    http_request = request.Request(
        f"{_required_env(source, 'STORYFORGE_LLM_BASE_URL').rstrip('/')}/chat/completions",
        data=body,
        headers=_llm_request_headers(source),
        method="POST",
    )
    timeout = (
        timeout_seconds
        if timeout_seconds is not None
        else _optional_float(source, "STORYFORGE_LLM_TIMEOUT_SECONDS", 300.0)
    )
    attempt_limit = max(
        1,
        max_attempts
        if max_attempts is not None
        else _optional_int(source, "STORYFORGE_LLM_RETRY_MAX_ATTEMPTS", 3),
    )
    base_delay = max(0.0, _optional_float(source, "STORYFORGE_LLM_RETRY_BASE_DELAY_SECONDS", 0.5))
    jitter = max(0.0, _optional_float(source, "STORYFORGE_LLM_RETRY_JITTER_SECONDS", 0.25))
    started_at = time.monotonic()
    data: dict[str, object] | None = None
    for attempt in range(1, attempt_limit + 1):
        try:
            with request.urlopen(http_request, timeout=timeout) as response:
                data = json.loads(response.read().decode("utf-8"))
            break
        except error.HTTPError as exc:
            elapsed_ms = int((time.monotonic() - started_at) * 1000)
            if _is_retryable_status(exc.code) and attempt < attempt_limit:
                _sleep_before_retry(
                    attempt=attempt,
                    base_delay=base_delay,
                    jitter=jitter,
                    retry_after=_retry_after_seconds(exc),
                )
                continue
            try:
                error_body = exc.read().decode("utf-8", errors="replace")[:2000]
            except Exception:  # noqa: BLE001 - 仅用于诊断，读不出 body 不应掩盖原始错误
                error_body = "<无法读取响应体>"
            error_body = redact_sensitive_text(
                error_body,
                extra_secrets=[
                    _env_value(source, "STORYFORGE_LLM_API_KEY"),
                    _env_value(source, "STORYFORGE_LLM_AUTH_TOKEN"),
                ],
            )
            raise LLMError(
                f"真实 LLM 返回 HTTP {exc.code}（耗时 {elapsed_ms}ms，尝试 {attempt}/{attempt_limit}）：{error_body}"
            ) from exc
        except (error.URLError, TimeoutError) as exc:
            elapsed_ms = int((time.monotonic() - started_at) * 1000)
            if attempt < attempt_limit:
                _sleep_before_retry(attempt=attempt, base_delay=base_delay, jitter=jitter, retry_after=None)
                continue
            reason = getattr(exc, "reason", exc)
            reason_text = redact_sensitive_text(
                str(reason),
                extra_secrets=[
                    _env_value(source, "STORYFORGE_LLM_API_KEY"),
                    _env_value(source, "STORYFORGE_LLM_AUTH_TOKEN"),
                ],
            )
            raise LLMError(
                f"真实 LLM 调用超时或连接失败（耗时 {elapsed_ms}ms，timeout={timeout}s，尝试 {attempt}/{attempt_limit}）：{reason_text}"
            ) from exc
        except _RESPONSE_READ_ERRORS as exc:
            elapsed_ms = int((time.monotonic() - started_at) * 1000)
            if attempt < attempt_limit:
                _sleep_before_retry(attempt=attempt, base_delay=base_delay, jitter=jitter, retry_after=None)
                continue
            raise LLMError(
                f"真实 LLM 响应读取或解析失败（耗时 {elapsed_ms}ms，尝试 {attempt}/{attempt_limit}）：{type(exc).__name__}"
            ) from exc
    if data is None:  # 理论不可达：循环要么 break 要么 raise；兜底避免 None 解引用
        raise LLMError("真实 LLM 重试后仍无响应数据。")
    return data, started_at


def _stream_delta_text(chunk: Mapping[str, object]) -> str:
    choices = chunk.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""
    first_choice = choices[0]
    if not isinstance(first_choice, dict):
        return ""
    delta = first_choice.get("delta")
    if not isinstance(delta, dict):
        return ""
    content = delta.get("content")
    return content if isinstance(content, str) else ""


def _stream_finish_reason(chunk: Mapping[str, object]) -> str:
    """取本帧的 finish_reason；非终止帧该字段为 null，取不到就返回空串。"""

    choices = chunk.get("choices")
    if not isinstance(choices, list):
        return ""
    for choice in choices:
        if not isinstance(choice, dict):
            continue
        reason = choice.get("finish_reason")
        if isinstance(reason, str) and reason:
            return reason
    return ""


def _raw_stream_chat_completions(
    source: Mapping[str, str | None],
    payload: dict[str, object],
    *,
    timeout_seconds: float | None = None,
    max_attempts: int | None = None,
) -> Iterator[dict[str, object]]:
    """流式 POST /chat/completions：逐块产出 `delta`，收尾产出一条含记账的 `done`。

    与 `_request_chat_completions` 的重试语义有意不同：**一旦开始吐字就不再重试**——
    重连会让作者眼前重复出现半段正文，比直接失败更糟。故重试只包住建连阶段，读流阶段
    的故障直接以 LLMError 终止并带上已输出字数便于归因。
    """

    url = f"{_required_env(source, 'STORYFORGE_LLM_BASE_URL').rstrip('/')}/chat/completions"
    headers = _llm_request_headers(source)
    secrets = _credential_header_values(headers)
    timeout = (
        timeout_seconds
        if timeout_seconds is not None
        else _optional_float(source, "STORYFORGE_LLM_TIMEOUT_SECONDS", 300.0)
    )
    attempt_limit = max(
        1,
        max_attempts
        if max_attempts is not None
        else _optional_int(source, "STORYFORGE_LLM_RETRY_MAX_ATTEMPTS", 3),
    )
    base_delay = max(0.0, _optional_float(source, "STORYFORGE_LLM_RETRY_BASE_DELAY_SECONDS", 0.5))
    jitter = max(0.0, _optional_float(source, "STORYFORGE_LLM_RETRY_JITTER_SECONDS", 0.25))
    started_at = time.monotonic()

    active_payload = dict(payload)
    dropped_stream_options = False
    attempt = 1
    response = None
    while response is None:
        body = json.dumps(active_payload, ensure_ascii=False).encode("utf-8")
        http_request = request.Request(url, data=body, headers=headers, method="POST")
        try:
            response = request.urlopen(http_request, timeout=timeout)  # noqa: S310 - 固定 https 配置端点
        except error.HTTPError as exc:
            if exc.code == 400 and not dropped_stream_options and "stream_options" in active_payload:
                # 兼容端点不认 stream_options：摘掉重发（不消耗重试次数），usage 回落字符估算。
                active_payload.pop("stream_options", None)
                dropped_stream_options = True
                continue
            elapsed_ms = int((time.monotonic() - started_at) * 1000)
            if _is_retryable_status(exc.code) and attempt < attempt_limit:
                _sleep_before_retry(
                    attempt=attempt,
                    base_delay=base_delay,
                    jitter=jitter,
                    retry_after=_retry_after_seconds(exc),
                )
                attempt += 1
                continue
            try:
                error_body = exc.read().decode("utf-8", errors="replace")[:2000]
            except Exception:  # noqa: BLE001 - 诊断失败不能掩盖原始 HTTP 错误
                error_body = "<无法读取响应体>"
            raise LLMError(
                redact_secrets(
                    f"真实 LLM 流式返回 HTTP {exc.code}（耗时 {elapsed_ms}ms，"
                    f"尝试 {attempt}/{attempt_limit}）：{error_body}",
                    secrets,
                )
            ) from exc
        except (error.URLError, TimeoutError) as exc:
            elapsed_ms = int((time.monotonic() - started_at) * 1000)
            if attempt < attempt_limit:
                _sleep_before_retry(attempt=attempt, base_delay=base_delay, jitter=jitter, retry_after=None)
                attempt += 1
                continue
            raise LLMError(
                redact_secrets(
                    f"真实 LLM 流式建连超时或失败（耗时 {elapsed_ms}ms，timeout={timeout}s，"
                    f"尝试 {attempt}/{attempt_limit}）：{getattr(exc, 'reason', exc)}",
                    secrets,
                )
            ) from exc
        except _RESPONSE_READ_ERRORS as exc:
            # urllib 的 do_open 只把 request() 的 OSError 包成 URLError，getresponse() 阶段的
            # 连接重置（含 RemoteDisconnected）裸抛。非流式 call_llm 早有这条分支，#255 把三条
            # 产字路径搬到流式时没带过来 → 中转站重置既不重试也不包 LLMError，上层只 catch
            # LLMError 于是整轮判失败。此处尚未消费任何流帧，重发不会重复正文。
            elapsed_ms = int((time.monotonic() - started_at) * 1000)
            if attempt < attempt_limit:
                _sleep_before_retry(attempt=attempt, base_delay=base_delay, jitter=jitter, retry_after=None)
                attempt += 1
                continue
            raise LLMError(
                redact_secrets(
                    f"真实 LLM 流式建连被重置（耗时 {elapsed_ms}ms，"
                    f"尝试 {attempt}/{attempt_limit}）：{type(exc).__name__}",
                    secrets,
                )
            ) from exc

    leak_filter = llm_http.StreamingReasoningFilter()
    emitted: list[str] = []
    usage_payload: dict[str, object] | None = None
    saw_terminal = False
    try:
        for raw_line in response:
            line = raw_line.decode("utf-8", errors="replace").strip()
            if not line or not line.startswith("data:"):
                continue
            chunk_text = line[5:].strip()
            if chunk_text == "[DONE]":
                saw_terminal = True
                break
            try:
                chunk = json.loads(chunk_text)
            except json.JSONDecodeError:
                # 心跳/注释帧：跳过而不是打断作者正在看的流。
                continue
            if not isinstance(chunk, dict):
                continue
            if _stream_finish_reason(chunk):
                # 两种终止标记都认：多数兼容端点两者都发（实测本机中转站发 finish_reason
                # "stop" + [DONE]），但只发其一的端点不该被误判成截断。
                saw_terminal = True
            chunk_usage = chunk.get("usage")
            if isinstance(chunk_usage, dict):
                usage_payload = chunk_usage
            delta_text = _stream_delta_text(chunk)
            if not delta_text:
                continue
            visible = leak_filter.feed(delta_text)
            if visible:
                emitted.append(visible)
                yield {"type": "delta", "text": visible}
    except _RESPONSE_READ_ERRORS as exc:
        raise LLMError(
            f"真实 LLM 流式读取中断（已输出 {len(''.join(emitted))} 字）：{type(exc).__name__}"
        ) from exc
    finally:
        response.close()

    tail = leak_filter.flush()
    if tail:
        emitted.append(tail)
        yield {"type": "delta", "text": tail}

    content = "".join(emitted).strip()
    if not content:
        raise LLMError("真实 LLM 流式返回内容为空。")
    if not saw_terminal:
        # 上游在收尾标记之前关流：此前这里照常产出 done 帧，半截正文被当成稿——实测
        # wave6 落出一篇 804 字、断在「从柜台下面摸出一」的样本。自动档下这种半截章节
        # 不经作者点击就会写进文件，故宁可失败也不交半成品。
        raise LLMError(
            f"真实 LLM 流式在收到终止标记前中断（已输出 {len(content)} 字），不能把半截正文当成稿。"
        )
    messages = payload.get("messages")
    prompt_text = (
        "\n".join(str(item.get("content") or "") for item in messages if isinstance(item, dict))
        if isinstance(messages, list)
        else ""
    )
    usage = _token_usage({"usage": usage_payload} if usage_payload else None, prompt_text, content)
    cost = _cost_breakdown(source, usage)
    done: dict[str, object] = {
        "type": "done",
        "content": content,
        **usage,
        "cost_cny_estimated": cost["total_cny"],
        "cost_breakdown": cost,
        "latency_ms": max(0, int((time.monotonic() - started_at) * 1000)),
    }
    if leak_filter.stripped:
        done["reasoning_leak_stripped"] = True
    yield done


def _sdk_chat_request(
    source: Mapping[str, str | None],
    *,
    messages: list[dict[str, object]],
    tools: list[dict[str, object]] | None = None,
    tool_choice: str | dict[str, object] | None = None,
    temperature: float | None = None,
    max_completion_tokens: int | None = None,
) -> ChatRequest:
    resolved_max_tokens = (
        max_completion_tokens
        if max_completion_tokens is not None
        else _optional_int(source, "STORYFORGE_LLM_MAX_COMPLETION_TOKENS", 0)
    )
    return ChatRequest(
        model=_required_env(source, "STORYFORGE_LLM_MODEL"),
        messages=messages_from_openai(messages),
        tools=tools_from_openai(tools),
        temperature=(
            temperature
            if temperature is not None
            else _optional_float(source, "STORYFORGE_LLM_TEMPERATURE", 0.7)
        ),
        max_tokens=resolved_max_tokens if resolved_max_tokens > 0 else None,
        tool_choice=tool_choice,
        reasoning_effort=_env_value(source, "STORYFORGE_LLM_REASONING_EFFORT") or None,
    )


def _sdk_provider(
    source: Mapping[str, str | None],
    *,
    stream_payload: dict[str, object] | None = None,
    timeout_seconds: float | None = None,
    max_attempts: int | None = None,
) -> OpenAICompatibleProvider:
    return OpenAICompatibleProvider(
        complete_transport=lambda payload: _request_chat_completions(source, payload),
        stream_transport=(
            lambda _payload: _raw_stream_chat_completions(
                source,
                stream_payload,
                timeout_seconds=timeout_seconds,
                max_attempts=max_attempts,
            )
            if stream_payload is not None
            else None
        ),
        content_filter=_strip_reasoning_leak,
        usage_parser=_token_usage,
    )


class _ConfiguredLLMProvider:
    """Apply StoryForge environment defaults behind the public provider protocol."""

    def __init__(
        self,
        source: Mapping[str, str | None],
        *,
        stream_payload: dict[str, object] | None = None,
        timeout_seconds: float | None = None,
        max_attempts: int | None = None,
    ) -> None:
        self._source = dict(source)
        self._provider = _sdk_provider(
            self._source,
            stream_payload=stream_payload,
            timeout_seconds=timeout_seconds,
            max_attempts=max_attempts,
        )

    def _configured_request(self, chat_request: ChatRequest) -> ChatRequest:
        configured_max_tokens = _optional_int(
            self._source, "STORYFORGE_LLM_MAX_COMPLETION_TOKENS", 0
        )
        return replace(
            chat_request,
            model=chat_request.model or _required_env(self._source, "STORYFORGE_LLM_MODEL"),
            temperature=(
                chat_request.temperature
                if chat_request.temperature is not None
                else _optional_float(self._source, "STORYFORGE_LLM_TEMPERATURE", 0.7)
            ),
            max_tokens=(
                chat_request.max_tokens
                if chat_request.max_tokens is not None
                else configured_max_tokens if configured_max_tokens > 0 else None
            ),
            reasoning_effort=(
                chat_request.reasoning_effort
                or _env_value(self._source, "STORYFORGE_LLM_REASONING_EFFORT")
                or None
            ),
        )

    def complete(self, chat_request: ChatRequest) -> ChatResponse:
        return self._provider.complete(self._configured_request(chat_request))

    def stream(self, chat_request: ChatRequest) -> Iterator[StreamEvent]:
        return self._provider.stream(self._configured_request(chat_request))

    def health(self) -> ProviderHealth:
        return self._provider.health()

    def capabilities(self, model: str) -> ProviderCapabilities:
        return self._provider.capabilities(model)


def _build_llm_provider(
    source: Mapping[str, str | None],
    *,
    stream_payload: dict[str, object] | None = None,
    timeout_seconds: float | None = None,
    max_attempts: int | None = None,
) -> LLMProvider:
    return _ConfiguredLLMProvider(
        source,
        stream_payload=stream_payload,
        timeout_seconds=timeout_seconds,
        max_attempts=max_attempts,
    )


def _resolved_llm_model(source: Mapping[str, str | None]) -> str:
    return _required_env(source, "STORYFORGE_LLM_MODEL")


def _legacy_provider_error(exc: ProviderError) -> LLMError:
    messages = {
        "missing_choices": "真实 LLM 响应缺少 choices，不能继续 BookRun 生成。",
        "invalid_choice": "真实 LLM 响应 choices[0] 格式异常。",
        "missing_message": "真实 LLM 响应缺少 message，不能继续 BookRun 生成。",
    }
    return LLMError(messages.get(exc.details.provider_code, str(exc)))


def _stream_chat_completions(
    source: Mapping[str, str | None],
    payload: dict[str, object],
    *,
    timeout_seconds: float | None = None,
    max_attempts: int | None = None,
) -> Iterator[dict[str, object]]:
    """Compatibility projection over the typed OpenAI-compatible provider stream."""

    raw_messages = payload.get("messages")
    messages = [item for item in raw_messages if isinstance(item, dict)] if isinstance(raw_messages, list) else []
    raw_tools = payload.get("tools")
    tools = [item for item in raw_tools if isinstance(item, dict)] if isinstance(raw_tools, list) else None
    chat_request = _sdk_chat_request(
        source,
        messages=messages,
        tools=tools,
        tool_choice=payload.get("tool_choice") if isinstance(payload.get("tool_choice"), str | dict) else None,
        temperature=payload.get("temperature") if isinstance(payload.get("temperature"), int | float) else None,
        max_completion_tokens=(
            payload.get("max_completion_tokens")
            if isinstance(payload.get("max_completion_tokens"), int)
            else None
        ),
    )
    try:
        for event in _sdk_provider(
            source,
            stream_payload=payload,
            timeout_seconds=timeout_seconds,
            max_attempts=max_attempts,
        ).stream(chat_request):
            if event.kind is StreamEventKind.TEXT_DELTA and event.text:
                yield {"type": "delta", "text": event.text}
                continue
            if event.kind is not StreamEventKind.COMPLETED or event.response is None:
                continue
            yield {
                "type": "done",
                "content": event.response.content,
                **event.response.usage.to_legacy(),
                **dict(event.response.metadata),
            }
    except ProviderError as exc:
        raise _legacy_provider_error(exc) from exc


def _call_llm(
    source: Mapping[str, str | None],
    *,
    system_prompt: str,
    user_prompt: str,
    tools: list[dict[str, object]] | None = None,
    tool_choice: str | dict[str, object] | None = None,
) -> dict[str, object]:
    """对真实 OpenAI 兼容端点发一次 chat/completions，返回正文与 token 使用。"""

    chat_request = _sdk_chat_request(
        source,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        tools=tools,
        tool_choice=tool_choice,
    )
    try:
        response = _sdk_provider(source).complete(chat_request)
    except ProviderError as exc:
        raise _legacy_provider_error(exc) from exc
    content = response.content
    if not content:
        if response.metadata.get("reasoning_leak_stripped") is True:
            raise LLMError("真实 LLM 返回仅含思维链、无正文，不能继续 BookRun 生成。")
        raise LLMError("真实 LLM 返回内容为空，不能继续 BookRun 生成。")
    tool_calls = [call.to_openai() for call in response.tool_calls]
    usage = response.usage.to_legacy()
    cost_breakdown = _cost_breakdown(source, usage)
    result: dict[str, object] = {
        "content": content,
        **usage,
        "cost_cny_estimated": cost_breakdown["total_cny"],
        "cost_breakdown": cost_breakdown,
        "latency_ms": int(response.metadata.get("latency_ms") or 0),
    }
    if response.metadata.get("reasoning_leak_stripped") is True:
        result["reasoning_leak_stripped"] = True
    if tool_calls:
        result["tool_calls"] = tool_calls
    return result


def _call_llm_streamed(
    source: Mapping[str, str | None],
    *,
    system_prompt: str,
    user_prompt: str,
) -> dict[str, object]:
    """与 `_call_llm` 同签名、同返回，差别只在传输走流式后由服务端聚合。

    为什么需要：非流式长请求在 CDN / 中转站前置下会被当成空闲连接掐掉——实测某
    Cloudflare 前置网关跑 800–1200 字正文 280s 未返回，另有 ConnectionReset；同一
    prompt 走流式则持续有字节流动，不触发空闲超时。产字三条路径（file.create /
    file.revise / draft_continuation）的正文动辄上千字，正是被掐的那一档。

    对调用方透明：返回同一个 dict，HTTP 契约与前端零改动。终帧字段与 `_call_llm`
    逐键同构（都由 `_token_usage` + `_cost_breakdown` 组），故只需摘掉流式的 `type`。
    不收 tools/tool_choice：工具调用不走这条路（`_call_llm_messages` 才是循环入口）。
    """

    messages: list[dict[str, object]] = []
    if system_prompt.strip():
        # 空 system 段不落进 messages：部分端点对空 system 消息行为不一致，而实验台的
        # 单条 user prompt 形态若被硬塞一条空 system，与既有波次就不是同一个输入了。
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": user_prompt})
    payload = _build_chat_payload(
        source,
        messages=messages,
        tools=None,
        tool_choice=None,
        stream=True,
    )
    final: dict[str, object] | None = None
    for frame in _stream_chat_completions(source, payload):
        if frame.get("type") == "done":
            final = frame
    if final is None:
        # 流正常读完却没有终帧 = 上游提前关流；静默返回空正文会让缺文当成功写进补丁。
        raise LLMError("真实 LLM 流式结束但未返回终帧，无法取得完整正文。")
    result = dict(final)
    result.pop("type", None)
    return result


def _call_llm_messages(
    source: Mapping[str, str | None],
    *,
    messages: list[dict[str, object]],
    tools: list[dict[str, object]] | None = None,
    tool_choice: str | dict[str, object] | None = None,
) -> dict[str, object]:
    """多轮 messages 版 chat/completions，供 Agent 工具循环使用。

    与 `_call_llm` 的差别：允许 assistant 只返回 tool_calls、content 为空——
    工具循环里这是合法中间态，不作为错误。"""

    chat_request = _sdk_chat_request(
        source,
        messages=messages,
        tools=tools,
        tool_choice=tool_choice,
    )
    try:
        response = _sdk_provider(source).complete(chat_request)
    except ProviderError as exc:
        raise _legacy_provider_error(exc) from exc
    content = response.content
    tool_calls = [call.to_openai() for call in response.tool_calls]
    if not content and not tool_calls:
        raise LLMError("真实 LLM 返回既无正文也无工具调用，无法继续。")
    usage = response.usage.to_legacy()
    cost_breakdown = _cost_breakdown(source, usage)
    result: dict[str, object] = {
        "content": content,
        "tool_calls": tool_calls,
        **usage,
        "cost_cny_estimated": cost_breakdown["total_cny"],
        "cost_breakdown": cost_breakdown,
        "latency_ms": int(response.metadata.get("latency_ms") or 0),
    }
    if response.metadata.get("reasoning_leak_stripped") is True:
        result["reasoning_leak_stripped"] = True
    return result


def _assistant_message(data: dict[str, object]) -> dict[str, object]:
    choices = data.get("choices")
    if not isinstance(choices, list) or not choices:
        raise LLMError("真实 LLM 响应缺少 choices，不能继续 BookRun 生成。")
    first_choice = choices[0]
    if not isinstance(first_choice, dict):
        raise LLMError("真实 LLM 响应 choices[0] 格式异常。")
    message = first_choice.get("message")
    if not isinstance(message, dict):
        raise LLMError("真实 LLM 响应缺少 message，不能继续 BookRun 生成。")
    return message


def _message_tool_calls(message: Mapping[str, object]) -> list[dict[str, object]]:
    raw_tool_calls = message.get("tool_calls")
    if not isinstance(raw_tool_calls, list):
        return []
    tool_calls: list[dict[str, object]] = []
    for raw_call in raw_tool_calls:
        if not isinstance(raw_call, dict):
            continue
        function = raw_call.get("function")
        if not isinstance(function, dict):
            continue
        arguments = function.get("arguments")
        if isinstance(arguments, dict | list):
            arguments_text = json.dumps(arguments, ensure_ascii=False)
        else:
            arguments_text = str(arguments or "")
        tool_calls.append(
            {
                "id": str(raw_call.get("id") or ""),
                "type": str(raw_call.get("type") or "function"),
                "function": {
                    "name": str(function.get("name") or ""),
                    "arguments": arguments_text,
                },
            }
        )
    return tool_calls


def _is_retryable_status(status_code: int) -> bool:
    """429 与 5xx 视为可重试的瞬时错误；4xx（429 除外）立即失败，不掩盖真实问题。"""

    return status_code == 429 or 500 <= status_code <= 599


def _retry_after_seconds(exc: error.HTTPError) -> float | None:
    """读取 Retry-After 响应头（秒）；缺失或非数字返回 None，回退到指数退避。"""

    headers = getattr(exc, "headers", None)
    if headers is None:
        return None
    raw = headers.get("Retry-After")
    if not raw:
        return None
    try:
        seconds = float(str(raw).strip())
    except ValueError:
        return None
    return seconds if seconds >= 0 else None


def _sleep_before_retry(*, attempt: int, base_delay: float, jitter: float, retry_after: float | None) -> None:
    """指数退避 + jitter；服务端给出 Retry-After 时优先尊重。镜像 workflow provider_client 的退避语义。"""

    if retry_after is not None:
        delay = min(retry_after, _RETRY_DELAY_CEILING_SECONDS)
    else:
        delay = base_delay * (2 ** (attempt - 1))
        if jitter > 0:
            delay += random() * jitter
        delay = min(delay, _RETRY_DELAY_CEILING_SECONDS)
    if delay > 0:
        time.sleep(delay)


def _llm_request_headers(source: Mapping[str, str | None]) -> dict[str, str]:
    credential = _required_env(source, "STORYFORGE_LLM_API_KEY")
    auth_header = _env_value(source, "STORYFORGE_LLM_AUTH_HEADER").lower() or "bearer"
    try:
        return llm_http.openai_compatible_headers(credential=credential, auth_header=auth_header)
    except ValueError as exc:
        raise LLMConfigError("STORYFORGE_LLM_AUTH_HEADER 只支持 api-key 或 bearer。") from exc


def _provider_cache_hit_tokens(usage: Mapping[str, object]) -> int | None:
    """读 provider 回报的「prompt 前缀缓存命中」token 数；这家没报就返回 None。

    三态是刻意的：None（字段不存在，我们不知道命中情况）与 0（provider 报了、本次
    确实全未命中）不是一回事。把「不知道」当成 0 会让成本账把可能已经命中的部分按
    全价记，也让命中率这个指标永远没法从 0 起步——读不到证据不等于证据为零。

    两种 wire 形态：DeepSeek 一类在 usage 顶层给 prompt_cache_hit_tokens；OpenAI 一类
    在 usage.prompt_tokens_details.cached_tokens。都读不到才算这家没报。
    """

    direct = usage.get("prompt_cache_hit_tokens")
    if isinstance(direct, int) and not isinstance(direct, bool):
        return max(0, direct)
    details = usage.get("prompt_tokens_details")
    if isinstance(details, Mapping):
        nested = details.get("cached_tokens")
        if isinstance(nested, int) and not isinstance(nested, bool):
            return max(0, nested)
    return None


def _token_usage(data: object, prompt: str, content: str) -> dict[str, int | str | None]:
    usage = data.get("usage") if isinstance(data, dict) else None
    if isinstance(usage, dict):
        cache_hit_tokens = _provider_cache_hit_tokens(usage)
        total = usage.get("total_tokens")
        prompt_tokens = usage.get("prompt_tokens")
        completion_tokens = usage.get("completion_tokens")
        if isinstance(prompt_tokens, int) and isinstance(completion_tokens, int):
            resolved_total = total if isinstance(total, int) and total > 0 else prompt_tokens + completion_tokens
            return {
                "token_usage": max(1, resolved_total),
                "prompt_tokens": max(0, prompt_tokens),
                "completion_tokens": max(0, completion_tokens),
                "cache_hit_tokens": cache_hit_tokens,
                "token_usage_source": "provider_usage",
            }
        if isinstance(total, int) and total > 0:
            estimated_prompt = max(0, len(prompt) // 4)
            estimated_completion = max(0, total - estimated_prompt)
            return {
                "token_usage": total,
                "prompt_tokens": estimated_prompt,
                "completion_tokens": estimated_completion,
                "cache_hit_tokens": cache_hit_tokens,
                "token_usage_source": "estimated_split",
            }
    prompt_tokens = max(1, len(prompt) // 4)
    completion_tokens = max(1, len(content) // 4)
    return {
        "token_usage": prompt_tokens + completion_tokens,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "cache_hit_tokens": None,
        "token_usage_source": "estimated_split",
    }


def _cost_breakdown(
    source: Mapping[str, str | None], usage: dict[str, int | str | None]
) -> dict[str, float | str | None]:
    """按「命中 / 未命中」分段计 input 成本。

    STORYFORGE_LLM_CACHE_HIT_INPUT_CNY_PER_M_TOKENS 此前只被原样回显、从不参与计算，
    于是命中部分一律按全价入账（多数 provider 的命中价是全价的 1/10）。provider 没报
    命中数时 billed_hit 为 0，算出来与改动前逐位相同。
    """

    prompt_tokens = int(usage.get("prompt_tokens") or 0)
    completion_tokens = int(usage.get("completion_tokens") or 0)
    input_rate = _optional_float(source, "STORYFORGE_LLM_INPUT_CNY_PER_M_TOKENS", 0.0)
    output_rate = _optional_float(source, "STORYFORGE_LLM_OUTPUT_CNY_PER_M_TOKENS", 0.0)
    cache_hit_rate = _optional_float(source, "STORYFORGE_LLM_CACHE_HIT_INPUT_CNY_PER_M_TOKENS", 0.0)
    raw_cache_hit = usage.get("cache_hit_tokens")
    cache_hit_tokens = (
        min(prompt_tokens, max(0, int(raw_cache_hit)))
        if isinstance(raw_cache_hit, int) and not isinstance(raw_cache_hit, bool)
        else None
    )
    billed_hit = cache_hit_tokens or 0
    billed_miss = prompt_tokens - billed_hit
    # 没配命中价（或配成非正数）就按全价计：宁可与改动前的账一致，也不要把命中部分
    # 当成免费而低估——低估的成本账比高估更难被发现。
    effective_hit_rate = cache_hit_rate if cache_hit_rate > 0 else input_rate
    input_cny = (billed_miss / 1_000_000) * input_rate + (billed_hit / 1_000_000) * effective_hit_rate
    output_cny = (completion_tokens / 1_000_000) * output_rate
    return {
        "currency": "CNY",
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "cache_hit_tokens": cache_hit_tokens,
        "cache_miss_tokens": billed_miss if cache_hit_tokens is not None else None,
        "input_cny": input_cny,
        "output_cny": output_cny,
        "total_cny": input_cny + output_cny,
        "input_cny_per_m_tokens": input_rate,
        "output_cny_per_m_tokens": output_rate,
        "cache_hit_input_cny_per_m_tokens": cache_hit_rate,
        "source": str(usage.get("token_usage_source") or "estimated_split"),
    }


def _required_env(source: Mapping[str, str | None], name: str) -> str:
    value = _env_value(source, name)
    if not value:
        raise LLMConfigError(f"缺少真实 LLM 生成环境变量：{name}。")
    return value


assistant_message = _assistant_message
build_chat_payload = _build_chat_payload
build_llm_provider = _build_llm_provider
call_llm = _call_llm
call_llm_messages = _call_llm_messages
call_llm_streamed = _call_llm_streamed
cost_breakdown = _cost_breakdown
env_value = _env_value
is_retryable_status = _is_retryable_status
llm_request_headers = _llm_request_headers
message_tool_calls = _message_tool_calls
optional_float = _optional_float
optional_int = _optional_int
request_chat_completions = _request_chat_completions
resolved_llm_model = _resolved_llm_model
required_env = _required_env
retry_after_seconds = _retry_after_seconds
sleep_before_retry = _sleep_before_retry
stream_chat_completions = _stream_chat_completions
stream_delta_text = _stream_delta_text
strip_reasoning_leak = _strip_reasoning_leak
token_usage = _token_usage
