from __future__ import annotations

import re
from collections.abc import Iterable
from typing import Any

REDACTED = "[REDACTED]"

_SAFE_DIAGNOSTIC_KEYS = {
    "credentialstatus",
    "hasapikey",
    "hascredential",
    "hascredentials",
    "secrethitcount",
    "tokenbudget",
    "tokencount",
    "tokenusage",
    "inputtokens",
    "outputtokens",
}
_SENSITIVE_KEY_SUFFIXES = (
    "apikey",
    "authorization",
    "authtoken",
    "accesstoken",
    "refreshtoken",
    "idtoken",
    "password",
    "passwd",
    "secret",
    "clientsecret",
    "credential",
    "credentials",
)
_SENSITIVE_EXACT_KEYS = {"auth", "bearer", "token"}
_TEXT_PATTERNS = (
    re.compile(r"(?i)\bBearer\s+[^\s,;\"']+"),
    re.compile(r"(?i)\bsk-[A-Za-z0-9_-]{8,}"),
    re.compile(
        r"(?i)\b(api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)"
        r"(\s*[:=]\s*)[^\s,;\"']+"
    ),
)


def _normalized_key(key: object) -> str:
    return re.sub(r"[^a-z0-9]", "", str(key).lower())


def is_sensitive_key(key: object) -> bool:
    normalized = _normalized_key(key)
    if normalized in _SAFE_DIAGNOSTIC_KEYS:
        return False
    return normalized in _SENSITIVE_EXACT_KEYS or normalized.endswith(_SENSITIVE_KEY_SUFFIXES)


def redact_sensitive_text(
    text: str,
    *,
    extra_secrets: Iterable[str | None] = (),
) -> str:
    redacted = text
    for secret in extra_secrets:
        if secret:
            redacted = redacted.replace(secret, REDACTED)
    for pattern in _TEXT_PATTERNS:
        if pattern.groups:
            redacted = pattern.sub(lambda match: f"{match.group(1)}{match.group(2)}{REDACTED}", redacted)
        else:
            redacted = pattern.sub(REDACTED, redacted)
    return redacted


def redact_sensitive(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: REDACTED if is_sensitive_key(key) else redact_sensitive(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [redact_sensitive(item) for item in value]
    if isinstance(value, tuple):
        return tuple(redact_sensitive(item) for item in value)
    if isinstance(value, str):
        return redact_sensitive_text(value)
    return value


def redact_validation_errors(errors: list[dict[str, Any]]) -> list[dict[str, Any]]:
    sanitized: list[dict[str, Any]] = []
    for error in errors:
        item = redact_sensitive(error)
        location = error.get("loc", ())
        if isinstance(location, (list, tuple)) and location and is_sensitive_key(location[-1]):
            item["input"] = REDACTED
        sanitized.append(item)
    return sanitized
