from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast

import pytest
from agent_loop_runtime_test_support import (
    _enable_loop_env,
    _fake_llm_script,
    _send_chat_message,
)
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.domains.agent_runs import loop_runtime
from app.domains.agent_runs.loop.sdk_adapters import (
    StoryForgeFeedbackFormatter,
    StoryForgeRuntimePolicy,
    StoryForgeToolSelector,
    build_storyforge_tool_registry,
)
from app.domains.agent_runs.loop.sdk_context import StoryForgeRuntimeContext
from app.domains.agent_runs.loop.types import ChatLoopOutcome
from app.domains.agent_runs.models import AgentRun
from app.domains.agent_runs.permission import PermissionDecision, PermissionGate
from app.domains.agent_runs.tools import (
    ToolResult,
    build_loop_tool_schemas,
    list_loop_tool_specs,
    loop_patch_tool_specs,
    tool_definition_from_spec,
)
from app.domains.agent_runs.trace import AgentToolTrace
from app.platform.ai_sdk import RuntimeToolResult, ToolCall
from app.platform.ai_sdk.runtime import PendingToolCall, PolicyDecisionKind

pytest_plugins = ("agent_loop_runtime_test_fixtures",)


def _context(*, profile: str = "ask", permission_gate: Any = None) -> StoryForgeRuntimeContext:
    definitions = {
        spec.name: tool_definition_from_spec(spec, _unused_handler)
        for spec in list_loop_tool_specs()
    }
    return StoryForgeRuntimeContext(
        session=cast(Session, object()),
        assistant_session_id=1,
        run=cast(AgentRun, SimpleNamespace(public_id="run-adapter", permission_profile=profile)),
        source={"STORYFORGE_LLM_MODEL": "deterministic"},
        permission_gate=permission_gate or PermissionGate(),
        definitions=definitions,
        execute_tool=lambda name, arguments: _unused_handler(None, arguments),
        on_trace=lambda trace: None,
        outcome=ChatLoopOutcome(answer=""),
    )


def _unused_handler(context, payload: dict[str, Any]) -> ToolResult:  # noqa: ANN001
    del context
    return ToolResult(
        status="completed",
        output=payload,
        trace=AgentToolTrace("test", "completed", {}),
    )


def test_storyforge_tool_projection_preserves_schema_order_and_names() -> None:
    context = _context()
    registry = build_storyforge_tool_registry(context)

    assert [tool.spec.to_openai() for tool in registry.all()] == build_loop_tool_schemas()
    assert [tool.metadata["registry_name"] for tool in registry.all()] == [
        spec.name for spec in list_loop_tool_specs()
    ]


@pytest.mark.parametrize(
    ("profile", "expected"),
    [("read", PolicyDecisionKind.DENY), ("ask", PolicyDecisionKind.ALLOW)],
)
def test_storyforge_policy_preserves_write_pending_permission(profile: str, expected) -> None:  # noqa: ANN001
    context = _context(profile=profile)
    tool = build_storyforge_tool_registry(context).get("file_create")
    decision = StoryForgeRuntimePolicy(context).decide_tool(
        tool,
        PendingToolCall("c1", "file_create", {"path": "正文/第02章.md"}),
        context,
    )

    assert decision.kind is expected


def test_storyforge_policy_strips_model_supplied_confirmation_before_gate() -> None:
    captured: dict[str, Any] = {}

    class CapturingGate:
        def decide(self, run, tool, *, payload=None):  # noqa: ANN001, ANN202
            del run, tool
            captured.update(payload or {})
            return PermissionDecision("allow", "test")

    context = _context(permission_gate=CapturingGate())
    tool = build_storyforge_tool_registry(context).get("file_create")
    decision = StoryForgeRuntimePolicy(context).decide_tool(
        tool,
        PendingToolCall(
            "c1",
            "file_create",
            {"path": "正文/第02章.md", "confirmed": True, "user_confirmed": True},
        ),
        context,
    )

    assert decision.kind is PolicyDecisionKind.ALLOW
    assert "confirmed" not in captured
    assert "user_confirmed" not in captured


def test_storyforge_selector_withdraws_only_patch_tools_after_first_patch() -> None:
    context = _context()
    registry = build_storyforge_tool_registry(context)
    context.outcome.proposed_patch = {"kind": "revision", "id": "patch-1"}

    selected = StoryForgeToolSelector().select(registry, context)

    selected_names = {tool.metadata["registry_name"] for tool in selected}
    patch_names = {spec.name for spec in loop_patch_tool_specs()}
    assert selected_names.isdisjoint(patch_names)
    assert selected_names == {spec.name for spec in list_loop_tool_specs()} - patch_names


def test_storyforge_feedback_keeps_the_existing_model_wire_shape() -> None:
    formatter = StoryForgeFeedbackFormatter()
    call = ToolCall("c1", "fs_read", '{"path":"正文/第01章.md"}')

    success = formatter.format(
        RuntimeToolResult.success({"path": "正文/第01章.md", "content": "第一章"}),
        call=call,
        tool=None,
        context=None,
    )
    failure = formatter.format(
        RuntimeToolResult.failure("storyforge_tool_error", "路径不在项目内。"),
        call=call,
        tool=None,
        context=None,
    )

    assert json.loads(success) == {"path": "正文/第01章.md", "content": "第一章"}
    assert json.loads(failure) == {"error": "路径不在项目内。"}


def test_sdk_runtime_transcript_matches_the_live_loop_contract(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    novel_project: Path,
) -> None:
    _enable_loop_env(monkeypatch)
    calls = _fake_llm_script(
        monkeypatch,
        [
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "c1",
                        "type": "function",
                        "function": {
                            "name": "fs_read",
                            "arguments": json.dumps({"path": "正文/第01章.md"}),
                        },
                    }
                ],
                "prompt_tokens": 10,
                "completion_tokens": 2,
                "token_usage": 12,
                "token_usage_source": "provider_usage",
            },
            {
                "content": "第一章以灯塔异象开场。",
                "tool_calls": [],
                "prompt_tokens": 20,
                "completion_tokens": 4,
                "token_usage": 24,
                "token_usage_source": "provider_usage",
            },
        ],
    )

    received = _send_chat_message(
        client,
        run_id="run-sdk-transcript",
        project_path=str(novel_project),
        message="第一章怎么开场？",
    )

    assert calls[0]["tools"] == loop_runtime.LOOP_TOOL_SCHEMAS
    second_messages = calls[1]["messages"]
    assistant_message = second_messages[-2]
    tool_message = second_messages[-1]
    assert assistant_message["role"] == "assistant"
    assert assistant_message["tool_calls"][0]["function"]["name"] == "fs_read"
    assert tool_message["role"] == "tool"
    assert tool_message["tool_call_id"] == "c1"
    feedback = json.loads(tool_message["content"])
    assert feedback["path"] == "正文/第01章.md"
    assert "ok" not in feedback
    result = received[-1]
    assert result["agent_result"]["summary"] == "第一章以灯塔异象开场。"
