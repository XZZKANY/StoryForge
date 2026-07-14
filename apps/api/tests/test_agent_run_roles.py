from __future__ import annotations

import pytest
from agent_run_test_support import _seed_agent_run
from agent_transport import agent_result, stream_agent_message
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.domains.agent_runs.models import AgentRun
from app.domains.ide import review_reasoning


def test_agent_skills_endpoint_exposes_skills_v1_catalog(client: TestClient) -> None:
    """Root Agent skill 清单必须可只读查询，且 skill 本身不执行工具。"""

    response = client.get("/api/agent-runs/skills")

    assert response.status_code == 200, response.text
    skills = response.json()
    assert [skill["name"] for skill in skills] == [
        "chapter_polish",
        "short_story_draft",
        "long_chapter_generate",
        "consistency_review",
        "bookrun_generation",
    ]
    bookrun = next(skill for skill in skills if skill["name"] == "bookrun_generation")
    assert bookrun["trigger_intents"] == ["bookrun.start"]
    assert "bookrun_checkpoint" in bookrun["output_artifacts"]


def test_agent_roles_endpoint_exposes_opencode_inspired_roles(client: TestClient) -> None:
    """Agent role catalog 必须暴露 Root Agent 和 OpenCode 启发的首批 subagents。"""

    response = client.get("/api/agent-runs/roles")

    assert response.status_code == 200, response.text
    roles = response.json()
    role_names = [role["name"] for role in roles]
    assert role_names == [
        "root_agent",
        "plot_reviewer",
        "character_reviewer",
        "prose_reviewer",
        "continuity_reviewer",
        "repair_agent",
        "synthesizer",
        "bookrun_agent",
        "context_explorer",
        "external_scout",
    ]
    assert [role["name"] for role in roles if role["kind"] == "primary"] == ["root_agent"]
    assert all(role["kind"] in {"primary", "subagent"} for role in roles)
    assert next(role for role in roles if role["name"] == "root_agent")["can_be_mentioned"] is False
    assert next(role for role in roles if role["name"] == "plot_reviewer")["aliases"] == ["@剧情"]


def test_agent_role_aliases_resolve_to_expected_subagents(client: TestClient) -> None:
    """用户 @角色 alias 必须能解析到统一 role name，供 Desktop 后续传 role hints。"""

    expected = {
        "@剧情": "plot_reviewer",
        "@人物": "character_reviewer",
        "@文风": "prose_reviewer",
        "@伏笔": "continuity_reviewer",
        "@设定": "continuity_reviewer",
        "@修复": "repair_agent",
        "@写作任务": "bookrun_agent",
        "@探索": "context_explorer",
        "@资料": "external_scout",
    }
    for alias, role_name in expected.items():
        response = client.get("/api/agent-runs/roles/resolve", params={"alias": alias})

        assert response.status_code == 200, response.text
        assert response.json()["name"] == role_name

    unknown = client.get("/api/agent-runs/roles/resolve", params={"alias": "@未知"})
    assert unknown.status_code == 200, unknown.text
    assert unknown.json() is None


def test_readonly_agent_roles_do_not_bind_write_tools(client: TestClient) -> None:
    """只读角色不能默认绑定写入或长任务启动工具。"""

    response = client.get("/api/agent-runs/roles")

    assert response.status_code == 200, response.text
    roles = response.json()
    forbidden = {"file.revise", "judge.repair", "bookrun.start"}
    readonly_names = {
        "plot_reviewer",
        "character_reviewer",
        "prose_reviewer",
        "continuity_reviewer",
        "context_explorer",
        "external_scout",
    }
    readonly_roles = [role for role in roles if role["read_only"]]
    assert {role["name"] for role in readonly_roles} == readonly_names
    assert next(role for role in roles if role["name"] == "context_explorer")["read_only"] is True
    assert next(role for role in roles if role["name"] == "external_scout")["read_only"] is True
    for role in readonly_roles:
        assert forbidden.isdisjoint(role["allowed_tools"])


def test_runtime_subagent_definitions_are_backed_by_role_catalog() -> None:
    """Runtime 内置子代理 handler 必须能在 role catalog 中找到同名 subagent。"""

    from app.domains.agent_runs.runtime import AgentRuntime
    from app.domains.agent_runs.service import (
        get_agent_role,
        is_role_allowed_tool,
        list_subagent_roles,
    )

    runtime = AgentRuntime(event_sink=None)  # type: ignore[arg-type]
    role_names = {role.name for role in list_subagent_roles()}

    assert set(runtime._subagents.roles) == {  # noqa: SLF001 - 验证 Runtime 与 catalog 对齐
        "plot_reviewer",
        "character_reviewer",
        "prose_reviewer",
        "continuity_reviewer",
    }
    assert set(runtime._subagents.roles).issubset(role_names)  # noqa: SLF001
    assert get_agent_role("plot_reviewer") is not None
    assert is_role_allowed_tool("plot_reviewer", "file.review") is True


