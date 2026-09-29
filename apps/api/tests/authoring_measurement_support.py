"""Synthetic fixtures shared by stage regressions and the offline experiment runner."""

from __future__ import annotations

import json

from app.common.llm_env import ResolvedPolishLlm
from app.domains.assistant.revision import RevisionInput
from app.platform.ai_sdk.contracts import ChatResponse, TokenUsage
from app.platform.ai_sdk.errors import ProviderError, ProviderErrorCategory, ProviderErrorDetails

FIXTURE_VERSION = "authoring-feedback-v1"
BODY = "林岚推开门，，握紧刀！！她转身看向巷口，又停下。"


def fixture_text(lines: int = 1) -> str:
    return "# 第一章\n\n" + "\n".join([BODY] * lines)


def fixture_resolution() -> ResolvedPolishLlm:
    return ResolvedPolishLlm(
        resolution_source="dedicated",
        provider="anthropic",
        model="synthetic-model",
        source={
            "STORYFORGE_LLM_PROVIDER": "anthropic",
            "STORYFORGE_LLM_MODEL": "synthetic-model",
            "STORYFORGE_LLM_BASE_URL": "https://fixture.invalid/v1",
            "STORYFORGE_LLM_API_KEY": "fixture-only-key",
        },
    )


def fixture_revision(content: str, *, gated: bool = False) -> RevisionInput:
    return RevisionInput(
        file_path="正文/第01章.md",
        content=content,
        instruction="保守润色",
        system_prompt="offline fixture",
        quality_gate="polish" if gated else None,
    )


class SyntheticPolishProvider:
    def __init__(self, scenario: str = "success") -> None:
        self.scenario = scenario
        self.calls = 0

    def complete(self, request):
        self.calls += 1
        if self.scenario == "provider_failure":
            raise ProviderError(ProviderErrorDetails(ProviderErrorCategory.CONNECTION, "PRIVATE fixture failure"))
        if self.scenario == "invalid_json":
            return ChatResponse(content="PRIVATE invalid response")
        payload = json.loads(request.messages[-1].content)
        parts = payload["segments"]
        for part in parts:
            if self.scenario != "noop":
                part["text"] = part["text"].replace("，，", "，").replace("！！", "！")
        return ChatResponse(
            content=json.dumps({"segments": parts}, ensure_ascii=False),
            usage=TokenUsage(input_tokens=10, output_tokens=8, total_tokens=18, source="synthetic"),
            finish_reason="length" if self.scenario == "truncated" else "stop",
        )
