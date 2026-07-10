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
import time
from collections.abc import Iterable, Mapping
from random import random
from urllib import error, request

from app.common import llm_http
from app.common.exceptions import DomainError
from app.common.redaction import redact_sensitive_text

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
    return redacted


def _build_chat_payload(
    source: Mapping[str, str | None],
    *,
    messages: list[dict[str, object]],
    tools: list[dict[str, object]] | None,
    tool_choice: str | dict[str, object] | None,
) -> dict[str, object]:
    payload: dict[str, object] = {
        "model": _required_env(source, "STORYFORGE_LLM_MODEL"),
        "messages": messages,
        "temperature": _optional_float(source, "STORYFORGE_LLM_TEMPERATURE", 0.7),
    }
    max_completion_tokens = _optional_int(source, "STORYFORGE_LLM_MAX_COMPLETION_TOKENS", 0)
    if max_completion_tokens > 0:
        payload["max_completion_tokens"] = max_completion_tokens
    reasoning_effort = _env_value(source, "STORYFORGE_LLM_REASONING_EFFORT")
    if reasoning_effort:
        payload["reasoning_effort"] = reasoning_effort
    if tools:
        payload["tools"] = tools
        if tool_choice is not None:
            payload["tool_choice"] = tool_choice
    return payload


def _request_chat_completions(
    source: Mapping[str, str | None],
    payload: dict[str, object],
) -> tuple[dict[str, object], float]:
    """带重试地 POST /chat/completions，返回响应体与请求起始时间。"""

    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    http_request = request.Request(
        f"{_required_env(source, 'STORYFORGE_LLM_BASE_URL').rstrip('/')}/chat/completions",
        data=body,
        headers=_llm_request_headers(source),
        method="POST",
    )
    timeout = _optional_float(source, "STORYFORGE_LLM_TIMEOUT_SECONDS", 300.0)
    max_attempts = max(1, _optional_int(source, "STORYFORGE_LLM_RETRY_MAX_ATTEMPTS", 3))
    base_delay = max(0.0, _optional_float(source, "STORYFORGE_LLM_RETRY_BASE_DELAY_SECONDS", 0.5))
    jitter = max(0.0, _optional_float(source, "STORYFORGE_LLM_RETRY_JITTER_SECONDS", 0.25))
    started_at = time.monotonic()
    data: dict[str, object] | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            with request.urlopen(http_request, timeout=timeout) as response:
                data = json.loads(response.read().decode("utf-8"))
            break
        except error.HTTPError as exc:
            elapsed_ms = int((time.monotonic() - started_at) * 1000)
            if _is_retryable_status(exc.code) and attempt < max_attempts:
                _sleep_before_retry(
                    attempt=attempt,
                    base_delay=base_delay,
                    jitter=jitter,
                    retry_after=_retry_after_seconds(exc),
                )
                continue
            try:
                error_body = redact_sensitive_text(
                    exc.read().decode("utf-8", errors="replace")[:2000],
                    extra_secrets=[
                        source.get("STORYFORGE_LLM_API_KEY"),
                        source.get("STORYFORGE_LLM_AUTH_TOKEN"),
                    ],
                )
            except Exception:  # noqa: BLE001 - 仅用于诊断，读不出 body 不应掩盖原始错误
                error_body = "<无法读取响应体>"
            raise LLMError(
                f"真实 LLM 返回 HTTP {exc.code}（耗时 {elapsed_ms}ms，尝试 {attempt}/{max_attempts}）：{error_body}"
            ) from exc
        except (error.URLError, TimeoutError) as exc:
            elapsed_ms = int((time.monotonic() - started_at) * 1000)
            if attempt < max_attempts:
                _sleep_before_retry(attempt=attempt, base_delay=base_delay, jitter=jitter, retry_after=None)
                continue
            reason = getattr(exc, "reason", exc)
            raise LLMError(
                f"真实 LLM 调用超时或连接失败（耗时 {elapsed_ms}ms，timeout={timeout}s，尝试 {attempt}/{max_attempts}）：{reason}"
            ) from exc
        except _RESPONSE_READ_ERRORS as exc:
            elapsed_ms = int((time.monotonic() - started_at) * 1000)
            if attempt < max_attempts:
                _sleep_before_retry(attempt=attempt, base_delay=base_delay, jitter=jitter, retry_after=None)
                continue
            raise LLMError(
                f"真实 LLM 响应读取或解析失败（耗时 {elapsed_ms}ms，尝试 {attempt}/{max_attempts}）：{type(exc).__name__}"
            ) from exc
    if data is None:  # 理论不可达：循环要么 break 要么 raise；兜底避免 None 解引用
        raise LLMError("真实 LLM 重试后仍无响应数据。")
    return data, started_at


