from __future__ import annotations

from pathlib import Path

import pytest
from agent_transport import stream_agent_message
from fastapi.testclient import TestClient

from app.domains.agent_runs import loop_runtime
from app.domains.assistant import service as assistant_service
from app.platform.ai_sdk import (
    ChatResponse,
    ProviderError,
    ProviderErrorCategory,
    ProviderErrorDetails,
    TokenUsage,
    ToolCall,
)


def _enable_loop_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(assistant_service, "missing_book_generation_env", lambda: [])
    monkeypatch.setattr(assistant_service, "resolved_llm_env", lambda: {"STORYFORGE_LLM_MODEL": "fake-model"})


def _fake_llm_script(monkeypatch: pytest.MonkeyPatch, responses: list[object]) -> list[dict[str, object]]:
    calls: list[dict[str, object]] = []

    class ScriptedProvider:
        def complete(self, request):  # noqa: ANN001, ANN201
            calls.append(
                {
                    "messages": [message.to_openai() for message in request.messages],
                    "tools": [tool.to_openai() for tool in request.tools] if request.tools else None,
                }
            )
            scripted = responses[min(len(calls) - 1, len(responses) - 1)]
            if isinstance(scripted, Exception):
                raise ProviderError(
                    ProviderErrorDetails(
                        ProviderErrorCategory.INTERNAL,
                        str(scripted),
                    )
                ) from scripted
            payload = dict(scripted)  # type: ignore[arg-type]
            raw_calls = payload.get("tool_calls")
            tool_calls = tuple(
                call
                for item in raw_calls
                if isinstance(item, dict) and (call := ToolCall.from_openai(item)) is not None
            ) if isinstance(raw_calls, list) else ()
            return ChatResponse(
                content=str(payload.get("content") or ""),
                tool_calls=tool_calls,
                usage=TokenUsage.from_legacy(payload),
                metadata={
                    key: payload[key]
                    for key in ("cost_cny_estimated", "cost_breakdown")
                    if key in payload
                },
            )

    provider = ScriptedProvider()
    monkeypatch.setattr(loop_runtime, "build_llm_provider", lambda source: provider)
    return calls


def _send_chat_message(
    client: TestClient,
    *,
    run_id: str,
    project_path: str,
    message: str,
    context_bundle: dict[str, object] | None = None,
    permission_profile: str | None = None,
) -> list[dict]:
    return stream_agent_message(
        client,
        f"session-{run_id}",
        run_id=run_id,
        user_message=message,
        permission_profile=permission_profile,
        args={
            "project_path": project_path,
            "context_bundle": context_bundle if context_bundle is not None else {"files": []},
        },
    )


def _write_author_instructions(project_root: Path, text: str) -> None:
    storyforge = project_root / ".storyforge"
    storyforge.mkdir(exist_ok=True)
    (storyforge / "agent-instructions.md").write_text(text, encoding="utf-8")
