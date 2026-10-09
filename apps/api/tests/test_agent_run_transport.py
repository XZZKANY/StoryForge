from __future__ import annotations

import json

import pytest
from agent_transport import agent_result, control_agent, stream_agent_message
from fastapi.testclient import TestClient

from app.domains.ide import review_reasoning


def test_websocket_user_message_persists_agent_run_events_and_artifacts(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """IDE Agent user_message 必须创建可 REST 回放的 AgentRun 事件流。"""

    monkeypatch.setattr(review_reasoning, "missing_llm_env", lambda: ["STORYFORGE_LLM_API_KEY"])

    frames = stream_agent_message(
        client,
        "session-agent-run-review",
        run_id="run-agent-review",
        user_message="审查当前章节的结构、人物和节奏",
        intent="file.review",
        args={
            "file_path": "正文/第01章.md",
            "content": "林岚走进港口。她看见灯塔熄灭。其实这说明旧案还没结束。",
            "project_path": "D:/novels/demo",
            "context_bundle": {"files": []},
        },
    )
    started = frames[0]
    received = frames[1:]

    assert started["type"] == "agent_run_started"
    assert started["run_id"] == "run-agent-review"
    assert started["permission_profile"] == "ask"
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
    assert run["permission_profile"] == "ask"
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
    assert event_types[-2:] == ["agent_run_completed", "agent_execution_settled"]
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
    # 桌面端会话历史按项目过滤依赖 agent 建会话时落 project_path
    assert session_response.json()["project_path"] == "D:/novels/demo"


def test_agent_stream_rejects_unknown_permission_profile_before_starting_a_run(client: TestClient) -> None:
    response = client.post(
        "/api/ide/agent/sessions/session-agent-invalid-permission/stream",
        json={
            "run_id": "run-agent-invalid-permission",
            "user_message": "不要静默放行未知权限",
            "permission_profile": "unknown-profile",
            "args": {},
        },
    )

    assert response.status_code == 422
    assert "不支持的 Agent 权限档位" in response.text


def test_agent_run_records_permission_required_for_proposed_patch(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """proposed_patch 只能作为需确认 artifact，不能绕过作者确认。"""

    from app.domains.assistant import service as assistant_service

    monkeypatch.setattr(assistant_service, "missing_llm_env", lambda: [])
    monkeypatch.setattr(
        assistant_service,
        "_call_llm",
        lambda source, *, system_prompt, user_prompt: {
            "content": "修订后正文",
            "completion_tokens": 8,
            "latency_ms": 10,
        },
    )
    # 产字三条路径走流式聚合传输：同一个假函数同时挡住两个符号。
    monkeypatch.setattr(assistant_service, "_call_llm_streamed", assistant_service._call_llm)

    message = agent_result(
        client,
        "session-agent-run-revise",
        run_id="run-agent-revise",
        user_message="把这个文件改得更紧一点",
        intent="file.revise",
        args={
            "file_path": "正文/第02章.md",
            "content": "当前正文",
            "instruction": "压缩解释性表达",
        },
    )

    assert message["type"] == "agent_result"
    assert message["run_id"] == "run-agent-revise"
    assert message["proposed_patch"]["requires_confirmation"] is True

    events = client.get("/api/agent-runs/run-agent-revise/events").json()
    event_types = [event["event_type"] for event in events]
    assert "permission_required" in event_types
    permission_event = next(event for event in events if event["event_type"] == "permission_required")
    assert permission_event["actor"] == "permission-gate"
    assert permission_event["payload"]["permission_profile"] == "ask"
    assert permission_event["payload"]["proposed_patch"]["kind"] == "file_revision"
    assert permission_event["payload"]["blocked_tool"] == "file.revise"
    # F10：permission_required 也是终态之一，payload 必须带 assistant_session_id，
    # 否则前端超时转轮询后 reconstructAgentResultFromEvents 永远返回 null，待确认补丁回不来。
    assert isinstance(permission_event["payload"]["assistant_session_id"], int)
    assert permission_event["payload"]["assistant_session_id"] == message["assistant_session_id"]
    assert permission_event["payload"]["requires_user_confirmation"] is True
    assert "agent_run_completed" not in event_types

    run = client.get("/api/agent-runs/run-agent-revise").json()
    assert run["status"] == "paused"
    assert run["current_step"] == "permission.confirm"

    artifacts = client.get("/api/agent-runs/run-agent-revise/artifacts").json()
    assert [artifact["kind"] for artifact in artifacts] == ["review_report", "proposed_patch"]
    assert artifacts[-1]["requires_confirmation"] is True


def test_hidden_compaction_system_job_runs_for_long_sessions(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """长会话的模型检查点隐藏持久化，不污染普通 artifact 列表。"""
    from compaction_test_support import SummaryProvider

    from app.domains.agent_runs import compaction_job

    monkeypatch.setattr(compaction_job, "build_llm_provider", lambda source: SummaryProvider())
    monkeypatch.setattr(compaction_job, "resolved_llm_model", lambda source: "fake-model")

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

    message = agent_result(
        client,
        "session-long-compaction",
        run_id="run-long-compaction",
        user_message="解释这一段",
        intent="chat.explain",
        assistant_session_id=assistant_session_id,
        args={"context": "林岚走进港口。"},
    )

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
    monkeypatch.setattr(review_reasoning, "missing_llm_env", lambda: ["STORYFORGE_LLM_API_KEY"])

    message = agent_result(
        client,
        "session-agent-runtime-no-legacy",
        run_id="run-runtime-no-legacy",
        user_message="审查当前章节的结构、人物和节奏",
        intent="file.review",
        args={
            "file_path": "正文/第01章.md",
            "content": "林岚走进港口。她看见灯塔熄灭。其实这说明旧案还没结束。",
            "context_bundle": {"files": []},
        },
    )

    assert message["type"] == "agent_result"
    assert message["runtime_mode"] == "agent_runtime"
    assert [trace["tool_name"] for trace in message["tool_trace"]][:2] == ["context.load", "subagent.plot_reviewer"]


def test_permission_approval_completes_paused_agent_run(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """permission_required 暂停 run；approve_permission 才能把待确认步骤收口。"""

    from app.domains.assistant import service as assistant_service

    monkeypatch.setattr(assistant_service, "missing_llm_env", lambda: [])
    monkeypatch.setattr(
        assistant_service,
        "_call_llm",
        lambda source, *, system_prompt, user_prompt: {
            "content": "修订后正文",
            "completion_tokens": 8,
            "latency_ms": 10,
        },
    )
    # 产字三条路径走流式聚合传输：同一个假函数同时挡住两个符号。
    monkeypatch.setattr(assistant_service, "_call_llm_streamed", assistant_service._call_llm)

    stream_agent_message(
        client,
        "session-agent-run-approve",
        run_id="run-agent-approve",
        user_message="把这个文件改得更紧一点",
        intent="file.revise",
        args={"file_path": "正文/第02章.md", "content": "当前正文"},
    )
    ack = control_agent(
        client,
        "session-agent-run-approve",
        control_type="approve_permission",
        run_id="run-agent-approve",
        payload={"reason": "测试批准"},
    )

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

    monkeypatch.setattr(review_reasoning, "missing_llm_env", lambda: ["STORYFORGE_LLM_API_KEY"])

    stream_agent_message(
        client,
        "session-agent-run-sse",
        run_id="run-agent-sse",
        user_message="解释这一段",
        intent="chat.explain",
        args={"context": "林岚走进港口。"},
    )

    response = client.get("/api/agent-runs/run-agent-sse/events/stream")
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/event-stream")
    body = response.text
    assert "event: agent_run_started" in body
    assert "event: agent_run_completed" in body
    assert "event: tool_completed" not in body
    payload = json.loads(body.split("data: ", 1)[1].split("\n\n", 1)[0])
    assert payload["event_type"] == "agent_run_started"
    assert payload["payload"]["run_id"] == "run-agent-sse"


def test_control_messages_are_persisted_as_agent_run_events(client: TestClient) -> None:
    """权限确认和暂停控制消息必须进入 AgentRunEvent Store；且守卫式 status 写保证迟到的
    控制消息不能复活已终态的 run——chat.explain 同步跑完即 completed，随后到达的
    pause/resume/stop 只作为事件留痕，不把 completed 拖回 paused/running/stopped（B1-001）。"""

    stream_agent_message(
        client,
        "session-agent-run-control",
        run_id="run-agent-control",
        user_message="解释这一段",
        intent="chat.explain",
        args={"context": "林岚走进港口。"},
    )
    for message_type in ("approve_permission", "pause_run", "resume_run", "stop_run"):
        ack = control_agent(
            client,
            "session-agent-run-control",
            control_type=message_type,
            run_id="run-agent-control",
            payload={"reason": "测试控制通道"},
        )
        assert ack["status"] == "recorded"
        assert ack["run_id"] == "run-agent-control"

    events = client.get("/api/agent-runs/run-agent-control/events").json()
    event_types = [event["event_type"] for event in events]
    assert "permission_approved" in event_types
    assert "pause_run" in event_types
    assert "resume_run" in event_types
    assert "stop_run" in event_types
    # 守卫式 status 写：run 在收到这些控制消息前已 completed，迟到的控制只留事件、不改终态。
    run = client.get("/api/agent-runs/run-agent-control").json()
    assert run["status"] == "completed"
    assert run["current_step"] == "completed"


def test_control_from_foreign_session_is_rejected_without_leaking_existence(client: TestClient) -> None:
    """归属校验（B1-002）：普通 chat run 只能被其所属 session 控制。另一会话拿到 run_id
    也不能 stop/pause/inspect 它，错误与「run 不存在」无法区分（不泄漏存在性）；归属会话仍正常。"""

    stream_agent_message(
        client,
        "session-owner",
        run_id="run-owned-by-a",
        user_message="解释这一段",
        intent="chat.explain",
        args={"context": "林岚走进港口。"},
    )

    foreign = control_agent(
        client,
        "session-intruder",
        control_type="stop_run",
        run_id="run-owned-by-a",
        payload={},
    )
    assert foreign["type"] == "error"
    assert "不存在" in foreign["detail"]

    # 跨会话 stop 未生效：run 仍是归属会话 A 跑完的 completed，session_id 未被 re-home。
    run = client.get("/api/agent-runs/run-owned-by-a").json()
    assert run["status"] == "completed"
    assert run["session_id"] == "session-owner"

    # 对照：归属会话 A 的控制被正常受理（证明拒绝是归属校验而非普遍失败）。
    ack = control_agent(
        client,
        "session-owner",
        control_type="stop_run",
        run_id="run-owned-by-a",
        payload={},
    )
    assert ack["status"] == "recorded"

