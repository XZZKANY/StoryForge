"""LLM 调用辅助函数的 book_runs facade。

W3 起 chat/completions 出网通道已下沉到 `app/common/llm_client.py`（唯一出网点）。
本模块保留为 re-export shim（宪法第 5/6 条：facade 保持既有导入路径可达、零测试改动），
仅额外保留 book_runs 专属的成本汇总 `_total_cost_estimate`（依赖 book_generation_metrics）。
"""
from __future__ import annotations

from app.common.llm_client import (  # noqa: F401 - facade re-export，保持历史导入路径
    THINK_BLOCK_RE,
    THINK_CLOSE_RE,
    THINK_OPEN_RE,
    _assistant_message,
    _build_chat_payload,
    _call_llm,
    _call_llm_messages,
    _cost_breakdown,
    _env_value,
    _is_retryable_status,
    _llm_request_headers,
    _message_tool_calls,
    _optional_float,
    _optional_int,
    _request_chat_completions,
    _required_env,
    _retry_after_seconds,
    _sleep_before_retry,
    _strip_reasoning_leak,
    _token_usage,
)
from app.domains.book_runs.book_generation_metrics import _float_value
from app.domains.book_runs.errors import (  # noqa: F401 - 历史上可从本模块取到，保持零改动
    BookGenerationError,
    BookGenerationPreflightError,
)


def _total_cost_estimate(completed_chapters: list[dict[str, object]]) -> float:
    return sum(_float_value(item.get("cost_estimate")) for item in completed_chapters if isinstance(item, dict))
