from __future__ import annotations

from types import SimpleNamespace
from typing import cast

import pytest
from pydantic import ValidationError
from sqlalchemy.orm import Session
from test_book_runs import seed_locked_blueprint

from app.domains.agent_runs.errors import AgentOrchestrationError
from app.domains.agent_runs.permission import (
    CANONICAL_PERMISSION_PROFILES,
    DEFAULT_PERMISSION_PROFILE,
    PermissionPolicy,
    PermissionProfileError,
    canonical_permission_profile,
    normalize_permission_profile,
    patch_requires_confirmation,
)
from app.domains.agent_runs.service_lifecycle import (
    create_or_resume_agent_run,
    create_or_resume_bookrun_agent_run,
    start_agent_user_message_run,
)
from app.domains.agent_runs.service_store import complete_agent_run
from app.domains.agent_runs.tools.execution import ToolDefinition, ToolExecutionContext, ToolRegistry, ToolResult
from app.domains.agent_runs.tools.execution_runtime import ToolExecutionRuntimeMixin
from app.domains.agent_runs.tools.runtime_arguments import sanitize_loop_tool_arguments
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


def test_canonical_profiles_are_the_four_author_facing_tiers() -> None:
    assert CANONICAL_PERMISSION_PROFILES == ("read", "ask", "auto", "full")
    assert DEFAULT_PERMISSION_PROFILE == "ask"
    assert normalize_permission_profile(None).profile == "ask"


@pytest.mark.parametrize("legacy", ["risk_confirm", "step_confirm", "autonomous", "full_allow", "autonomous_approval"])
def test_legacy_profiles_migrate_to_ask_and_never_silently_grant_auto_writeback(legacy: str) -> None:
    """迁移的安全性质：没有任何历史档位能把作者升级成免点击落盘。

    这是本轮唯一不可回退的红线——auto / full 只能由作者在某个具体项目上显式选一次。
    """

    migrated = normalize_permission_profile(legacy)
    assert migrated.profile == "ask"
    assert migrated.migrated_from == legacy
    assert canonical_permission_profile(legacy) == "ask"
    assert patch_requires_confirmation(legacy) is True


def test_unknown_profile_is_rejected_at_the_request_edge_and_defaults_for_history() -> None:
    with pytest.raises(PermissionProfileError, match="不支持的 Agent 权限档位"):
        normalize_permission_profile("unsafe_everything")
    assert canonical_permission_profile("unsafe_everything") == DEFAULT_PERMISSION_PROFILE


@pytest.mark.parametrize(
    ("profile", "stage", "status"),
    [
        ("read", "explore", "allow"),
        ("read", "draft", "deny"),
        ("read", "writeback", "deny"),
        ("ask", "draft", "allow"),
        ("ask", "proposed_patch", "allow"),
        ("ask", "writeback", "require_approval"),
        ("auto", "draft", "allow"),
        ("auto", "writeback", "allow"),
        ("full", "writeback", "allow"),
    ],
)
def test_stage_policy_exposes_the_four_profile_boundaries(profile: str, stage: str, status: str) -> None:
    assert PermissionPolicy().decide_stage(profile, stage).status == status


@pytest.mark.parametrize(
    ("profile", "requires_confirmation"),
    [("read", True), ("ask", True), ("auto", False), ("full", False)],
)
def test_patch_confirmation_flag_is_derived_from_the_profile(profile: str, requires_confirmation: bool) -> None:
    """Desktop 只读补丁上的这一位，不自己按 profile 字符串分支。"""

    assert patch_requires_confirmation(profile) is requires_confirmation


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


@pytest.mark.parametrize("profile", ["ask", "auto", "full"])
def test_write_profiles_may_run_pending_write_tools(profile: str) -> None:
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


@pytest.mark.parametrize("profile", ["ask", "auto"])
def test_long_running_start_still_needs_confirmation_below_full(profile: str) -> None:
    """自动档只放宽「作者点接受」这一层；烧 key 的长任务不在其中。"""

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

    with pytest.raises(AgentOrchestrationError, match="需要先获得权限确认"):
        runtime._execute_tool("bookrun.start", _context(profile), {})
    assert calls == []

    result = runtime._execute_tool("bookrun.start", _context(profile), {"confirmed": True})
    assert result.status == "completed"
    assert calls == ["bookrun.start"]


def test_full_profile_starts_long_running_without_a_confirmation_round_trip() -> None:
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

    result = runtime._execute_tool("bookrun.start", _context("full"), {})

    assert result.status == "completed"
    assert calls == ["bookrun.start"]


def test_model_supplied_confirmation_flags_are_stripped_before_the_gate_sees_them() -> None:
    """`confirmed` 是唯一能把模型参数变成权限授予的键，不能由模型自己填。"""

    sanitized = sanitize_loop_tool_arguments(
        {"path": "正文/第01章.md", "confirmed": True, "user_confirmed": True}
    )

    assert sanitized == {"path": "正文/第01章.md"}


def test_lifecycle_snapshots_profile_and_preserves_it_when_resume_request_omits_one(session: Session) -> None:
    run = create_or_resume_agent_run(
        session,
        public_id="permission-snapshot",
        session_id="permission-session",
        goal="先建立自动档 run",
        permission_profile="auto",
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

    assert started.run.permission_profile == "auto"
    assert started.started_event.payload["permission_profile"] == "auto"


def test_resume_tolerates_dirty_stored_profiles_instead_of_failing_the_run(session: Session) -> None:
    run = create_or_resume_agent_run(
        session,
        public_id="permission-dirty",
        session_id="permission-session",
        goal="历史脏数据",
    )
    run.permission_profile = "profile-from-a-future-build"
    session.commit()

    started = start_agent_user_message_run(
        session,
        agent_session_id="permission-session",
        message={"run_id": run.public_id, "user_message": "续跑", "args": {}},
    )

    assert started.run.permission_profile == DEFAULT_PERMISSION_PROFILE


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

    assert started.run.permission_profile == "ask"
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
    assert started.run.events[-1].payload["permission_profile"] == "ask"


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
        goal="以自动档启动 managed BookRun",
        scope={"book_run_id": book_run.id},
        permission_profile="auto",
    )
    mirror = create_or_resume_bookrun_agent_run(session, book_run=book_run, event_source="test")

    assert mirror.permission_profile == "auto"
    session.expire(mirror, ["events"])
    assert mirror.events[0].payload["permission_profile"] == "auto"

    source.permission_profile = "read"
    session.commit()
    resumed_mirror = create_or_resume_bookrun_agent_run(session, book_run=book_run, event_source="test-resume")

    assert resumed_mirror.permission_profile == "auto"


def test_stream_request_only_accepts_known_permission_profiles() -> None:
    for profile in CANONICAL_PERMISSION_PROFILES:
        assert AgentUserMessageStreamRequest(permission_profile=profile).permission_profile == profile

    with pytest.raises(ValidationError, match="不支持的 Agent 权限档位"):
        AgentUserMessageStreamRequest(permission_profile="unknown-profile")
