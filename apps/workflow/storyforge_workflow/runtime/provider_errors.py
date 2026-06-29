from __future__ import annotations

from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from enum import StrEnum
from urllib.error import HTTPError


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
