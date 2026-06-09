from __future__ import annotations

import http.client
import io
import json
import os
from random import random
from time import sleep
from urllib.error import HTTPError
from urllib.parse import urlsplit


class ContinuityGateRejected(Exception):
    """API 连续性结构门禁返回 409 时抛出，让门禁拒绝在 workflow 侧显式可见。"""

    def __init__(self, detail: str) -> None:
        self.detail = detail
        super().__init__(f"连续性结构门禁拒绝批准：{detail}")


def storyforge_api_config() -> dict[str, str]:
    """解析 workflow 调用 StoryForge API 的鉴权配置。"""

    return {
        "base_url": os.getenv("STORYFORGE_API_BASE_URL", "http://localhost:8000"),
        "api_key": os.getenv("STORYFORGE_API_KEY", "local-dev-key"),
    }


def post_chapter_approval(payload: dict[str, object]) -> dict[str, object]:
    """POST /api/continuity/chapter-approval，返回响应 JSON。

    409 → ContinuityGateRejected（携带 detail）；其余 4xx/5xx → HTTPError。
    """

    config = storyforge_api_config()
    url = f"{config['base_url'].rstrip('/')}/api/continuity/chapter-approval"
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = {
        "X-StoryForge-API-Key": config["api_key"],
        "Content-Type": "application/json",
        "Content-Length": str(len(body)),
    }
    timeout = _float_env("STORYFORGE_API_TIMEOUT_SECONDS", 30.0)
    max_attempts = _int_env("STORYFORGE_API_RETRY_MAX_ATTEMPTS", 3)
    base_delay = _float_env("STORYFORGE_API_RETRY_BASE_DELAY_SECONDS", 0.5)
    jitter = _float_env("STORYFORGE_API_RETRY_JITTER_SECONDS", 0.25)

    for attempt in range(1, max(1, max_attempts) + 1):
        try:
            return _request_json(url=url, body=body, headers=headers, timeout=timeout)
        except HTTPError as exc:
            if exc.code == 409:
                raise ContinuityGateRejected(_extract_detail(exc)) from exc
            if not _is_retryable_http_error(exc) or attempt >= max_attempts:
                raise
            _sleep_before_retry(attempt=attempt, base_delay=base_delay, jitter=jitter)
        except (http.client.HTTPException, ConnectionError, OSError):
            if attempt >= max_attempts:
                raise
            _sleep_before_retry(attempt=attempt, base_delay=base_delay, jitter=jitter)
    raise RuntimeError("StoryForge API 重试状态异常。")


def _request_json(*, url: str, body: bytes, headers: dict[str, str], timeout: float) -> dict[str, object]:
    parts = urlsplit(url)
    scheme = parts.scheme
    if scheme not in {"http", "https"}:
        raise RuntimeError(f"不支持的 StoryForge API 协议：{scheme}。")
    host = parts.hostname or ""
    if not host:
        raise RuntimeError("STORYFORGE_API_BASE_URL 缺少主机名。")
    cls = http.client.HTTPSConnection if scheme == "https" else http.client.HTTPConnection
    connection = cls(host, port=parts.port, timeout=timeout)
    path = parts.path or "/"
    if parts.query:
        path = f"{path}?{parts.query}"
    try:
        connection.request("POST", path, body=body, headers=headers)
        response = connection.getresponse()
        response_body = response.read()
        if response.status >= 400:
            raise HTTPError(
                url=url,
                code=response.status,
                msg=response.reason,
                hdrs=response.headers,
                fp=io.BytesIO(response_body),
            )
        return json.loads(response_body.decode("utf-8"))
    finally:
        connection.close()


def _extract_detail(error: HTTPError) -> str:
    try:
        data = json.loads(error.read().decode("utf-8"))
    except (ValueError, OSError):
        return str(error)
    detail = data.get("detail") if isinstance(data, dict) else None
    return str(detail) if detail else str(error)


def _is_retryable_http_error(error: HTTPError) -> bool:
    return error.code == 429 or 500 <= error.code <= 599


def _sleep_before_retry(*, attempt: int, base_delay: float, jitter: float) -> None:
    delay = max(0.0, base_delay) * (2 ** (attempt - 1))
    if jitter > 0:
        delay += random() * jitter
    sleep(delay)


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