def _call_llm(
    source: Mapping[str, str | None],
    *,
    system_prompt: str,
    user_prompt: str,
    tools: list[dict[str, object]] | None = None,
    tool_choice: str | dict[str, object] | None = None,
) -> dict[str, object]:
    """对真实 OpenAI 兼容端点发一次 chat/completions，返回正文与 token 使用。"""

    payload = _build_chat_payload(
        source,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        tools=tools,
        tool_choice=tool_choice,
    )
    data, started_at = _request_chat_completions(source, payload)
    message = _assistant_message(data)
    content = message.get("content")
    if not isinstance(content, str) or not content.strip():
        raise LLMError("真实 LLM 返回内容为空，不能继续 BookRun 生成。")
    raw_content = content
    content = _strip_reasoning_leak(content)
    if not content:
        raise LLMError("真实 LLM 返回仅含思维链、无正文，不能继续 BookRun 生成。")
    tool_calls = _message_tool_calls(message)
    usage = _token_usage(data, user_prompt, content)
    cost_breakdown = _cost_breakdown(source, usage)
    result: dict[str, object] = {
        "content": content,
        **usage,
        "cost_cny_estimated": cost_breakdown["total_cny"],
        "cost_breakdown": cost_breakdown,
        "latency_ms": max(0, int((time.monotonic() - started_at) * 1000)),
    }
    if content != raw_content.strip():
        result["reasoning_leak_stripped"] = True
    if tool_calls:
        result["tool_calls"] = tool_calls
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

    payload = _build_chat_payload(source, messages=messages, tools=tools, tool_choice=tool_choice)
    data, started_at = _request_chat_completions(source, payload)
    message = _assistant_message(data)
    raw_content = message.get("content")
    content = raw_content.strip() if isinstance(raw_content, str) else ""
    stripped_raw = content
    if content:
        content = _strip_reasoning_leak(content)
    tool_calls = _message_tool_calls(message)
    if not content and not tool_calls:
        raise LLMError("真实 LLM 返回既无正文也无工具调用，无法继续。")
    prompt_text = "\n".join(str(item.get("content") or "") for item in messages)
    usage = _token_usage(data, prompt_text, content)
    cost_breakdown = _cost_breakdown(source, usage)
    result: dict[str, object] = {
        "content": content,
        "tool_calls": tool_calls,
        **usage,
        "cost_cny_estimated": cost_breakdown["total_cny"],
        "cost_breakdown": cost_breakdown,
        "latency_ms": max(0, int((time.monotonic() - started_at) * 1000)),
    }
    if content != stripped_raw:
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


def _token_usage(data: object, prompt: str, content: str) -> dict[str, int | str]:
    usage = data.get("usage") if isinstance(data, dict) else None
    if isinstance(usage, dict):
        total = usage.get("total_tokens")
        prompt_tokens = usage.get("prompt_tokens")
        completion_tokens = usage.get("completion_tokens")
        if isinstance(prompt_tokens, int) and isinstance(completion_tokens, int):
            resolved_total = total if isinstance(total, int) and total > 0 else prompt_tokens + completion_tokens
            return {
                "token_usage": max(1, resolved_total),
                "prompt_tokens": max(0, prompt_tokens),
                "completion_tokens": max(0, completion_tokens),
                "token_usage_source": "provider_usage",
            }
        if isinstance(total, int) and total > 0:
            estimated_prompt = max(0, len(prompt) // 4)
            estimated_completion = max(0, total - estimated_prompt)
            return {
                "token_usage": total,
                "prompt_tokens": estimated_prompt,
                "completion_tokens": estimated_completion,
                "token_usage_source": "estimated_split",
            }
    prompt_tokens = max(1, len(prompt) // 4)
    completion_tokens = max(1, len(content) // 4)
    return {
        "token_usage": prompt_tokens + completion_tokens,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "token_usage_source": "estimated_split",
    }


def _cost_breakdown(source: Mapping[str, str | None], usage: dict[str, int | str]) -> dict[str, float | str]:
    prompt_tokens = int(usage.get("prompt_tokens") or 0)
    completion_tokens = int(usage.get("completion_tokens") or 0)
    input_rate = _optional_float(source, "STORYFORGE_LLM_INPUT_CNY_PER_M_TOKENS", 0.0)
    output_rate = _optional_float(source, "STORYFORGE_LLM_OUTPUT_CNY_PER_M_TOKENS", 0.0)
    cache_hit_rate = _optional_float(source, "STORYFORGE_LLM_CACHE_HIT_INPUT_CNY_PER_M_TOKENS", 0.0)
    input_cny = (prompt_tokens / 1_000_000) * input_rate
    output_cny = (completion_tokens / 1_000_000) * output_rate
    return {
        "currency": "CNY",
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
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
