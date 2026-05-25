from __future__ import annotations

from dataclasses import dataclass

from storyforge_workflow.provider_client import generate_text, provider_config
from storyforge_workflow.runtime.provider_adapter import ProviderAdapter, ProviderClientAdapter, ProviderRequest


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
    adapter: ProviderAdapter | None = None,
) -> ProviderExecutionResult:
    """通过统一 ProviderAdapter 执行文本调用并返回模型运行摘要。"""

    provider_adapter = adapter or ProviderClientAdapter(generate_text_fn=generate_text, config_loader=provider_config)
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
    )

