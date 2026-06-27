from __future__ import annotations

import inspect
import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker
from test_book_runs import seed_locked_blueprint

from app.domains.agent_runs.models import AgentArtifact, AgentRun, AgentRunEvent, SubagentRun
from app.domains.ide import review_reasoning
from app.domains.ide import router as ide_router


def test_agent_run_models_are_registered_in_metadata() -> None:
    """Agent Runtime 控制平面表必须进入统一 ORM 元数据。"""

    assert AgentRun.__tablename__ == "agent_runs"
    assert AgentRunEvent.__tablename__ == "agent_run_events"
    assert SubagentRun.__tablename__ == "subagent_runs"
    assert AgentArtifact.__tablename__ == "agent_artifacts"


def test_websocket_user_message_enters_through_runtime_facade() -> None:
    """IDE WebSocket 不应直接串联 user_message run 的 start/execute 细节。"""

    source = inspect.getsource(ide_router.agent_session)

    assert "run_agent_user_message(" in source
    assert "start_agent_user_message_run(" not in source
    assert "execute_agent_user_message_run(" not in source


def test_websocket_user_message_persists_agent_run_events_and_artifacts(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """IDE Agent user_message 必须创建可 REST 回放的 AgentRun 事件流。"""

    monkeypatch.setattr(review_reasoning, "missing_book_generation_env", lambda: ["STORYFORGE_LLM_API_KEY"])

    with client.websocket_connect("/api/ide/agent/sessions/session-agent-run-review") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "stream": True,
                "run_id": "run-agent-review",
                "user_message": "审查当前章节的结构、人物和节奏",
                "intent": "file.review",
                "args": {
                    "file_path": "正文/第01章.md",
                    "content": "林岚走进港口。她看见灯塔熄灭。其实这说明旧案还没结束。",
                    "context_bundle": {"files": []},
                },
            }
        )
        started = websocket.receive_json()
        received = []
        while not received or received[-1]["type"] != "agent_result":
            received.append(websocket.receive_json())

    assert started["type"] == "agent_run_started"
    assert started["run_id"] == "run-agent-review"
    assert received[-1]["run_id"] == "run-agent-review"
    assert received[-1]["system_jobs"]["title"]["job_name"] == "conversation.title.generate"
    assert received[-1]["system_jobs"]["title"]["hidden"] is True
    assert received[-1]["system_jobs"]["title"]["title"] == "审查当前章节审稿"
    assert received[-1]["system_jobs"]["summary"]["job_name"] == "conversation.summary.update"

    run_response = client.get("/api/agent-runs/run-agent-review")
    assert run_response.status_code == 200, run_response.text
    run = run_response.json()
    assert run["public_id"] == "run-agent-review"
    assert run["session_id"] == "session-agent-run-review"
    assert run["status"] == "completed"
    assert run["permission_profile"] == "risk_confirm"
    assert run["root_plan"]

    events_response = client.get("/api/agent-runs/run-agent-review/events")
    assert events_response.status_code == 200, events_response.text
    events = events_response.json()
    event_types = [event["event_type"] for event in events]
    assert event_types[0] == "agent_run_started"
    assert "agent_plan_created" in event_types
    assert "tool_trace" in event_types
    assert "subagent_started" in event_types
    assert "subagent_completed" in event_types
    assert "agent_artifact" in event_types
    assert "system_job" in event_types
    assert event_types[-1] == "agent_run_completed"
    assert [event["sequence"] for event in events] == list(range(1, len(events) + 1))
    plan_event = next(event for event in events if event["event_type"] == "agent_plan_created")
    assert plan_event["payload"]["skill_version"] == "skills_v1"
    assert plan_event["payload"]["selected_skill"]["name"] == "chapter_polish"
    assert "file.review" in plan_event["payload"]["selected_skill"]["tool_sequence"]
    system_events = [event for event in events if event["event_type"] == "system_job"]
    assert [event["payload"]["job_name"] for event in system_events] == [
        "conversation.title.generate",
        "conversation.summary.update",
    ]
    assert all(event["payload"]["hidden"] is True for event in system_events)

    artifacts_response = client.get("/api/agent-runs/run-agent-review/artifacts")
    assert artifacts_response.status_code == 200, artifacts_response.text
    artifacts = artifacts_response.json()
    assert [artifact["kind"] for artifact in artifacts] == ["review_report"]
    assert artifacts[0]["requires_confirmation"] is False
    assert artifacts[0]["payload"]["kind"] == "review_report"

    session_response = client.get(f"/api/assistant/sessions/{received[-1]['assistant_session_id']}")
    assert session_response.status_code == 200, session_response.text
    assert session_response.json()["title"] == "审查当前章节审稿"


