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
)
from app.common.llm_client import (
    assistant_message as _assistant_message,
)
from app.common.llm_client import (
    build_chat_payload as _build_chat_payload,
)
from app.common.llm_client import (
    call_llm as _call_llm,
)
from app.common.llm_client import (
    call_llm_messages as _call_llm_messages,
)
from app.common.llm_client import (
    cost_breakdown as _cost_breakdown,
)
from app.common.llm_client import (
    env_value as _env_value,
)
from app.common.llm_client import (
    is_retryable_status as _is_retryable_status,
)
from app.common.llm_client import (
    llm_request_headers as _llm_request_headers,
)
from app.common.llm_client import (
    message_tool_calls as _message_tool_calls,
)
from app.common.llm_client import (
    optional_float as _optional_float,
)
from app.common.llm_client import (
    optional_int as _optional_int,
)
from app.common.llm_client import (
    request_chat_completions as _request_chat_completions,
)
from app.common.llm_client import (
    required_env as _required_env,
)
from app.common.llm_client import (
    retry_after_seconds as _retry_after_seconds,
)
from app.common.llm_client import (
    sleep_before_retry as _sleep_before_retry,
)
from app.common.llm_client import (
    strip_reasoning_leak as _strip_reasoning_leak,
)
from app.common.llm_client import (
    token_usage as _token_usage,
)
from app.domains.book_runs.book_generation_metrics import float_value as _float_value
from app.domains.book_runs.errors import (  # noqa: F401 - 历史上可从本模块取到，保持零改动
    BookGenerationError,
    BookGenerationPreflightError,
)


def _total_cost_estimate(completed_chapters: list[dict[str, object]]) -> float:
    return sum(_float_value(item.get("cost_estimate")) for item in completed_chapters if isinstance(item, dict))


assistant_message = _assistant_message
build_chat_payload = _build_chat_payload
call_llm = _call_llm
call_llm_messages = _call_llm_messages
cost_breakdown = _cost_breakdown
env_value = _env_value
is_retryable_status = _is_retryable_status
llm_request_headers = _llm_request_headers
message_tool_calls = _message_tool_calls
optional_float = _optional_float
optional_int = _optional_int
request_chat_completions = _request_chat_completions
required_env = _required_env
retry_after_seconds = _retry_after_seconds
sleep_before_retry = _sleep_before_retry
strip_reasoning_leak = _strip_reasoning_leak
token_usage = _token_usage
total_cost_estimate = _total_cost_estimate
