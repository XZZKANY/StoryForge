from __future__ import annotations

from app.platform.ai_sdk.runtime.models import RuntimeLimits
from app.platform.ai_sdk.runtime.state import RuntimeState


def should_withdraw_tools(state: RuntimeState, limits: RuntimeLimits) -> bool:
    return (
        state.exhausted
        or state.tool_attempts >= limits.max_tool_calls
        or state.tool_output_chars >= limits.max_tool_output_chars
        or (
            limits.max_tokens is not None
            and state.usage_available
            and state.total_tokens >= limits.max_tokens
        )
        or (
            limits.max_cost is not None
            and state.cost_available
            and (state.total_cost or 0.0) >= limits.max_cost
        )
    )