def test_agent_run_records_permission_required_for_proposed_patch(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """proposed_patch 只能作为需确认 artifact，不能绕过作者确认。"""

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

    with client.websocket_connect("/api/ide/agent/sessions/session-agent-run-revise") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "run_id": "run-agent-revise",
                "user_message": "把这个文件改得更紧一点",
                "intent": "file.revise",
                "args": {
                    "file_path": "正文/第02章.md",
                    "content": "当前正文",
                    "instruction": "压缩解释性表达",
                },
            }
        )
        message = websocket.receive_json()

    assert message["type"] == "agent_result"
    assert message["run_id"] == "run-agent-revise"
    assert message["proposed_patch"]["requires_confirmation"] is True

    events = client.get("/api/agent-runs/run-agent-revise/events").json()
    event_types = [event["event_type"] for event in events]
    assert "permission_required" in event_types
    permission_event = next(event for event in events if event["event_type"] == "permission_required")
    assert permission_event["actor"] == "permission-gate"
    assert permission_event["payload"]["permission_profile"] == "risk_confirm"
    assert permission_event["payload"]["proposed_patch"]["kind"] == "file_revision"
    assert permission_event["payload"]["blocked_tool"] == "file.revise"
    assert "agent_run_completed" not in event_types

    run = client.get("/api/agent-runs/run-agent-revise").json()
    assert run["status"] == "paused"
    assert run["current_step"] == "permission.confirm"

    artifacts = client.get("/api/agent-runs/run-agent-revise/artifacts").json()
    assert [artifact["kind"] for artifact in artifacts] == ["review_report", "proposed_patch"]
    assert artifacts[-1]["requires_confirmation"] is True


def test_hidden_compaction_system_job_runs_for_long_sessions(
    client: TestClient,
) -> None:
    """长会话自动产出隐藏 compaction 事件，但不污染普通 artifact 列表。"""

    create_response = client.post(
        "/api/assistant/sessions",
        json={
            "title": "IDE Agent: 初始长会话",
            "task_type": "ide_agent_orchestration",
            "messages": [
                {
                    "role": "user" if index % 2 == 0 else "assistant",
                    "content": f"第 {index} 条历史消息：" + ("林岚在灯塔港继续追查旧案。" * 80),
                }
                for index in range(14)
            ],
        },
    )
    assert create_response.status_code == 201, create_response.text
    assistant_session_id = create_response.json()["id"]

    with client.websocket_connect("/api/ide/agent/sessions/session-long-compaction") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "run_id": "run-long-compaction",
                "user_message": "解释这一段",
                "intent": "chat.explain",
                "assistant_session_id": assistant_session_id,
                "args": {"context": "林岚走进港口。"},
            }
        )
        message = websocket.receive_json()

    assert message["type"] == "agent_result"
    assert message["system_jobs"]["compaction"]["job_name"] == "conversation.compact"
    assert message["system_jobs"]["compaction"]["hidden"] is True
    assert message["system_jobs"]["compaction"]["compacted_message_count"] > 0

    events = client.get("/api/agent-runs/run-long-compaction/events").json()
    system_events = [event for event in events if event["event_type"] == "system_job"]
    assert [event["payload"]["job_name"] for event in system_events] == [
        "conversation.title.generate",
        "conversation.summary.update",
        "conversation.compact",
    ]
    compaction_event = system_events[-1]
    assert compaction_event["actor"] == "system-compaction-agent"
    assert compaction_event["payload"]["retained_message_count"] == 4

    artifacts = client.get("/api/agent-runs/run-long-compaction/artifacts").json()
    assert artifacts == []


