from __future__ import annotations

import http.client
import io
import json
import os
import threading
from random import random
from time import sleep
from urllib.error import HTTPError
from urllib.parse import urlsplit

_thread_connections = threading.local()


def generate_text(
    prompt: str,
    *,
    system_prompt: str = "You are a creative writing engine for StoryForge. Return only the requested Chinese prose or structured result.",
    temperature: float | None = None,
    model: str | None = None,
) -> str:
    """调用 OpenAI 兼容 Chat Completions 端点生成文本。

    temperature/model 为 None 时回退到全局 env 默认，保证旧调用方行为不变；
    传入显式值即可按节点角色（规划低温、正文高温）分层采样。
    """

    config = provider_config()
    resolved_temperature = (
        temperature if temperature is not None else float(os.getenv("STORYFORGE_LLM_TEMPERATURE", "0.7"))
    )
    payload = {
        "model": model or config["model"],
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ],
        "temperature": resolved_temperature,
    }
    max_tokens = os.getenv("STORYFORGE_LLM_MAX_TOKENS")
    if max_tokens:
        payload["max_tokens"] = int(max_tokens)
    prompt_cache_key = os.getenv("STORYFORGE_LLM_PROMPT_CACHE_KEY", "").strip()
    if prompt_cache_key:
        payload["prompt_cache_key"] = prompt_cache_key
    prompt_cache_retention = os.getenv("STORYFORGE_LLM_PROMPT_CACHE_RETENTION", "").strip()
    if prompt_cache_retention:
        payload["prompt_cache_retention"] = prompt_cache_retention
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    timeout = float(os.getenv("STORYFORGE_LLM_TIMEOUT_SECONDS", "30"))
    data = _post_chat_completion(config=config, body=body, timeout=timeout)
    content = data["choices"][0]["message"]["content"]
    if not isinstance(content, str) or not content.strip():
        raise RuntimeError("LLM 返回内容为空，无法继续工作流。")
    return content.strip()


def close_provider_connections() -> None:
    """关闭当前线程缓存的 provider 连接，供测试和 worker 收尾阶段释放资源。"""

    connections = getattr(_thread_connections, "connections", {})
    for connection in connections.values():
        connection.close()
    _thread_connections.connections = {}


def _post_chat_completion(*, config: dict[str, str], body: bytes, timeout: float) -> dict[str, object]:
    url = _chat_completion_url(config["base_url"])
    headers = {
        "Authorization": f"Bearer {config['api_key']}",
        "Content-Type": "application/json",
        "Content-Length": str(len(body)),
    }
    max_attempts = _int_env("STORYFORGE_LLM_RETRY_MAX_ATTEMPTS", 3)
    base_delay = _float_env("STORYFORGE_LLM_RETRY_BASE_DELAY_SECONDS", 0.5)
    jitter = _float_env("STORYFORGE_LLM_RETRY_JITTER_SECONDS", 0.25)
    for attempt in range(1, max(1, max_attempts) + 1):
        try:
            return _request_json_with_reused_connection(url=url, body=body, headers=headers, timeout=timeout)
        except HTTPError as exc:
            if not _is_retryable_http_error(exc) or attempt >= max_attempts:
                raise
            _sleep_before_retry(attempt=attempt, base_delay=base_delay, jitter=jitter)
        except (http.client.CannotSendRequest, http.client.RemoteDisconnected, ConnectionError, OSError):
            _close_cached_connection(url=url, timeout=timeout)
            if attempt >= max_attempts:
                raise
            _sleep_before_retry(attempt=attempt, base_delay=base_delay, jitter=jitter)
    raise RuntimeError("LLM provider 重试状态异常。")


