from __future__ import annotations

from dataclasses import dataclass
from time import perf_counter

from storyforge_workflow.provider_client import generate_text, provider_config


@dataclass(frozen=True)
class ProviderExecutionResult:
    capability: str
    provider_name: str
    model_name: str
    latency_ms: int
    token_usage: int
    summary: str


def execute_provider_text(
    *,
    capability: str,
    prompt_summary: str,
) -> ProviderExecutionResult:
    """执行真实 provider 文本调用并返回模型运行摘要。"""

    config = provider_config()
    started_at = perf_counter()
    summary = generate_text(prompt_summary)
    latency_ms = int((perf_counter() - started_at) * 1000)
    return ProviderExecutionResult(
        capability=capability,
        provider_name=config["provider_name"],
        model_name=config["model"],
        latency_ms=latency_ms,
        token_usage=max(1, (len(prompt_summary) + len(summary)) // 4),
        summary=summary,
    )