def test_agent_runtime_chapter_polish_does_not_call_legacy_orchestrator(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """chapter_polish 可执行 skill 必须由 AgentRuntime 主控，而不是旧 orchestrator 投影。"""

    from app.domains.agent_runs import runtime as agent_runtime

    def fail_legacy(*args, **kwargs):  # noqa: ANN002, ANN003 - test sentinel
        raise AssertionError("legacy orchestrator should not run for chapter_polish")

    monkeypatch.setattr(agent_runtime, "orchestrate_agent_message", fail_legacy)
    monkeypatch.setattr(review_reasoning, "missing_book_generation_env", lambda: ["STORYFORGE_LLM_API_KEY"])

    with client.websocket_connect("/api/ide/agent/sessions/session-agent-runtime-no-legacy") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "run_id": "run-runtime-no-legacy",
                "user_message": "审查当前章节的结构、人物和节奏",
                "intent": "file.review",
                "args": {
                    "file_path": "正文/第01章.md",
                    "content": "林岚走进港口。她看见灯塔熄灭。其实这说明旧案还没结束。",
                    "context_bundle": {"files": []},
                },
            }
        )
        message = websocket.receive_json()

    assert message["type"] == "agent_result"
    assert message["runtime_mode"] == "agent_runtime"
    assert [trace["tool_name"] for trace in message["tool_trace"]][:2] == ["context.load", "subagent.plot_reviewer"]


def test_permission_approval_completes_paused_agent_run(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """permission_required 暂停 run；approve_permission 才能把待确认步骤收口。"""

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

    with client.websocket_connect("/api/ide/agent/sessions/session-agent-run-approve") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "run_id": "run-agent-approve",
                "user_message": "把这个文件改得更紧一点",
                "intent": "file.revise",
                "args": {"file_path": "正文/第02章.md", "content": "当前正文"},
            }
        )
        websocket.receive_json()
        websocket.send_json(
            {
                "type": "approve_permission",
                "run_id": "run-agent-approve",
                "payload": {"reason": "测试批准"},
            }
        )
        ack = websocket.receive_json()

    assert ack["type"] == "permission_approved"
    run = client.get("/api/agent-runs/run-agent-approve").json()
    assert run["status"] == "completed"
    assert run["current_step"] == "completed"
    events = client.get("/api/agent-runs/run-agent-approve/events").json()
    assert [event["event_type"] for event in events][-1] == "agent_run_completed"


def test_agent_run_sse_stream_replays_event_store(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """SSE 端点只能从 AgentRunEvent Store 回放已有事件。"""

    monkeypatch.setattr(review_reasoning, "missing_book_generation_env", lambda: ["STORYFORGE_LLM_API_KEY"])

    with client.websocket_connect("/api/ide/agent/sessions/session-agent-run-sse") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "run_id": "run-agent-sse",
                "user_message": "解释这一段",
                "intent": "chat.explain",
                "args": {"context": "林岚走进港口。"},
            }
        )
        websocket.receive_json()

    response = client.get("/api/agent-runs/run-agent-sse/events/stream")
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/event-stream")
    body = response.text
    assert "event: agent_run_started" in body
    assert "event: agent_run_completed" in body
    payload = json.loads(body.split("data: ", 1)[1].split("\n\n", 1)[0])
    assert payload["event_type"] == "agent_run_started"
    assert payload["payload"]["run_id"] == "run-agent-sse"


