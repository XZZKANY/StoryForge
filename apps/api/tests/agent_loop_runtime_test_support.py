from __future__ import annotations

from pathlib import Path

import pytest
from agent_transport import stream_agent_message
from fastapi.testclient import TestClient

from app.domains.agent_runs import loop_runtime
from app.domains.assistant import service as assistant_service


def _enable_loop_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(assistant_service, "missing_book_generation_env", lambda: [])
    monkeypatch.setattr(assistant_service, "resolved_llm_env", lambda: {"STORYFORGE_LLM_MODEL": "fake-model"})


def _fake_llm_script(monkeypatch: pytest.MonkeyPatch, responses: list[object]) -> list[dict[str, object]]:
    calls: list[dict[str, object]] = []

    def fake_call(source, *, messages, tools=None, tool_choice=None):  # noqa: ANN001
        calls.append({"messages": [dict(item) for item in messages], "tools": tools})
        scripted = responses[min(len(calls) - 1, len(responses) - 1)]
        if isinstance(scripted, Exception):
            raise scripted
        return dict(scripted)  # type: ignore[arg-type]

    monkeypatch.setattr(loop_runtime, "_call_llm_messages", fake_call)
    return calls


def _send_chat_message(client: TestClient, *, run_id: str, project_path: str, message: str) -> list[dict]:
    return stream_agent_message(
        client,
        f"session-{run_id}",
        run_id=run_id,
        user_message=message,
        args={
            "project_path": project_path,
            "context_bundle": {"files": []},
        },
    )


def _write_author_instructions(project_root: Path, text: str) -> None:
    storyforge = project_root / ".storyforge"
    storyforge.mkdir(exist_ok=True)
    (storyforge / "agent-instructions.md").write_text(text, encoding="utf-8")

