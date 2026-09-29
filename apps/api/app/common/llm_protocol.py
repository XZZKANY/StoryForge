"""有限的 HTTP 协议元数据：生成装配和只读诊断共用，不是新的 provider runtime。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal
from urllib.parse import parse_qsl, unquote, urlsplit, urlunsplit

from app.common.llm_http import USER_AGENT, openai_compatible_headers
from app.common.redaction import is_sensitive_key

ProviderFamily = Literal["openai", "anthropic", "gemini"]


def provider_family(provider: str) -> ProviderFamily:
    name = provider.strip().lower()
    if name in {"anthropic", "claude"}:
        return "anthropic"
    if name in {"gemini", "google"}:
        return "gemini"
    return "openai"


def provider_headers(*, provider: str, credential: str, auth_header: str) -> dict[str, str]:
    family = provider_family(provider)
    if family == "openai":
        return openai_compatible_headers(credential=credential, auth_header=auth_header)
    headers = {"Content-Type": "application/json", "User-Agent": USER_AGENT}
    if family == "anthropic":
        headers.update({"x-api-key": credential, "anthropic-version": "2023-06-01"})
    else:
        headers["x-goog-api-key"] = credential
    return headers


class InvalidModelList(ValueError):
    """只读列表响应不符合所配置的协议；异常不携带原始响应。"""


@dataclass(frozen=True)
class ProviderModelList:
    models: tuple[str, ...]
    received_count: int
    partial: bool


def decode_model_list(data: object, *, provider: str, limit: int = 200) -> ProviderModelList:
    family = provider_family(provider)
    key, id_key = ("models", "name") if family == "gemini" else ("data", "id")
    if not isinstance(data, dict) or not isinstance(data.get(key), list):
        raise InvalidModelList("invalid_models_response")
    entries = data[key]
    models: list[str] = []
    for entry in entries:
        name = entry.get(id_key) if isinstance(entry, dict) else None
        if not isinstance(name, str) or not name.strip():
            raise InvalidModelList("invalid_model_identifier")
        if family == "gemini":
            if not name.startswith("models/") or not name.removeprefix("models/"):
                raise InvalidModelList("invalid_model_resource_name")
            name = name.removeprefix("models/")
        if len(models) < limit:
            models.append(name)
    partial = len(entries) > limit or data.get("has_more") is True or bool(data.get("nextPageToken"))
    return ProviderModelList(tuple(models), len(entries), partial)


def models_url(base_url: str, *, credential: str) -> str:
    raw = base_url
    parts = urlsplit(raw)
    if parts.scheme not in {"http", "https"} or not parts.hostname or any(ch.isspace() for ch in raw):
        raise ValueError("invalid_provider_url")
    _ = parts.port  # 拒绝畸形端口；错误文本不得回显到调用方。
    if (
        parts.username is not None
        or parts.password is not None
        or any(key.lower() == "key" or is_sensitive_key(key) for key, _ in parse_qsl(parts.query))
        or (credential and credential in unquote(raw))
    ):
        raise ValueError("credentials_in_provider_url")
    return urlunsplit((parts.scheme, parts.netloc, parts.path.rstrip("/") + "/models", parts.query, ""))
