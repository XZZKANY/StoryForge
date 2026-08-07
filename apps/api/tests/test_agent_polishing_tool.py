from __future__ import annotations

from typing import cast

import pytest
from sqlalchemy.orm import Session

from app.domains.agent_runs.adapters import FixedPipelineRequest
from app.domains.agent_runs.errors import AgentOrchestrationError
from app.domains.agent_runs.models import AgentRun
from app.domains.agent_runs.patches import (
    ControlledPolishResult,
    PolishCandidate,
    PolishDecision,
    select_polish_candidate,
)
from app.domains.agent_runs.patches import runtime_tools as polish_runtime_tools
from app.domains.agent_runs.runtime import AgentRuntime
from app.domains.agent_runs.tools import ToolExecutionContext


def _context(profile: str = "ask") -> ToolExecutionContext:
    return ToolExecutionContext(
        session=cast(Session, object()),
        run=AgentRun(permission_profile=profile),
        agent_session_id="agent-session",
        assistant_session_id=1,
        user_message="保守润色这一章",
        args={},
    )


def test_local_only_polish_produces_proposed_patch_without_writing() -> None:
    runtime = AgentRuntime(event_sink=None)  # type: ignore[arg-type]
    original = "# 第一章\n\n林岚推开门，，握紧刀！！她转身看向巷口，又停下。"

    result = runtime._chapter_polish(  # noqa: SLF001 - handler behavior contract
        _context("ask"),
        {
            "file_path": "D:/project/正文/第一章.md",
            "_trace_file_path": "正文/第一章.md",
            "content": original,
            "online_enabled": False,
        },
    )

    patch = result.output["proposed_patch"]
    assert patch["created_by_tool"] == "chapter.polish"
    assert patch["before"] == original
    assert "门，握紧刀！" in patch["after"]
    assert patch["requires_confirmation"] is True
    assert result.patch_proposal is not None
    assert result.artifacts[0].kind == "proposed_patch"


def test_degraded_local_candidate_always_requires_confirmation(monkeypatch) -> None:
    runtime = AgentRuntime(event_sink=None)  # type: ignore[arg-type]
    original = "# 第一章\n\n林岚推开门，，握紧刀。"
    local = "# 第一章\n\n林岚推开门，握紧刀。"
    controlled = ControlledPolishResult(
        decision=PolishDecision("degraded", "local", local, True, {}),
        provider="anthropic",
        model="polish-model",
        resolution_source="dedicated",
        online_failure="provider_failed",
        online_attempted=True,
        usage={},
    )
    monkeypatch.setattr(polish_runtime_tools, "run_controlled_polish", lambda *args, **kwargs: controlled)

    result = runtime._chapter_polish(  # noqa: SLF001 - handler behavior contract
        _context("full"),
        {
            "file_path": "D:/project/正文/第一章.md",
            "_trace_file_path": "正文/第一章.md",
            "content": original,
        },
    )

    patch = result.output["proposed_patch"]
    assert patch["degraded"] is True
    assert patch["requires_confirmation"] is True
    assert result.trace.output_summary["online_failure"] == "provider_failed"
    assert "api_key" not in str(result.trace.as_dict()).lower()


def test_noop_or_rejected_candidate_never_creates_empty_patch(monkeypatch) -> None:
    runtime = AgentRuntime(event_sink=None)  # type: ignore[arg-type]
    original = "# 第一章\n\n林岚推开门。"
    controlled = ControlledPolishResult(
        decision=PolishDecision("noop", "original", original, False, {}),
        provider="gemini",
        model="polish-model",
        resolution_source="dedicated",
        online_failure=None,
        online_attempted=True,
        usage={},
    )
    monkeypatch.setattr(polish_runtime_tools, "run_controlled_polish", lambda *args, **kwargs: controlled)

    result = runtime._chapter_polish(  # noqa: SLF001 - handler behavior contract
        _context(),
        {
            "file_path": "D:/project/正文/第一章.md",
            "_trace_file_path": "正文/第一章.md",
            "content": original,
        },
    )

    assert "proposed_patch" not in result.output
    assert result.artifacts == ()
    assert result.patch_proposal is None


