from __future__ import annotations

import re
from collections.abc import Mapping

from app.common.logging_config import get_logger
from app.common.version import APP_VERSION

# 出网必须自报身份：urllib 缺省 UA 是 "Python-urllib/3.x"，Cloudflare 默认 WAF 规则直接
# 403（error code 1010，"banned based on browser signature"）。BYO-key 作者接任意
# OpenAI 兼容中转站时，这条会表现为「key 明明有效却全线 403」且报错不说原因。
# 实测（2026-08-01，api.yunsuisui.lol）：缺省 UA 403，任何显式 UA 均 200。
USER_AGENT = f"StoryForge/{APP_VERSION}"

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


_THINK_OPEN_TEXT = "<think>"


class StreamingReasoningFilter:
    """`strip_reasoning_leak` 的增量等价物，供流式续写逐块放行正文。

    整段版可以回看全文再决定切哪里，流式不能：已经吐给前端的字收不回来。故只覆盖真实
    泄漏形状——模型在正文前先吐 `<think>…</think>`：在能判定开头不是 think 块之前一律
    缓冲，见到闭合标签就丢弃其前全部。流末残留缓冲再跑一次整段版兜底（覆盖 think 块未
    闭合就截断的情况）。
    """

    def __init__(self) -> None:
        self._buffer = ""
        self._passthrough = False
        self._stripped = False

    @property
    def stripped(self) -> bool:
        return self._stripped

    def feed(self, chunk: str) -> str:
        if not chunk:
            return ""
        if self._passthrough:
            return chunk
        self._buffer += chunk
        last_close = None
        for match in THINK_CLOSE_RE.finditer(self._buffer):
            last_close = match
        if last_close is not None:
            remainder = self._buffer[last_close.end() :]
            self._buffer = ""
            self._passthrough = True
            self._stripped = True
            return remainder.lstrip()
        leading = self._buffer.lstrip().lower()
        if leading.startswith(_THINK_OPEN_TEXT):
            return ""
        if _THINK_OPEN_TEXT.startswith(leading):
            # 还不足以判定（可能只收到 "<th"），继续缓冲而不是猜。
            return ""
        emitted = self._buffer
        self._buffer = ""
        self._passthrough = True
        return emitted

    def flush(self) -> str:
        if not self._buffer:
            return ""
        remaining = self._buffer
        self._buffer = ""
        cleaned = strip_reasoning_leak(remaining)
        if cleaned != remaining:
            self._stripped = True
        return cleaned


def env_value(source: Mapping[str, str | None], name: str) -> str:
    value = source.get(name)
    return value.strip() if value and value.strip() else ""


def optional_int(source: Mapping[str, str | None], name: str, default: int) -> int:
    value = env_value(source, name)
    if not value:
        return default
    try:
        return int(value)
    except ValueError:
        # 畸形数值配置（如 STORYFORGE_LLM_TIMEOUT_SECONDS=30s）回退默认值，不冒泡成不脱敏 500
        # （C2-001；对齐 db/session._get_int_env、auth._jwt_expiry_seconds 守卫惯例）。
        return default


def optional_float(source: Mapping[str, str | None], name: str, default: float) -> float:
    value = env_value(source, name)
    if not value:
        return default
    try:
        return float(value)
    except ValueError:
        return default


def openai_compatible_headers(*, credential: str, auth_header: str) -> dict[str, str]:
    headers = {"Content-Type": "application/json", "User-Agent": USER_AGENT}
    if auth_header == "api-key":
        headers["api-key"] = credential
        return headers
    if auth_header != "bearer":
        raise ValueError("unsupported_auth_header")
    headers["Authorization"] = f"Bearer {credential}"
    return headers
