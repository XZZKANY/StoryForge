from __future__ import annotations

from dataclasses import dataclass, field

from storyforge_workflow.runtime.provider_adapter import (
    ProviderAdapter,
    ProviderRequest,
    build_default_provider_adapter,
)

__all__ = [
    "ProviderExecutionResult",
    "execute_provider_text",
]


@dataclass(frozen=True)
class ProviderExecutionResult:
    capability: str
    provider_name: str
    model_name: str
    latency_ms: int
    token_usage: int
    summary: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost_estimate: float = 0.0
    finish_reason: str | None = None
    error_kind: str | None = None
    retry_after_seconds: int | None = None
    fallback_metadata: dict[str, object] | None = field(default=None)


def execute_provider_text(
    *,
    capability: str,
    prompt_summary: str,
    adapter: ProviderAdapter | None = None,
) -> ProviderExecutionResult:
    """通过统一 ProviderAdapter 执行文本调用并返回模型运行摘要。"""

    provider_adapter = adapter or build_default_provider_adapter()
    response = provider_adapter.generate(
        ProviderRequest(
            capability=capability,
            prompt=prompt_summary,
            model_alias=None,
            metadata={},
        )
    )
    return ProviderExecutionResult(
        capability=capability,
        provider_name=response.provider_name,
        model_name=response.model_name,
        latency_ms=response.latency_ms,
        token_usage=response.token_usage,
        summary=response.output_text,
        prompt_tokens=response.prompt_tokens,
        completion_tokens=response.completion_tokens,
        cost_estimate=response.cost_estimate,
        finish_reason=response.finish_reason,
        fallback_metadata=response.fallback_metadata,
    )