def test_websocket_control_messages_are_persisted_as_agent_run_events(client: TestClient) -> None:
    """权限确认和暂停控制消息必须进入 AgentRunEvent Store。"""

    with client.websocket_connect("/api/ide/agent/sessions/session-agent-run-control") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "run_id": "run-agent-control",
                "user_message": "解释这一段",
                "intent": "chat.explain",
                "args": {"context": "林岚走进港口。"},
            }
        )
        websocket.receive_json()
        for message_type in ("approve_permission", "pause_run", "resume_run", "stop_run"):
            websocket.send_json(
                {
                    "type": message_type,
                    "run_id": "run-agent-control",
                    "payload": {"reason": "测试控制通道"},
                }
            )
            ack = websocket.receive_json()
            assert ack["status"] == "recorded"
            assert ack["run_id"] == "run-agent-control"

    events = client.get("/api/agent-runs/run-agent-control/events").json()
    event_types = [event["event_type"] for event in events]
    assert "permission_approved" in event_types
    assert "pause_run" in event_types
    assert "resume_run" in event_types
    assert "stop_run" in event_types
    run = client.get("/api/agent-runs/run-agent-control").json()
    assert run["status"] == "stopped"
    assert run["current_step"] == "stopped"


def test_websocket_command_with_run_id_is_persisted_as_tool_trace(client: TestClient) -> None:
    """WebSocket command 若携带 run_id，也必须进入同一个 AgentRun 事件源。"""

    with client.websocket_connect("/api/ide/agent/sessions/session-agent-run-command") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "run_id": "run-agent-command",
                "user_message": "解释这一段",
                "intent": "chat.explain",
                "args": {"context": "林岚走进港口。"},
            }
        )
        websocket.receive_json()
        websocket.send_json(
            {
                "type": "command",
                "run_id": "run-agent-command",
                "command_id": "audit.open",
                "args": {},
            }
        )
        command_result = websocket.receive_json()

    assert command_result["type"] == "command_result"
    events = client.get("/api/agent-runs/run-agent-command/events").json()
    command_events = [
        event for event in events
        if event["event_type"] == "tool_trace" and event["payload"].get("command_id") == "audit.open"
    ]
    assert len(command_events) == 1
    assert command_events[0]["payload"]["result"]["command_id"] == "audit.open"