def test_file_review_tool_result_carries_postprocess_metadata(session: Session) -> None:
    """ToolResult 先承载 summary/artifacts/metrics，再由运行时统一归档。"""

    from app.domains.agent_runs.runtime import AgentRuntime
    from app.domains.agent_runs.tooling import ToolExecutionContext

    run = _seed_agent_run(session, public_id="run-tool-result-metadata")
    runtime = AgentRuntime(event_sink=None)  # type: ignore[arg-type]
    result = runtime._file_review(  # noqa: SLF001 - stage 4 postprocess regression guard
        ToolExecutionContext(
            session=session,
            run=run,
            agent_session_id="session-tool-result-metadata",
            assistant_session_id=1,
            user_message="审一下这一章",
            args={},
        ),
        {"file_path": "正文/第01章.md", "content": "林岚走进港口。灯塔熄灭了。"},
    )

    assert result.summary == result.output["summary"]
    assert result.payload == {"review_report": result.output["review_report"]}
    assert [(artifact.kind, artifact.requires_confirmation) for artifact in result.artifacts] == [
        ("review_report", False)
    ]
    assert result.artifacts[0].payload["kind"] == "review_report"
    assert result.metrics["issue_count"] == len(result.output["review_report"]["issues"])
    assert result.metrics["mode"] == result.output["review_report"]["mode"]


def test_runtime_postprocess_prefers_tool_artifacts_and_removes_internal_payload(session: Session) -> None:
    """artifact pipeline 消费 ToolResult artifacts；旧 result 字段只作为 fallback。"""

    from app.domains.agent_runs.runtime import AgentRuntime
    from app.domains.agent_runs.tooling import ToolArtifact

    class RecordingSink:
        def __init__(self) -> None:
            self.artifacts: list[dict[str, object]] = []

        def record_artifact(
            self,
            run: AgentRun,
            *,
            kind: str,
            payload: dict[str, object],
            requires_confirmation: bool,
        ) -> None:
            self.artifacts.append(
                {
                    "run_id": run.public_id,
                    "kind": kind,
                    "payload": payload,
                    "requires_confirmation": requires_confirmation,
                }
            )

    run = _seed_agent_run(session, public_id="run-tool-artifact-postprocess")
    sink = RecordingSink()
    runtime = AgentRuntime(event_sink=sink)  # type: ignore[arg-type]
    result = {
        "agent_result": {"review_report": {"kind": "fallback_review_report"}},
        "proposed_patch": {"kind": "fallback_patch", "requires_confirmation": True},
        "_tool_artifacts": [
            ToolArtifact(kind="review_report", payload={"kind": "review_report", "source": "tool"}, requires_confirmation=False),
            ToolArtifact(kind="proposed_patch", payload={"kind": "file_revision", "source": "tool"}, requires_confirmation=True),
        ],
    }

    runtime._record_result_artifacts(run, result)  # noqa: SLF001 - stage 4 postprocess regression guard

    assert "_tool_artifacts" not in result
    assert sink.artifacts == [
        {
            "run_id": "run-tool-artifact-postprocess",
            "kind": "review_report",
            "payload": {"kind": "review_report", "source": "tool"},
            "requires_confirmation": False,
        },
        {
            "run_id": "run-tool-artifact-postprocess",
            "kind": "proposed_patch",
            "payload": {"kind": "file_revision", "source": "tool"},
            "requires_confirmation": True,
        },
    ]


def test_runtime_rejects_unknown_subagent_role() -> None:
    """unknown role 不应被执行，应抛出可读错误。"""

    from app.domains.agent_runs.runtime import AgentRuntime
    from app.domains.ide.orchestrator import AgentOrchestrationError

    runtime = AgentRuntime(event_sink=None)  # type: ignore[arg-type]

    with pytest.raises(AgentOrchestrationError, match="未知子代理 role catalog 条目"):
        runtime._subagents.run("unknown_reviewer", {}, tool_name="file.review")  # noqa: SLF001