def _request_json_with_reused_connection(
    *,
    url: str,
    body: bytes,
    headers: dict[str, str],
    timeout: float,
) -> dict[str, object]:
    parts = urlsplit(url)
    connection = _connection_for(parts.scheme, parts.hostname or "", parts.port, timeout)
    path = parts.path or "/"
    if parts.query:
        path = f"{path}?{parts.query}"
    connection.request("POST", path, body=body, headers=headers)
    response = connection.getresponse()
    response_body = response.read()
    if response.status >= 400:
        _close_cached_connection(url=url, timeout=timeout)
        raise HTTPError(
            url=url,
            code=response.status,
            msg=response.reason,
            hdrs=response.headers,
            fp=io.BytesIO(response_body),
        )
    return json.loads(response_body.decode("utf-8"))


def _connection_for(
    scheme: str,
    host: str,
    port: int | None,
    timeout: float,
) -> http.client.HTTPConnection:
    if scheme not in {"http", "https"}:
        raise RuntimeError(f"不支持的 LLM provider 协议：{scheme}。")
    if not host:
        raise RuntimeError("LLM provider base_url 缺少主机名。")
    key = (scheme, host, port, timeout)
    connections = getattr(_thread_connections, "connections", None)
    if connections is None:
        connections = {}
        _thread_connections.connections = connections
    connection = connections.get(key)
    if connection is None:
        cls = http.client.HTTPSConnection if scheme == "https" else http.client.HTTPConnection
        connection = cls(host, port=port, timeout=timeout)
        connections[key] = connection
    return connection


def _close_cached_connection(*, url: str, timeout: float) -> None:
    parts = urlsplit(url)
    key = (parts.scheme, parts.hostname or "", parts.port, timeout)
    connections = getattr(_thread_connections, "connections", {})
    connection = connections.pop(key, None)
    if connection is not None:
        connection.close()


def _chat_completion_url(base_url: str) -> str:
    return f"{base_url.rstrip('/')}/chat/completions"


def provider_config() -> dict[str, str]:
    """解析 workflow 侧真实模型配置，缺少密钥时显式失败。"""

    api_key = os.getenv("STORYFORGE_LLM_API_KEY")
    if not api_key:
        raise RuntimeError("缺少 STORYFORGE_LLM_API_KEY，无法调用真实 LLM。")
    return {
        "api_key": api_key,
        "base_url": os.getenv("STORYFORGE_LLM_BASE_URL", "https://api.openai.com/v1"),
        "model": _normalize_model_id(os.getenv("STORYFORGE_LLM_MODEL", "gpt-4o-mini")),
        "provider_name": os.getenv("STORYFORGE_LLM_PROVIDER", "openai-compatible"),
    }


def _normalize_model_id(model: str) -> str:
    """归一用户口语化模型名，避免网关因非标准 ID 返回上游错误。"""

    aliases = {
        "gpt5.4mini": "gpt-5.4-mini",
        "gpt-5.4mini": "gpt-5.4-mini",
        "gpt5.4-mini": "gpt-5.4-mini",
        "gpt-5.4-mini": "gpt-5.4-mini",
    }
    normalized = model.strip()
    return aliases.get(normalized.lower(), normalized)


def _float_env(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _int_env(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        parsed = int(raw)
    except ValueError:
        return default
    return parsed if parsed > 0 else default


def _is_retryable_http_error(error: HTTPError) -> bool:
    return error.code == 429 or 500 <= error.code <= 599


def _sleep_before_retry(*, attempt: int, base_delay: float, jitter: float) -> None:
    delay = max(0.0, base_delay) * (2 ** (attempt - 1))
    if jitter > 0:
        delay += random() * jitter
    sleep(delay)


def planning_temperature() -> float:
    """规划节点（策略/章纲/beat）用低温，换取结构稳定与可解析。"""

    return _float_env("STORYFORGE_LLM_PLANNING_TEMPERATURE", 0.3)


def draft_temperature() -> float:
    """正文与重写用高温，换取文笔层次与画面感。"""

    return _float_env("STORYFORGE_LLM_DRAFT_TEMPERATURE", 0.85)


def planning_model() -> str | None:
    return os.getenv("STORYFORGE_LLM_PLANNING_MODEL") or None


def draft_model() -> str | None:
    return os.getenv("STORYFORGE_LLM_DRAFT_MODEL") or None