def test_book_run_progress_is_projected_to_agent_run_event_store(
    client: TestClient,
    session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """BookRun 旁路进度也要派生为 long-running AgentRun 事件和 checkpoint artifact。"""

    from app.domains.provider_gateway import service as provider_service
    from app.domains.provider_gateway.runtime_config import load_runtime_provider_config

    monkeypatch.setenv("STORYFORGE_LLM_PROVIDER", "deterministic")
    monkeypatch.setenv("STORYFORGE_LLM_MODEL", "storyforge-deterministic-writer")
    monkeypatch.delenv("STORYFORGE_LLM_API_KEY", raising=False)
    load_runtime_provider_config.cache_clear()
    provider_service.cache_delete_pattern("storyforge:provider-resolution:*")

    scope = seed_locked_blueprint(session_factory)
    created = client.post("/api/book-runs", json={**scope, "token_budget": 500}).json()
    run_id = f"bookrun-{created['id']}"

    run = client.get(f"/api/agent-runs/{run_id}").json()
    assert run["book_run_id"] == created["id"]
    assert run["scope"]["book_run_id"] == created["id"]

    progress = {
        "completed_chapters": [
            {"chapter_index": 1, "model_run_id": 11, "judge_report_id": 12, "approved_scene_id": 13}
        ],
        "budget": {"tokens_used": 420},
    }
    progress_response = client.patch(
        f"/api/book-runs/{created['id']}/progress",
        json={"status": "completed", "current_chapter_index": 1, "progress": progress},
    )
    assert progress_response.status_code == 200, progress_response.text

    events = client.get(f"/api/agent-runs/{run_id}/events").json()
    assert [event["event_type"] for event in events].count("agent_run_started") == 1
    started_event = next(event for event in events if event["event_type"] == "agent_run_started")
    assert started_event["payload"]["writing_run_id"] == created["id"]
    assert started_event["payload"]["scope"] == "full_book"
    assert started_event["payload"]["mode"] == "managed"
    assert started_event["payload"]["book_run_id"] == created["id"]
    tool_trace_event = next(
        event for event in events if event["event_type"] == "tool_trace" and event["actor"] == "bookrun-agent"
    )
    assert tool_trace_event["payload"]["writing_run_id"] == created["id"]
    assert tool_trace_event["payload"]["scope"] == "full_book"
    assert tool_trace_event["payload"]["mode"] == "managed"
    assert tool_trace_event["payload"]["book_run_id"] == created["id"]
    assert events[-1]["event_type"] == "agent_run_completed"

    checkpoints = client.get(f"/api/agent-runs/{run_id}/checkpoints").json()
    assert len(checkpoints) == 1
    assert checkpoints[0]["kind"] == "bookrun_checkpoint"
    assert checkpoints[0]["payload"]["writing_run_id"] == created["id"]
    assert checkpoints[0]["payload"]["scope"] == "full_book"
    assert checkpoints[0]["payload"]["mode"] == "managed"
    assert checkpoints[0]["payload"]["checkpoint"][0]["chapter_index"] == 1


def test_agent_run_control_channel_updates_bound_bookrun_status(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """bookrun-{id} 的 AgentRun 控制消息必须驱动真实 BookRun 状态机。"""

    scope = seed_locked_blueprint(session_factory)
    created = client.post("/api/book-runs", json=scope).json()
    run_id = f"bookrun-{created['id']}"

    with client.websocket_connect("/api/ide/agent/sessions/session-bookrun-control") as websocket:
        websocket.send_json(
            {
                "type": "pause_run",
                "run_id": run_id,
                "payload": {"reason": "AgentRun 控制暂停"},
            }
        )
        paused_ack = websocket.receive_json()
        websocket.send_json({"type": "resume_run", "run_id": run_id, "payload": {}})
        resumed_ack = websocket.receive_json()
        websocket.send_json(
            {
                "type": "stop_run",
                "run_id": run_id,
                "payload": {"reason": "AgentRun 控制停止"},
            }
        )
        stopped_ack = websocket.receive_json()

    assert paused_ack["type"] == "pause_run"
    assert resumed_ack["type"] == "resume_run"
    assert stopped_ack["type"] == "stop_run"
    book_run = client.get(f"/api/book-runs/{created['id']}").json()
    assert book_run["status"] == "stopped"
    assert book_run["progress"]["pause_reason"] == "AgentRun 控制暂停"
    assert book_run["progress"]["resume_from_chapter_index"] == 1
    assert book_run["progress"]["stop_reason"] == "AgentRun 控制停止"

    events = client.get(f"/api/agent-runs/{run_id}/events").json()
    control_events = [
        event
        for event in events
        if event["actor"] == "desktop-ide" and event["event_type"] in {"pause_run", "resume_run", "stop_run"}
    ]
    assert [event["event_type"] for event in control_events] == ["pause_run", "resume_run", "stop_run"]
    assert control_events[0]["payload"]["writing_run"]["scope"] == "full_book"
    assert control_events[0]["payload"]["writing_run"]["mode"] == "managed"
    assert control_events[0]["payload"]["writing_run_id"] == created["id"]
    assert control_events[0]["payload"]["book_run_id"] == created["id"]
    assert control_events[0]["payload"]["book_run"]["status"] == "paused_by_user"
    assert control_events[1]["payload"]["writing_run"]["status"] == "running"
    assert control_events[1]["payload"]["book_run"]["status"] == "running"
    assert control_events[2]["payload"]["writing_run"]["status"] == "stopped"
    assert control_events[2]["payload"]["book_run"]["status"] == "stopped"


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

    with client.websocket_connect("/api/ide/agent/sessions/session-agent-role-hints") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "stream": True,
                "run_id": "run-agent-role-hints",
                "user_message": "@剧情 看看这一章冲突够不够",
                "args": {
                    "file_path": "正文/第04章.md",
                    "content": "林岚走进港口。灯塔熄灭了。",
                    "agent_role_hints": ["plot_reviewer"],
                    "agent_role_mentions": ["@剧情"],
                },
            }
        )
        started = websocket.receive_json()
        received = []
        while not received or received[-1]["type"] != "agent_result":
            received.append(websocket.receive_json())

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

    with client.websocket_connect("/api/ide/agent/sessions/session-agent-role-unknown") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "stream": True,
                "run_id": "run-agent-role-unknown",
                "user_message": "@未知 审一下这一章",
                "intent": "file.review",
                "args": {
                    "file_path": "正文/第05章.md",
                    "content": "林岚走进港口。灯塔熄灭了。",
                    "agent_role_hints": ["unknown_reviewer"],
                    "agent_role_mentions": ["@未知"],
                },
            }
        )
        started = websocket.receive_json()
        received = []
        while not received or received[-1]["type"] != "agent_result":
            received.append(websocket.receive_json())

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

    with client.websocket_connect("/api/ide/agent/sessions/session-agent-role-plot") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "run_id": "run-agent-role-plot",
                "user_message": "@剧情 看看冲突够不够",
                "args": {
                    "file_path": "正文/第06章.md",
                    "content": "林岚走进港口。灯塔熄灭了。",
                    "agent_role_mentions": ["@剧情"],
                },
            }
        )
        result = websocket.receive_json()

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

    with client.websocket_connect("/api/ide/agent/sessions/session-agent-role-multiple") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "run_id": "run-agent-role-multiple",
                "user_message": "@人物 @文风 审一下",
                "intent": "file.review",
                "args": {
                    "file_path": "正文/第07章.md",
                    "content": "林岚走进港口。灯塔熄灭了。",
                    "agent_role_hints": ["character_reviewer", "prose_reviewer"],
                    "agent_role_mentions": ["@人物", "@文风"],
                },
            }
        )
        result = websocket.receive_json()

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

    with client.websocket_connect("/api/ide/agent/sessions/session-agent-role-bookrun") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "run_id": "run-agent-role-bookrun",
                "user_message": "@写作任务 把这个文件改得更紧一点",
                "intent": "file.revise",
                "args": {
                    "file_path": "正文/第08章.md",
                    "content": "当前正文",
                    "agent_role_hints": ["bookrun_agent"],
                    "agent_role_mentions": ["@写作任务"],
                },
            }
        )
        result = websocket.receive_json()

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

    with client.websocket_connect("/api/ide/agent/sessions/session-agent-run-consistency") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "run_id": "run-agent-consistency",
                "user_message": "检查这一章的设定、伏笔和时间线一致性",
                "intent": "file.review",
                "args": {
                    "file_path": "正文/第03章.md",
                    "content": "林岚在第十天回到港口，却又说昨天才第一次见到灯塔。",
                    "context_bundle": {"files": []},
                },
            }
        )
        while True:
            message = websocket.receive_json()
            if message["type"] == "agent_result":
                break

    events = client.get("/api/agent-runs/run-agent-consistency/events").json()
    plan_event = next(event for event in events if event["event_type"] == "agent_plan_created")
    assert plan_event["payload"]["selected_skill"]["name"] == "consistency_review"
    assert plan_event["payload"]["skill_plan_template"][1]["step"] == "continuity.review"


def test_agent_run_returns_404_for_missing_run(client: TestClient) -> None:
    """不存在的 AgentRun 应返回明确 404。"""

    response = client.get("/api/agent-runs/not-found")

    assert response.status_code == 404
    assert response.json() == {"detail": "AgentRun 不存在。"}
