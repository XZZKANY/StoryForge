from __future__ import annotations

from pathlib import Path

import pytest
from agent_loop_runtime_test_support import _enable_loop_env, _fake_llm_script
from agent_transport import stream_agent_message
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.domains.agent_runs.loop.support import history_messages
from app.domains.agent_runs.models import AgentArtifact, AgentRun
from app.domains.agent_runs.system_jobs import (
    SYSTEM_COMPACTION_ARTIFACT_KIND,
    SYSTEM_COMPACTION_SCHEMA_VERSION,
)
from app.domains.assistant.models import AssistantMessage, AssistantSession

pytest_plugins = ("agent_loop_runtime_test_fixtures",)


def test_next_loop_request_injects_latest_compaction_summary(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    novel_project: Path,
) -> None:
    _enable_loop_env(monkeypatch)
    calls = _fake_llm_script(
        monkeypatch,
        [
            {"content": "第一轮结果", "tool_calls": [], "completion_tokens": 3},
            {"content": "第二轮结果", "tool_calls": [], "completion_tokens": 3},
        ],
    )
    response = client.post(
        "/api/assistant/sessions",
        json={
            "title": "压缩回注",
            "task_type": "ide_agent_orchestration",
            "messages": [
                {
                    "role": "user" if index % 2 == 0 else "assistant",
                    "content": f"历史消息 {index}",
                }
                for index in range(14)
            ],
        },
    )
    assert response.status_code == 201, response.text
    assistant_session_id = response.json()["id"]

    for ordinal in (1, 2):
        frames = stream_agent_message(
            client,
            f"runtime-compaction-{ordinal}",
            run_id=f"run-runtime-compaction-{ordinal}",
            user_message=f"第 {ordinal} 轮问题",
            assistant_session_id=assistant_session_id,
            args={"project_path": str(novel_project), "context_bundle": {"files": []}},
        )
        assert frames[-1]["type"] == "agent_result"

    assert len(calls) == 2
    second_messages = calls[1]["messages"]
    injected = [
        message
        for message in second_messages
        if message.get("role") == "system" and "自动压缩摘要" in str(message.get("content"))
    ]
    assert len(injected) == 1
    assert "已压缩" in str(injected[0]["content"])
    assert not any(message.get("content") == "历史消息 0" for message in second_messages)
    assert any(message.get("content") == "历史消息 12" for message in second_messages)
    assert any(message.get("content") == "第一轮结果" for message in second_messages)


def test_history_falls_back_when_latest_compaction_artifact_is_invalid(session: Session) -> None:
    assistant_session = AssistantSession(
        title="坏摘要回退",
        task_type="ide_agent_orchestration",
        messages=[
            AssistantMessage(role="user" if index % 2 == 0 else "assistant", content=f"消息 {index}")
            for index in range(14)
        ],
    )
    session.add(assistant_session)
    session.commit()
    run = AgentRun(
        public_id="run-invalid-compaction",
        session_id="invalid-compaction",
        assistant_session_id=assistant_session.id,
        goal="验证坏摘要回退",
        scope={},
        budget={},
        root_plan=[],
    )
    session.add(run)
    session.commit()
    boundary_id = assistant_session.messages[9].id
    session.add_all(
        [
            AgentArtifact(
                run_id=run.id,
                kind=SYSTEM_COMPACTION_ARTIFACT_KIND,
                payload={
                    "schema_version": SYSTEM_COMPACTION_SCHEMA_VERSION,
                    "status": "completed",
                    "assistant_session_id": assistant_session.id,
                    "covered_through_message_id": boundary_id,
                    "summary": "这条旧摘要本来有效。",
                },
            ),
            AgentArtifact(
                run_id=run.id,
                kind=SYSTEM_COMPACTION_ARTIFACT_KIND,
                payload={
                    "status": "completed",
                    "assistant_session_id": assistant_session.id,
                    "covered_through_message_id": boundary_id,
                    "summary": "最新 artifact 缺少 schema，不能退回复用旧摘要。",
                },
            ),
        ]
    )
    session.commit()

    history = history_messages(session, assistant_session.id)

    assert history == [
        {"role": message.role, "content": message.content} for message in assistant_session.messages[-12:]
    ]
    assert all(message["role"] != "system" for message in history)


def test_history_does_not_reuse_compaction_from_another_session(session: Session) -> None:
    current_session = AssistantSession(
        title="当前会话",
        task_type="ide_agent_orchestration",
        messages=[
            AssistantMessage(role="user" if index % 2 == 0 else "assistant", content=f"当前消息 {index}")
            for index in range(14)
        ],
    )
    other_session = AssistantSession(
        title="其他会话",
        task_type="ide_agent_orchestration",
        messages=[AssistantMessage(role="user", content="其他会话消息")],
    )
    session.add_all([current_session, other_session])
    session.commit()
    other_run = AgentRun(
        public_id="run-other-session-compaction",
        session_id="other-session-compaction",
        assistant_session_id=other_session.id,
        goal="验证会话隔离",
        scope={},
        budget={},
        root_plan=[],
    )
    session.add(other_run)
    session.commit()
    session.add(
        AgentArtifact(
            run_id=other_run.id,
            kind=SYSTEM_COMPACTION_ARTIFACT_KIND,
            payload={
                    "schema_version": SYSTEM_COMPACTION_SCHEMA_VERSION,
                    "status": "completed",
                    "assistant_session_id": current_session.id,
                    "covered_through_message_id": current_session.messages[9].id,
                    "summary": "payload 伪装成当前会话，但所属 run 是其他会话。",
            },
        )
    )
    session.commit()

    history = history_messages(session, current_session.id)

    assert history == [{"role": message.role, "content": message.content} for message in current_session.messages[-12:]]
    assert all(message["role"] != "system" for message in history)
