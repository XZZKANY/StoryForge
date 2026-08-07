from __future__ import annotations

import json

import pytest

from app.common.llm_env import ResolvedPolishLlm
from app.domains.agent_runs.patches import run_controlled_polish, validate_polishable_path
from app.platform.ai_sdk.contracts import ChatRequest, ChatResponse, TokenUsage
from app.platform.ai_sdk.errors import ProviderError, ProviderErrorCategory, ProviderErrorDetails
from app.platform.ai_sdk.provider import ProviderHealth


class FakeProvider:
    def __init__(self, response: ChatResponse | Exception) -> None:
        self.response = response
        self.requests: list[ChatRequest] = []

    def complete(self, request: ChatRequest) -> ChatResponse:
        self.requests.append(request)
        if isinstance(self.response, Exception):
            raise self.response
        return self.response

    def stream(self, request):  # pragma: no cover - polishing uses complete
        raise NotImplementedError

    def health(self):  # pragma: no cover - protocol completeness
        return ProviderHealth()

    def capabilities(self, model):  # pragma: no cover - protocol completeness
        raise NotImplementedError


def _resolution() -> ResolvedPolishLlm:
    return ResolvedPolishLlm(
        resolution_source="dedicated",
        provider="anthropic",
        model="polish-model",
        source={
            "STORYFORGE_LLM_PROVIDER": "anthropic",
            "STORYFORGE_LLM_BASE_URL": "https://example/v1",
            "STORYFORGE_LLM_MODEL": "polish-model",
            "STORYFORGE_LLM_API_KEY": "secret-key",
        },
    )


def _response(parts: list[str], *, finish_reason: str = "stop") -> ChatResponse:
    return ChatResponse(
        content=json.dumps(
            {"segments": [{"index": index, "text": text} for index, text in enumerate(parts)]},
            ensure_ascii=False,
        ),
        usage=TokenUsage(input_tokens=10, output_tokens=8, total_tokens=18, source="provider_usage"),
        finish_reason=finish_reason,
    )


def test_model_never_receives_protected_markdown() -> None:
    original = "---\ntitle: 密档\n---\n# 第一章\n\n林岚推开门，，握紧刀。\n```json\n{\"secret\":1}\n```\n"
    provider = FakeProvider(_response(["\n林岚推开门，握紧刀。\n"]))

    result = run_controlled_polish(
        original,
        resolution=_resolution(),
        provider=provider,
        protected_entities=("林岚",),
        character_constraints=({"name": "林岚", "notes": "谨慎寡言"},),
        continuity_facts=({"statement": "旧灯塔已经停用"},),
        required_facts=("林岚持有铜钥匙",),
    )

    sent = "\n".join(message.content or "" for message in provider.requests[0].messages)
    payload = json.loads(provider.requests[0].messages[-1].content or "{}")
    assert "title: 密档" not in sent
    assert '"secret":1' not in sent
    assert payload["constraints"] == {
        "protected_entities": ["林岚"],
        "character_constraints": [{"name": "林岚", "notes": "谨慎寡言"}],
        "continuity_facts": [{"statement": "旧灯塔已经停用"}],
        "required_facts": ["林岚持有铜钥匙"],
    }
    assert result.decision.selected_source == "online"
    assert "title: 密档" in result.decision.text
    assert '"secret":1' in result.decision.text


def test_invalid_online_response_falls_back_to_passing_local_candidate() -> None:
    original = "# 第一章\n\n林岚推开门，，握紧刀！！她转身看向巷口，又停下。"
    provider = FakeProvider(ChatResponse(content="不是 JSON"))

    result = run_controlled_polish(original, resolution=_resolution(), provider=provider)

    assert result.decision.status == "degraded"
    assert result.decision.selected_source == "local"
    assert result.online_failure == "invalid_model_response"


def test_provider_failure_is_redacted_to_reason_code() -> None:
    original = "# 第一章\n\n林岚推开门，，握紧刀！！她转身看向巷口，又停下。"
    provider = FakeProvider(
        ProviderError(
            ProviderErrorDetails(
                ProviderErrorCategory.CONNECTION,
                "upstream leaked secret-key",
                provider_code="transport_error",
            )
        )
    )

    result = run_controlled_polish(original, resolution=_resolution(), provider=provider)
    summary = result.trace_summary()

    assert summary["online_failure"] == "provider_failed"
    assert "secret-key" not in json.dumps(summary, ensure_ascii=False)


def test_truncated_online_candidate_cannot_win() -> None:
    original = "# 第一章\n\n林岚推开门，，握紧刀！！她转身看向巷口，又停下。"
    provider = FakeProvider(_response(["\n林岚推开门，握紧刀！她转身看向巷口，又停下。"], finish_reason="length"))

    result = run_controlled_polish(original, resolution=_resolution(), provider=provider)

    assert result.decision.selected_source == "local"
    assert result.decision.status == "degraded"
    assert "response_truncated" in result.decision.evaluations["online"].reasons


@pytest.mark.parametrize(
    "path",
    [
        ".storyforge/canon/canon.json",
        "evidence/run.md",
        "正文/state.json",
        "../outside.md",
        "C:/outside.md",
    ],
)
def test_structured_or_out_of_scope_paths_are_rejected(path: str) -> None:
    with pytest.raises(ValueError):
        validate_polishable_path(path)


def test_manuscript_paths_are_accepted() -> None:
    assert validate_polishable_path("正文/第十二章.md") == "正文/第十二章.md"
    assert validate_polishable_path("chapters/chapter-12.txt") == "chapters/chapter-12.txt"
