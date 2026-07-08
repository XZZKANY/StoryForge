from __future__ import annotations

import os
import re
from collections.abc import Iterable, Mapping
from typing import Any

REDACTED = "[REDACTED]"

_SENSITIVE_EXACT_KEYS = {
    "apikey",
    "authorization",
    "authtoken",
    "bearer",
    "credential",
    "credentials",
    "password",
    "passwd",
    "secret",
    "token",
}
_SENSITIVE_KEY_TOKENS = {
    "authorization",
    "bearer",
    "credential",
    "credentials",
    "password",
    "passwd",
    "secret",
}
_SAFE_DIAGNOSTIC_SUFFIXES = {
    "available",
    "configured",
    "enabled",
    "present",
    "required",
    "status",
}
_TOKEN_PATTERN = re.compile(r"[^A-Za-z0-9]+|(?<=[a-z])(?=[A-Z])")
_SECRET_ENV_KEY_PATTERN = re.compile(r"(API[_-]?KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)", re.IGNORECASE)
_ASSIGNMENT_PATTERNS = (
    re.compile(
        r"(?i)\b(api[-_ ]?key|authorization|bearer|token|password|secret|credential)\s*[:=]\s*"
        r"([A-Za-z0-9._:/+=@\-]{6,})"
    ),
    re.compile(r"(?i)\bBearer\s+([A-Za-z0-9._:/+=@\-]{6,})"),
)
_TOKEN_VALUE_PATTERNS = (
    re.compile(r"\bsk-[A-Za-z0-9][A-Za-z0-9._\-]{6,}\b"),
    re.compile(r"\b(?:secret|credential|password|token|api[-_]?key)-[A-Za-z0-9._\-]{4,}\b", re.IGNORECASE),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9_]{20,}\b"),
    re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b"),
    re.compile(r"\bAIza[A-Za-z0-9_\-]{20,}\b"),
)


def is_sensitive_key(key: object) -> bool:
    """Return whether a mapping key names a credential-like value."""

    if not isinstance(key, str) or not key:
        return False
    tokens = [part.lower() for part in _TOKEN_PATTERN.split(key) if part]
    if _is_safe_diagnostic_key(tokens):
        return False
    normalized = re.sub(r"[^A-Za-z0-9]", "", key).lower()
    if normalized in _SENSITIVE_EXACT_KEYS or "apikey" in normalized:
        return True
    if any(token in _SENSITIVE_KEY_TOKENS for token in tokens):
        return True
    pairs = set(zip(tokens, tokens[1:], strict=False))
    if (
        ("api", "key") in pairs
        or ("api", "token") in pairs
        or ("access", "token") in pairs
        or ("refresh", "token") in pairs
        or ("auth", "token") in pairs
        or ("bearer", "token") in pairs
    ):
        return True
    return tokens == ["auth"] or tokens == ["token"]


def _is_safe_diagnostic_key(tokens: list[str]) -> bool:
    if len(tokens) < 2:
        return False
    if tokens[0] in {"has", "is"}:
        return True
    return tokens[-1] in _SAFE_DIAGNOSTIC_SUFFIXES


def redact_sensitive(value: Any, *, extra_secrets: Iterable[str | None] = ()) -> Any:
    """Recursively redact secret-bearing keys and token-like strings."""

    if isinstance(value, Mapping):
        redacted: dict[str, Any] = {}
        for key, item in value.items():
            rendered_key = str(key)
            redacted[rendered_key] = (
                REDACTED if is_sensitive_key(rendered_key) else redact_sensitive(item, extra_secrets=extra_secrets)
            )
        return redacted
    if isinstance(value, list | tuple | set):
        return [redact_sensitive(item, extra_secrets=extra_secrets) for item in value]
    if isinstance(value, str):
        return redact_sensitive_text(value, extra_secrets=extra_secrets)
    return value


def redact_sensitive_text(text: str, *, extra_secrets: Iterable[str | None] = ()) -> str:
    """Redact configured secrets and common provider-token shapes from free text."""

    redacted = text
    for secret in _configured_secret_values(extra_secrets):
        redacted = redacted.replace(secret, REDACTED)
    for pattern in _ASSIGNMENT_PATTERNS:
        redacted = pattern.sub(lambda match: match.group(0).replace(match.group(match.lastindex), REDACTED), redacted)
    for pattern in _TOKEN_VALUE_PATTERNS:
        redacted = pattern.sub(REDACTED, redacted)
    return redacted


def redact_validation_errors(errors: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Sanitize FastAPI/Pydantic validation errors before returning 422 details."""

    redacted: list[dict[str, Any]] = []
    for error in errors:
        item = redact_sensitive(error)
        loc = item.get("loc") if isinstance(item, dict) else None
        if isinstance(item, dict) and _loc_has_sensitive_key(loc):
            if "input" in item:
                item["input"] = REDACTED
            if isinstance(item.get("ctx"), dict):
                item["ctx"] = redact_sensitive(item["ctx"])
        redacted.append(item)
    return redacted


def _loc_has_sensitive_key(loc: object) -> bool:
    if not isinstance(loc, list | tuple):
        return False
    return any(is_sensitive_key(part) for part in loc)


def _configured_secret_values(extra_secrets: Iterable[str | None]) -> list[str]:
    values: list[str] = []
    values.extend(secret for secret in extra_secrets if isinstance(secret, str))
    for key, value in os.environ.items():
        if _SECRET_ENV_KEY_PATTERN.search(key):
            values.append(value)
    try:
        from app.common.config import get_settings

        settings = get_settings()
        for name in (
            "storyforge_api_key",
            "storyforge_jwt_secret",
            "storyforge_llm_api_key",
            "storyforge_embedding_api_key",
            "s3_secret_key",
        ):
            value = getattr(settings, name, None)
            if isinstance(value, str):
                values.append(value)
    except Exception:
        pass
    return sorted({value for value in values if len(value) >= 6}, key=len, reverse=True)
