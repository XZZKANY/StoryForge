from __future__ import annotations

from types import SimpleNamespace
from typing import cast

import pytest
from pydantic import ValidationError
from sqlalchemy.orm import Session
from test_book_runs import seed_locked_blueprint

from app.domains.agent_runs.errors import AgentOrchestrationError
from app.domains.agent_runs.permission import (
    DEFAULT_PERMISSION_PROFILE,
    PermissionPolicy,
    PermissionProfileError,
    canonical_permission_profile,
    normalize_permission_profile,
)
from app.domains.agent_runs.service_lifecycle import (
    create_or_resume_agent_run,
    create_or_resume_bookrun_agent_run,
    start_agent_user_message_run,
)
from app.domains.agent_runs.service_store import complete_agent_run
from app.domains.agent_runs.tools.execution import ToolDefinition, ToolExecutionContext, ToolRegistry, ToolResult
from app.domains.agent_runs.tools.execution_runtime import ToolExecutionRuntimeMixin
from app.domains.agent_runs.trace import AgentToolTrace
from app.domains.book_runs.models import BookRun
from app.domains.ide.router import AgentUserMessageStreamRequest


def _tool(
    *,
    name: str,
    risk_level: str,
    requires_confirmation: bool,
    execution_mode: str = "sync",
    on_call: list[str] | None = None,
) -> ToolDefinition:
    def handler(_context: ToolExecutionContext, _payload: dict[str, object]) -> ToolResult[dict[str, object]]:
        if on_call is not None:
            on_call.append(name)
        return ToolResult(
            status="completed",
            output={"ok": True},
            trace=AgentToolTrace(tool_name=name, status="completed", input_summary={}),
        )

    return ToolDefinition(
        name=name,
        description=name,
        input_schema={},
        output_schema={},
        allowed_roles=("root_agent",),
        permission_level="confirm" if requires_confirmation else "auto",
        risk_level=risk_level,
        requires_confirmation=requires_confirmation,
        retry_safe=True,
        idempotent=True,
        execution_mode=execution_mode,
        artifact_kinds=(),
        handler=handler,
    )


def _context(profile: str) -> ToolExecutionContext:
    return ToolExecutionContext(
        session=cast(Session, None),
        run=cast(object, SimpleNamespace(permission_profile=profile)),
        agent_session_id="session-permission",
        assistant_session_id=1,
        user_message="测试权限",
        args={},
    )


class _Runtime(ToolExecutionRuntimeMixin):
    def __init__(self, tool: ToolDefinition) -> None:
        self._tool_registry = ToolRegistry()
        self._tool_registry.register(tool)
        from app.domains.agent_runs.permission import PermissionGate

        self._permission_gate = PermissionGate()


def test_permission_profile_normalizes_canonical_values_and_legacy_aliases() -> None:
    assert normalize_permission_profile(None).profile == DEFAULT_PERMISSION_PROFILE
    assert normalize_permission_profile("read").profile == "read"
    assert normalize_permission_profile("step_confirm").profile == "step_confirm"
    assert normalize_permission_profile("risk_confirm").profile == "risk_confirm"
    assert normalize_permission_profile("autonomous").profile == "autonomous"

    legacy = normalize_permission_profile("full_allow")
    assert legacy.profile == "autonomous"
    assert legacy.migrated_from == "full_allow"

    with pytest.raises(PermissionProfileError, match="不支持的 Agent 权限档位"):
        normalize_permission_profile("unsafe_everything")

    assert canonical_permission_profile("full_allow") == "autonomous"
    assert canonical_permission_profile("unsafe_everything") == DEFAULT_PERMISSION_PROFILE


@pytest.mark.parametrize(
    ("profile", "stage", "status"),
    [
        ("read", "explore", "allow"),
        ("read", "draft", "deny"),
        ("step_confirm", "brief", "require_approval"),
        ("step_confirm", "draft", "require_approval"),
        ("risk_confirm", "draft", "allow"),
        ("risk_confirm", "proposed_patch", "require_approval"),
        ("autonomous", "draft", "allow"),
        ("autonomous", "writeback", "require_approval"),
    ],
)
def test_stage_policy_exposes_the_four_profile_boundaries(
    profile: str,
    stage: str,
    status: str,
) -> None:
    assert PermissionPolicy().decide_stage(profile, stage).status == status


def test_read_profile_blocks_pending_writes_before_the_handler_runs() -> None:
    calls: list[str] = []
    runtime = _Runtime(
        _tool(
            name="file.revise",
            risk_level="write_pending",
            requires_confirmation=True,
            on_call=calls,
        )
    )

    with pytest.raises(AgentOrchestrationError, match="权限策略阻止"):
        runtime._execute_tool("file.revise", _context("read"), {})

    assert calls == []