def test_structured_file_is_rejected_before_provider_call() -> None:
    runtime = AgentRuntime(event_sink=None)  # type: ignore[arg-type]

    with pytest.raises(AgentOrchestrationError, match="结构化状态"):
        runtime._chapter_polish(  # noqa: SLF001 - handler behavior contract
            _context(),
            {
                "file_path": "D:/project/.storyforge/canon/canon.json",
                "_trace_file_path": ".storyforge/canon/canon.json",
                "content": "{}",
            },
        )


def test_fixed_pipeline_projects_trusted_context_and_rejects_entity_drift(monkeypatch) -> None:
    runtime = AgentRuntime(event_sink=None)  # type: ignore[arg-type]
    original = "# 第一章\n\n林岚在灯塔港握紧刀，听见潮声逼近。"
    captured: dict[str, object] = {}

    def fake_controlled_polish(text: str, **kwargs) -> ControlledPolishResult:
        captured.update(kwargs)
        decision = select_polish_candidate(
            text,
            local_candidate=PolishCandidate("local", text),
            online_candidate=PolishCandidate("online", text.replace("林岚", "她")),
            protected_entities=kwargs["protected_entities"],
            character_constraints=kwargs["character_constraints"],
            continuity_facts=kwargs["continuity_facts"],
            required_facts=kwargs["required_facts"],
        )
        return ControlledPolishResult(
            decision=decision,
            provider="anthropic",
            model="polish-model",
            resolution_source="dedicated",
            online_failure=None,
            online_attempted=True,
            usage={},
        )

    monkeypatch.setattr(polish_runtime_tools, "run_controlled_polish", fake_controlled_polish)
    run = AgentRun(permission_profile="ask")
    response = runtime.run_controlled_chapter_polish_pipeline(
        FixedPipelineRequest(
            session=cast(Session, object()),
            run=run,
            agent_session_id="agent-session",
            assistant_session_id=1,
            user_message="保守润色",
            intent="chapter.polish",
            args={
                "file_path": "D:/project/正文/第一章.md",
                "_trace_file_path": "正文/第一章.md",
                "content": original,
                "context_bundle": {
                    "project_root": "D:/project",
                    "current_file": "D:/project/正文/第一章.md",
                    "files": [
                        {
                            "path": "D:/project/人物/林岚.md",
                            "relative_path": "人物/林岚.md",
                            "kind": "character",
                            "title": "林岚.md",
                            "excerpt": "林岚谨慎寡言，不会主动泄露旧案。",
                        },
                        {
                            "path": "D:/project/设定/灯塔港.md",
                            "relative_path": "设定/灯塔港.md",
                            "kind": "setting",
                            "title": "灯塔港.md",
                            "excerpt": "灯塔港终年有潮雾，旧灯塔已经停用。",
                        },
                    ],
                },
            },
        )
    )

    assert captured["protected_entities"] == ["林岚", "灯塔港"]
    assert captured["character_constraints"] == [
        {
            "name": "林岚",
            "path": "人物/林岚.md",
            "notes": "林岚谨慎寡言，不会主动泄露旧案。",
        }
    ]
    assert captured["continuity_facts"] == [
        {
            "statement": "灯塔港终年有潮雾，旧灯塔已经停用。",
            "source_path": "设定/灯塔港.md",
        }
    ]
    assert response["proposed_patch"] is None
    assert response["agent_result"]["polish"]["selected_source"] == "original"
    assert "protected_entity_changed:林岚" in response["agent_result"]["polish"]["gate_reasons"]["online"]
    assert response["tool_trace"][1]["output_summary"]["constraint_counts"] == {
        "protected_entities": 2,
        "character_constraints": 1,
        "continuity_facts": 1,
        "required_facts": 0,
    }
