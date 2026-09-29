from __future__ import annotations

import pytest

from app.common.llm_control import LLMRunInterrupted
from app.platform.ai_sdk import ChatMessage, MessageRole, TokenUsage
from app.platform.ai_sdk.errors import ProviderError, ProviderErrorCategory, ProviderErrorDetails
from app.platform.ai_sdk.providers import DeterministicProvider
from app.platform.ai_sdk.runtime import RuntimeResultStatus, ToolCallingRuntime
from app.platform.ai_sdk.tools import ToolRegistry


@pytest.mark.parametrize("cancelled", [False, True])
def test_provider_error_accounting_is_recorded_before_failure_or_control_settlement(cancelled):
    usage = TokenUsage(10, 2, 12, source="provider_usage")
    failure = ProviderError(ProviderErrorDetails(ProviderErrorCategory.CONNECTION, "fixture failed"), usage=usage)
    provider = DeterministicProvider(responses=[failure])
    runtime = ToolCallingRuntime(
        provider,
        ToolRegistry([]),
        interruption=lambda _run, boundary, _checkpoint: "stopped" if cancelled and boundary == "model_error" else None,
    )
    result = runtime.run([ChatMessage(MessageRole.USER, "fixture")], model="fixture", run_id="failed-usage")
    assert result.total_tokens == 12
    assert result.usage_available
    assert result.status is (RuntimeResultStatus.INTERRUPTED if cancelled else RuntimeResultStatus.FAILED)
    assert len(provider.requests) == 1


def test_cooperative_error_accounting_is_recorded_before_interruption():
    usage = TokenUsage(10, 2, 12, source="provider_usage")

    class InterruptedProvider(DeterministicProvider):
        def complete(self, request):
            self.requests.append(request)
            raise LLMRunInterrupted("stopped", usage=usage)

    provider = InterruptedProvider()
    runtime = ToolCallingRuntime(
        provider,
        ToolRegistry([]),
        interruption=lambda _run, boundary, _checkpoint: "stopped" if boundary == "model_error" else None,
    )
    result = runtime.run([ChatMessage(MessageRole.USER, "fixture")], model="fixture", run_id="cancelled-usage")
    assert result.total_tokens == 12
    assert result.usage_available
    assert result.status is RuntimeResultStatus.INTERRUPTED
    assert len(provider.requests) == 1
