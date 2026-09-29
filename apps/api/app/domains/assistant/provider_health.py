"""模型服务诊断 owner：一次配置快照、只读请求与安全显示，不做模型生成。"""

from __future__ import annotations

import http.client
import json
import math
import time
from collections.abc import Callable, Mapping
from typing import Literal, Protocol
from urllib import error
from urllib.parse import quote, urlsplit, urlunsplit

from app.common.llm_client import LLMConfigError
from app.common.llm_config_file import LlmConfigError
from app.common.llm_http import env_value, optional_float
from app.common.llm_protocol import InvalidModelList, decode_model_list
from app.common.redaction import redact_sensitive_text
from app.domains.assistant.schemas import ProviderHealthResponse

PROBE_TIMEOUT_CAP_SECONDS = 15.0
Source = Mapping[str, str | None]


class ModelsFetcher(Protocol):
    def __call__(self, source: Source, *, timeout: float) -> object: ...


def _safe_text(value: str, source: Source) -> str:
    secret = env_value(source, "STORYFORGE_LLM_API_KEY")
    # 这里持有实际 source，短 key 也不能借通用 redactor 的最小长度规则漏出。
    if secret:
        for form in sorted({secret, quote(secret, safe="")}, key=len, reverse=True):
            value = value.replace(form, "[REDACTED]")
    return redact_sensitive_text(value)


def _display_url(source: Source) -> str | None:
    try:
        parts = urlsplit(env_value(source, "STORYFORGE_LLM_BASE_URL"))
    except ValueError:
        return None
    if parts.scheme not in {"http", "https"} or not parts.hostname:
        return None
    value = urlunsplit((parts.scheme, parts.netloc.rsplit("@", 1)[-1], parts.path, "", ""))
    return _safe_text(value, source)


def probe_provider_health(
    *,
    resolve_source: Callable[[], Source],
    missing_env: Callable[[Source], list[str]],
    fetch_models: ModelsFetcher,
) -> ProviderHealthResponse:
    try:
        source = resolve_source()
        missing = missing_env(source)
    except LlmConfigError:
        return ProviderHealthResponse(
            status="misconfigured",
            reachable=False,
            detail="本地 LLM 配置不可用，请在桌面设置中检查或重新保存。",
        )
    if missing:
        return ProviderHealthResponse(
            status="misconfigured",
            reachable=False,
            missing_env=missing,
            detail="真实 LLM 未配置，缺少环境变量：" + ", ".join(missing),
        )
    identity = {
        "base_url": _display_url(source),
        "model": _safe_text(env_value(source, "STORYFORGE_LLM_MODEL"), source) or None,
    }
    timeout = optional_float(source, "STORYFORGE_LLM_TIMEOUT_SECONDS", 300.0)
    timeout = (
        min(timeout, PROBE_TIMEOUT_CAP_SECONDS) if math.isfinite(timeout) and timeout > 0 else PROBE_TIMEOUT_CAP_SECONDS
    )
    started_at = time.monotonic()

    def failure(
        status: Literal["unreachable", "unauthorized", "misconfigured"], detail: str, *, reachable: bool = False
    ) -> ProviderHealthResponse:
        return ProviderHealthResponse(
            status=status,
            reachable=reachable,
            **identity,
            latency_ms=max(0, int((time.monotonic() - started_at) * 1000)),
            detail=detail,
        )

    try:
        data = fetch_models(source, timeout=timeout)
        listing = decode_model_list(data, provider=env_value(source, "STORYFORGE_LLM_PROVIDER"))
    except error.HTTPError as exc:
        # 不读/拼接不可信 body、reason、headers，避免密钥反射及截断泄漏。
        exc.close()
        if exc.code in (401, 403):
            return failure("unauthorized", f"鉴权失败：HTTP {exc.code}（请检查密钥配置）。", reachable=True)
        return failure("unreachable", f"模型列表探测返回 HTTP {exc.code}。")
    except (json.JSONDecodeError, UnicodeDecodeError, InvalidModelList):
        return failure("unreachable", "模型列表响应格式无效，无法完成诊断。")
    except (error.URLError, OSError, http.client.HTTPException):
        return failure("unreachable", f"连接失败或响应读取超时（timeout={timeout}s）。")
    except (LLMConfigError, ValueError):
        return failure("misconfigured", "模型连接配置无效；请检查 HTTP(S) 地址和鉴权方式，凭据只能配置在密钥项。")
    return ProviderHealthResponse(
        status="ok",
        reachable=True,
        **identity,
        latency_ms=max(0, int((time.monotonic() - started_at) * 1000)),
        model_count=listing.received_count,
        models=[_safe_text(name, source) for name in listing.models],
        detail="仅显示本次探测返回的部分模型；模型数量不是完整总数。" if listing.partial else None,
    )
