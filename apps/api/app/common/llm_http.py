from __future__ import annotations

import re
from collections.abc import Mapping

from app.common.logging_config import get_logger

THINK_BLOCK_RE = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)
THINK_OPEN_RE = re.compile(r"<think>", re.IGNORECASE)
THINK_CLOSE_RE = re.compile(r"</think>", re.IGNORECASE)


def strip_reasoning_leak(content: str) -> str:
    """Remove leaked reasoning tags from OpenAI-compatible model output."""

    cleaned = THINK_BLOCK_RE.sub("", content)
    # rfind 必须与 THINK_CLOSE_RE 同为大小写不敏感：否则模型吐 </Think> 变体时
    # rfind 返回 -1，切片退化成 cleaned[7:]，会静默砍掉正文前 7 个字符。
    last_close = None
    for match in THINK_CLOSE_RE.finditer(cleaned):
        last_close = match
    if last_close is not None:
        cleaned = cleaned[last_close.end() :]
    cleaned = THINK_OPEN_RE.sub("", cleaned)
    cleaned = cleaned.strip()
    if cleaned != content.strip():
        # 剥离是有损启发式：think 边界落错位置会吞正文（已实证吞标题）。留原始头尾便于归因。
        get_logger(__name__).warning(
            "llm_reasoning_leak_stripped",
            raw_chars=len(content),
            cleaned_chars=len(cleaned),
            raw_head=content[:120],
            raw_tail=content[-120:],
        )
    return cleaned


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