def test_runtime_initialization_failure_marks_agent_run_failed(
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Runtime 初始化期发现 role catalog 不匹配时，也必须写入可回放 failed event。"""

    from app.domains.agent_runs import service as agent_run_service
    from app.domains.ide.orchestrator import AgentOrchestrationError

    class FailingRuntime:
        def __init__(self, event_sink):  # noqa: ANN001 - test double
            raise AgentOrchestrationError("子代理未登记到 role catalog：plot_reviewer")

    run = agent_run_service.create_or_resume_agent_run(
        session,
        public_id="run-runtime-init-failure",
        session_id="session-runtime-init-failure",
        goal="审一下",
        scope={},
    )
    monkeypatch.setattr(agent_run_service, "AgentRuntime", FailingRuntime)

    with pytest.raises(agent_run_service.AgentRuntimeError, match="role catalog"):
        agent_run_service.execute_agent_user_message_run(
            session,
            run=run,
            agent_session_id="session-runtime-init-failure",
            message={"type": "user_message", "user_message": "审一下", "args": {}},
        )

    failed = agent_run_service.get_agent_run(session, "run-runtime-init-failure")
    assert failed.status == "failed"
    assert failed.events[-1].event_type == "agent_run_failed"
    assert "role catalog" in failed.events[-1].message


def test_readonly_subagent_roles_cannot_execute_write_tools() -> None:
    """只读 subagent role 即使存在 handler，也不能借角色身份调用写工具。"""

    from app.domains.agent_runs.runtime import AgentRuntime
    from app.domains.agent_runs.service import is_role_allowed_tool
    from app.domains.ide.orchestrator import AgentOrchestrationError

    runtime = AgentRuntime(event_sink=None)  # type: ignore[arg-type]

    assert is_role_allowed_tool("plot_reviewer", "file.revise") is False
    with pytest.raises(AgentOrchestrationError, match="不允许调用工具 file.revise"):
        runtime._subagents.run("plot_reviewer", {}, tool_name="file.revise")  # noqa: SLF001


def test_websocket_user_message_persists_agent_role_hints(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """WebSocket args.agent_role_hints 会进入 AgentRun scope、started event 和 plan payload。"""

    monkeypatch.setattr(review_reasoning, "missing_book_generation_env", lambda: ["STORYFORGE_LLM_API_KEY"])

    frames = stream_agent_message(
        client,
        "session-agent-role-hints",
        run_id="run-agent-role-hints",
        user_message="@剧情 看看这一章冲突够不够",
        args={
            "file_path": "正文/第04章.md",
            "content": "林岚走进港口。灯塔熄灭了。",
            "agent_role_hints": ["plot_reviewer"],
            "agent_role_mentions": ["@剧情"],
        },
    )
    started = frames[0]
    received = frames[1:]

    assert started["agent_role_hints"] == ["plot_reviewer"]
    assert started["agent_role_mentions"] == ["@剧情"]
    result = received[-1]
    assert result["intent"] == "file.review"
    assert result["agent_role_hints"] == ["plot_reviewer"]

    run = client.get("/api/agent-runs/run-agent-role-hints").json()
    assert run["scope"]["agent_role_hints"] == ["plot_reviewer"]
    assert run["scope"]["agent_role_mentions"] == ["@剧情"]

    events = client.get("/api/agent-runs/run-agent-role-hints/events").json()
    started_event = next(event for event in events if event["event_type"] == "agent_run_started")
    assert started_event["payload"]["agent_role_hints"] == ["plot_reviewer"]
    plan_event = next(event for event in events if event["event_type"] == "agent_plan_created")
    assert plan_event["payload"]["agent_role_hints"] == ["plot_reviewer"]
    assert any(
        event["event_type"] == "tool_trace"
        and event["payload"]["trace"]["tool_name"] == "subagent.plot_reviewer"
        and event["payload"]["trace"]["input_summary"]["explicitly_requested"] is True
        for event in events
    )


def test_unknown_agent_role_hint_is_ignored_or_warned(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """unknown role hint 不进入可执行 hints，但会在 scope 中留下 warning 信息。"""

    monkeypatch.setattr(review_reasoning, "missing_book_generation_env", lambda: ["STORYFORGE_LLM_API_KEY"])

    frames = stream_agent_message(
        client,
        "session-agent-role-unknown",
        run_id="run-agent-role-unknown",
        user_message="@未知 审一下这一章",
        intent="file.review",
        args={
            "file_path": "正文/第05章.md",
            "content": "林岚走进港口。灯塔熄灭了。",
            "agent_role_hints": ["unknown_reviewer"],
            "agent_role_mentions": ["@未知"],
        },
    )
    started = frames[0]

    assert started["agent_role_hints"] == []
    run = client.get("/api/agent-runs/run-agent-role-unknown").json()
    assert "agent_role_hints" not in run["scope"]
    assert run["scope"]["agent_role_mentions"] == ["@未知"]
    assert run["scope"]["unknown_agent_role_hints"] == ["unknown_reviewer"]
    assert run["scope"]["unknown_agent_role_mentions"] == ["@未知"]


def test_role_hint_for_plot_runs_plot_reviewer(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """用户只输入 @剧情 时，Runtime 至少运行 plot_reviewer。"""

    monkeypatch.setattr(review_reasoning, "missing_book_generation_env", lambda: ["STORYFORGE_LLM_API_KEY"])

    result = agent_result(
        client,
        "session-agent-role-plot",
        run_id="run-agent-role-plot",
        user_message="@剧情 看看冲突够不够",
        args={
            "file_path": "正文/第06章.md",
            "content": "林岚走进港口。灯塔熄灭了。",
            "agent_role_mentions": ["@剧情"],
        },
    )

    assert result["type"] == "agent_result"
    assert result["intent"] == "file.review"
    tool_names = [trace["tool_name"] for trace in result["tool_trace"]]
    assert "subagent.plot_reviewer" in tool_names


def test_multiple_role_hints_run_requested_reviewers(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """多个 role hints 会在 run events 中标出对应 reviewer 已被显式请求。"""

    monkeypatch.setattr(review_reasoning, "missing_book_generation_env", lambda: ["STORYFORGE_LLM_API_KEY"])

    result = agent_result(
        client,
        "session-agent-role-multiple",
        run_id="run-agent-role-multiple",
        user_message="@人物 @文风 审一下",
        intent="file.review",
        args={
            "file_path": "正文/第07章.md",
            "content": "林岚走进港口。灯塔熄灭了。",
            "agent_role_hints": ["character_reviewer", "prose_reviewer"],
            "agent_role_mentions": ["@人物", "@文风"],
        },
    )

    requested = {
        trace["tool_name"]
        for trace in result["tool_trace"]
        if trace["tool_name"].startswith("subagent.") and trace["input_summary"].get("explicitly_requested")
    }
    assert {"subagent.character_reviewer", "subagent.prose_reviewer"}.issubset(requested)


def test_writing_run_role_hint_does_not_bypass_permission_gate(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """@写作任务 不能在普通 file.revise 中直接启动 managed run 或绕过权限确认。"""

    from app.domains.assistant import service as assistant_service

    monkeypatch.setattr(assistant_service, "missing_book_generation_env", lambda: [])
    monkeypatch.setattr(
        assistant_service,
        "_call_llm",
        lambda source, *, system_prompt, user_prompt: {
            "content": "修订后正文",
            "completion_tokens": 8,
            "latency_ms": 10,
        },
    )

    result = agent_result(
        client,
        "session-agent-role-bookrun",
        run_id="run-agent-role-bookrun",
        user_message="@写作任务 把这个文件改得更紧一点",
        intent="file.revise",
        args={
            "file_path": "正文/第08章.md",
            "content": "当前正文",
            "agent_role_hints": ["bookrun_agent"],
            "agent_role_mentions": ["@写作任务"],
        },
    )

    assert result["type"] == "agent_result"
    assert result["intent"] == "file.revise"
    assert [trace["tool_name"] for trace in result["tool_trace"] if trace["tool_name"] == "bookrun.start"] == []
    events = client.get("/api/agent-runs/run-agent-role-bookrun/events").json()
    event_types = [event["event_type"] for event in events]
    assert "permission_required" in event_types


def test_agent_run_selects_consistency_review_skill_for_consistency_goal(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Root Agent 应根据目标语义选择一致性审查 skill，并写入计划事件。"""

    monkeypatch.setattr(review_reasoning, "missing_book_generation_env", lambda: ["STORYFORGE_LLM_API_KEY"])

    stream_agent_message(
        client,
        "session-agent-run-consistency",
        run_id="run-agent-consistency",
        user_message="检查这一章的设定、伏笔和时间线一致性",
        intent="file.review",
        args={
            "file_path": "正文/第03章.md",
            "content": "林岚在第十天回到港口，却又说昨天才第一次见到灯塔。",
            "context_bundle": {"files": []},
        },
    )

    events = client.get("/api/agent-runs/run-agent-consistency/events").json()
    plan_event = next(event for event in events if event["event_type"] == "agent_plan_created")
    assert plan_event["payload"]["selected_skill"]["name"] == "consistency_review"
    assert plan_event["payload"]["skill_plan_template"][1]["step"] == "continuity.review"
