from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ProviderExecutionResult:
    capability: str
    provider_name: str
    model_name: str
    latency_ms: int
    token_usage: int
    summary: str


def simulate_provider_execution(
    *,
    capability: str,
    provider_name: str,
    model_name: str,
    prompt_summary: str,
) -> ProviderExecutionResult:
    """用确定性假结果替代真实模型调用，便于本地运行时测试。"""

    token_usage = max(16, len(prompt_summary) // 4)
    latency_ms = 120 + len(prompt_summary) % 80
    return ProviderExecutionResult(
        capability=capability,
        provider_name=provider_name,
        model_name=model_name,
        latency_ms=latency_ms,
        token_usage=token_usage,
        summary=f"{provider_name}/{model_name} 已完成 {capability} 调用。",
    )

