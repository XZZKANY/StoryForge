from __future__ import annotations

from storyforge_workflow.provider_client import ChatCompletionUsage

# 粗粒度成本估算（USD per 1K token），仅用于内部观测，不参与计费。
COST_PER_1K_TOKENS = {
    "gpt-4o-mini": (0.00015, 0.0006),
    "gpt-4o": (0.005, 0.015),
    "gpt-4.1-mini": (0.00015, 0.0006),
    "gpt-4.1": (0.005, 0.015),
    "deepseek-chat": (0.00014, 0.00028),
}


def _estimate_token_count(text: str) -> int:
    return max(1, len(text) // 4)


def _estimate_cost(model_name: str, prompt_tokens: int, completion_tokens: int) -> float:
    rates = COST_PER_1K_TOKENS.get(model_name.lower())
    if rates is None:
        return 0.0
    prompt_rate, completion_rate = rates
    cost = (prompt_tokens / 1000) * prompt_rate + (completion_tokens / 1000) * completion_rate
    return round(cost, 6)


def _resolve_usage(
    *,
    usage: ChatCompletionUsage | None,
    prompt: str,
    output_text: str,
) -> tuple[int, int, int]:
    if usage is None:
        prompt_tokens = _estimate_token_count(prompt)
        completion_tokens = _estimate_token_count(output_text)
        return prompt_tokens, completion_tokens, max(1, prompt_tokens + completion_tokens)
    prompt_tokens = max(0, usage.prompt_tokens)
    completion_tokens = max(0, usage.completion_tokens)
    total_tokens = max(0, usage.total_tokens)
    if total_tokens == 0:
        total_tokens = prompt_tokens + completion_tokens
    return prompt_tokens, completion_tokens, total_tokens


def _chat_completion_usage_from_payload(value: object) -> ChatCompletionUsage | None:
    if not isinstance(value, dict):
        return None
    prompt_tokens = _optional_nonnegative_int(value.get("prompt_tokens"))
    completion_tokens = _optional_nonnegative_int(value.get("completion_tokens"))
    total_tokens = _optional_nonnegative_int(value.get("total_tokens"))
    if prompt_tokens is None and completion_tokens is None and total_tokens is None:
        return None
    resolved_prompt = prompt_tokens or 0
    resolved_completion = completion_tokens or 0
    resolved_total = total_tokens if total_tokens is not None else resolved_prompt + resolved_completion
    return ChatCompletionUsage(
        prompt_tokens=resolved_prompt,
        completion_tokens=resolved_completion,
        total_tokens=resolved_total,
    )


def _optional_nonnegative_int(value: object) -> int | None:
    if type(value) is int and value >= 0:
        return value
    return None