@pytest.mark.parametrize("profile", ["risk_confirm", "autonomous"])
def test_patch_profiles_may_generate_a_proposed_patch_without_writeback(profile: str) -> None:
    calls: list[str] = []
    runtime = _Runtime(
        _tool(
            name="file.revise",
            risk_level="write_pending",
            requires_confirmation=True,
            on_call=calls,
        )
    )

    result = runtime._execute_tool("file.revise", _context(profile), {})

    assert result.status == "completed"
    assert calls == ["file.revise"]


def test_step_confirm_does_not_fake_a_live_loop_brief_checkpoint() -> None:
    calls: list[str] = []
    runtime = _Runtime(
        _tool(
            name="file.create",
            risk_level="write_pending",
            requires_confirmation=True,
            on_call=calls,
        )
    )

    with pytest.raises(AgentOrchestrationError, match="stage_grant"):
        runtime._execute_tool("file.create", _context("step_confirm"), {})

    assert calls == []


def test_confirmed_long_running_tool_keeps_the_existing_fixed_pipeline_confirmation_boundary() -> None:
    calls: list[str] = []
    runtime = _Runtime(
        _tool(
            name="bookrun.start",
            risk_level="long_running",
            requires_confirmation=True,
            execution_mode="long_running",
            on_call=calls,
        )
    )

    result = runtime._execute_tool("bookrun.start", _context("risk_confirm"), {"confirmed": True})

    assert result.status == "completed"
    assert calls == ["bookrun.start"]


def test_lifecycle_snapshots_profile_and_preserves_it_when_resume_request_omits_one(session: Session) -> None:
    run = create_or_resume_agent_run(
        session,
        public_id="permission-snapshot",
        session_id="permission-session",
        goal="先建立自治 run",
        permission_profile="autonomous",
    )
    started = start_agent_user_message_run(
        session,
        agent_session_id="permission-session",
        message={
            "run_id": run.public_id,
            "user_message": "恢复原来的 run",
            "args": {},
        },
    )

    assert started.run.permission_profile == "autonomous"
    assert started.started_event.payload["permission_profile"] == "autonomous"


def test_lifecycle_records_legacy_profile_migration_and_terminal_profile(session: Session) -> None:
    started = start_agent_user_message_run(
        session,
        agent_session_id="permission-session",
        message={
            "run_id": "legacy-permission",
            "user_message": "使用旧档位",
            "permission_profile": "full_allow",
            "args": {},
        },
    )

    assert started.run.permission_profile == "autonomous"
    assert started.started_event.payload["profile_migrated_from"] == "full_allow"

    complete_agent_run(
        session,
        started.run,
        result={
            "assistant_session_id": 1,
            "intent": "chat.explain",
            "agent_result": {"summary": "完成", "requires_user_confirmation": False},
        },
    )
    assert started.run.events[-1].payload["permission_profile"] == "autonomous"


def test_managed_bookrun_mirror_inherits_the_source_run_profile_once(
    session: Session,
    session_factory,
) -> None:
    scope = seed_locked_blueprint(session_factory)
    book_run = BookRun(
        book_id=scope["book_id"],
        blueprint_id=scope["blueprint_id"],
        total_chapters=3,
    )
    session.add(book_run)
    session.commit()
    session.refresh(book_run)

    source = create_or_resume_agent_run(
        session,
        public_id="agent-bookrun-source",
        session_id="permission-session",
        goal="以自治档位启动 managed BookRun",
        scope={"book_run_id": book_run.id},
        permission_profile="autonomous",
    )
    mirror = create_or_resume_bookrun_agent_run(session, book_run=book_run, event_source="test")

    assert mirror.permission_profile == "autonomous"
    session.expire(mirror, ["events"])
    assert mirror.events[0].payload["permission_profile"] == "autonomous"

    source.permission_profile = "read"
    session.commit()
    resumed_mirror = create_or_resume_bookrun_agent_run(session, book_run=book_run, event_source="test-resume")

    assert resumed_mirror.permission_profile == "autonomous"


def test_stream_request_only_accepts_known_permission_profiles() -> None:
    for profile in ("read", "step_confirm", "risk_confirm", "autonomous"):
        assert AgentUserMessageStreamRequest(permission_profile=profile).permission_profile == profile

    with pytest.raises(ValidationError, match="不支持的 Agent 权限档位"):
        AgentUserMessageStreamRequest(permission_profile="unknown-profile")
