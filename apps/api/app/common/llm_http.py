from __future__ import annotations

import re
from collections.abc import Mapping

THINK_BLOCK_RE = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)
THINK_OPEN_RE = re.compile(r"<think>", re.IGNORECASE)
THINK_CLOSE_RE = re.compile(r"</think>", re.IGNORECASE)


def strip_reasoning_leak(content: str) -> str:
    """Remove leaked reasoning tags from OpenAI-compatible model output."""

    cleaned = THINK_BLOCK_RE.sub("", content)
    if THINK_CLOSE_RE.search(cleaned):
        cleaned = cleaned[cleaned.rfind("</think>") + len("</think>") :]
    cleaned = THINK_OPEN_RE.sub("", cleaned)
    return cleaned.strip()


def env_value(source: Mapping[str, str | None], name: str) -> str:
    value = source.get(name)
    return value.strip() if value and value.strip() else ""


def optional_int(source: Mapping[str, str | None], name: str, default: int) -> int:
    value = env_value(source, name)
    return int(value) if value else default


def optional_float(source: Mapping[str, str | None], name: str, default: float) -> float:
    value = env_value(source, name)
    return float(value) if value else default


def openai_compatible_headers(*, credential: str, auth_header: str) -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if auth_header == "api-key":
        headers["api-key"] = credential
        return headers
    if auth_header != "bearer":
        raise ValueError("unsupported_auth_header")
    headers["Authorization"] = f"Bearer {credential}"
    return headers
