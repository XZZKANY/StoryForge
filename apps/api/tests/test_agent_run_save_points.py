from __future__ import annotations

import json

import pytest
from agent_run_test_support import _seed_agent_run, _stored_run_artifacts, _stored_run_events
from agent_transport import stream_agent_message
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.common.redaction import REDACTED
from app.domains.agent_runs import event_types
from app.domains.agent_runs.models import AgentArtifact, AgentRunEvent
from app.domains.ide import review_reasoning


def test_save_point_projection_reconstructs_pending_permission_and_patch(session: Session) -> None:
    """阶段 5 第一刀：pending permission/proposed patch 必须能从事实源投影出来。"""

    from app.domains.agent_runs.save_points import build_agent_run_save_point_projection
    from app.domains.agent_runs.service import record_agent_artifact, record_agent_event

    run = _seed_agent_run(session, public_id="run-save-point-pending")
    run.status = "paused"
    run.current_step = "permission.confirm"
    session.add(run)
    session.commit()
    permission_event = record_agent_event(
        session,
        run,
        event_type="permission_required",
        actor="permission-gate",
        message="需要确认。",
        payload={"blocked_tool": "file.revise", "reason": "requires_user_confirmation"},
    )
    patch = record_agent_artifact(
        session,
        run,
        kind="proposed_patch",
        payload={"kind": "file_revision", "file_path": "正文/第02章.md", "requires_confirmation": True},
        requires_confirmation=True,
    )

    projection = build_agent_run_save_point_projection(
        run,
        events=_stored_run_events(session, run),
        artifacts=_stored_run_artifacts(session, run),
    )

    assert projection["pending"] == {
        "permission_required": True,
        "permission_event_id": permission_event.id,
        "blocked_tool": "file.revise",
        "proposed_patch_artifact_id": patch.id,
        "runtime_pending_call_artifact_id": None,
        "runtime_pending_tool": None,
    }
    assert projection["recoverability"]["resume_strategy"] == "await_permission_decision"
    save_points = projection["save_points"]
    assert [item["kind"] for item in save_points] == ["permission_required", "artifact_persisted"]
    assert save_points[-1]["artifact_id"] == patch.id


def test_save_point_projection_detects_bookrun_checkpoint(session: Session) -> None:
    """BookRun checkpoint 是当前已有的真实可恢复边界。"""

    from app.domains.agent_runs.save_points import build_agent_run_save_point_projection
    from app.domains.agent_runs.service import record_agent_artifact

    run = _seed_agent_run(session, public_id="run-save-point-checkpoint")
    checkpoint = record_agent_artifact(
        session,
        run,
        kind="bookrun_checkpoint",
        payload={
            "book_run_id": 7,
            "writing_run_id": 7,
            "status": "running",
            "tokens_used": 420,
            "token_budget": 900,
            "completed_count": 1,
            "checkpoint": [{"chapter_index": 1, "status": "completed", "model_run_id": 11}],
        },
        requires_confirmation=False,
    )

    projection = build_agent_run_save_point_projection(
        run,
        events=_stored_run_events(session, run),
        artifacts=_stored_run_artifacts(session, run),
    )

    assert projection["recoverability"]["can_retry_from_checkpoint"] is True
    assert projection["recoverability"]["latest_checkpoint_artifact_id"] == checkpoint.id
    assert projection["recoverability"]["resume_strategy"] == "bookrun_checkpoint"
    checkpoint_save_point = next(item for item in projection["save_points"] if item["kind"] == "bookrun_checkpoint")
    assert checkpoint_save_point["summary"]["book_run_id"] == 7
    assert checkpoint_save_point["summary"]["checkpoint_count"] == 1
    assert checkpoint_save_point["summary"]["tokens_used"] == 420
    assert checkpoint_save_point["summary"]["token_budget"] == 900
    assert checkpoint_save_point["summary"]["completed_count"] == 1
    assert checkpoint_save_point["summary"]["latest_checkpoint_chapter_index"] == 1
    assert checkpoint_save_point["summary"]["latest_checkpoint_status"] == "completed"
    assert checkpoint_save_point["summary"]["latest_checkpoint_model_run_id"] == 11


def test_save_point_projection_does_not_mark_failed_run_retryable_without_checkpoint(session: Session) -> None:
    """失败 run 没有 checkpoint 时不能被投影成 retry-safe。"""

    from app.domains.agent_runs.save_points import build_agent_run_save_point_projection
    from app.domains.agent_runs.service import record_agent_event

    run = _seed_agent_run(session, public_id="run-save-point-failed")
    run.status = "failed"
    run.current_step = "failed"
    session.add(run)
    session.commit()
    failed_event = record_agent_event(
        session,
        run,
        event_type="agent_run_failed",
        actor="root-agent",
        message="provider timeout",
        payload={"runtime": "agent_runtime"},
    )

    projection = build_agent_run_save_point_projection(
        run,
        events=_stored_run_events(session, run),
        artifacts=_stored_run_artifacts(session, run),
    )

    assert projection["recoverability"] == {
        "can_retry_from_checkpoint": False,
        "latest_checkpoint_artifact_id": None,
        "failed_without_checkpoint": True,
        "terminal_event_id": failed_event.id,
        "resume_strategy": "manual_restart_required",
    }
    assert projection["runtime_recovery"]["manual_restart_required"] is True
    assert projection["runtime_recovery"]["automatic_resume_supported"] is False
    assert [item["kind"] for item in projection["save_points"]] == ["run_failed"]


def test_tool_recovery_payload_includes_runtime_execution_marker() -> None:
    """runtime recovery tracer 只写入可回放 marker，不新增第二套事实源。"""

    from app.domains.agent_runs.runtime_recovery import build_tool_recovery_payload
    from app.domains.agent_runs.tooling import list_agent_runtime_tool_specs
    from app.domains.agent_runs.trace import AgentToolTrace

    specs = {spec.name: spec for spec in list_agent_runtime_tool_specs()}
    payload = build_tool_recovery_payload(
        AgentToolTrace(tool_name="context.load", status="completed", input_summary={"file_path": "正文/第01章.md"}),
        0,
        spec=specs["context.load"],
    )

    assert payload["kind"] == "tool_completed"
    assert payload["retry_safe"] is True
    assert payload["idempotent"] is True
    assert payload["execution_marker"] == {
        "kind": "after_tool",
        "source": "tool_trace",
        "tool_name": "context.load",
        "tool_index": 0,
        "status": "completed",
        "replay_safe": True,
        "resume_strategy": "replay_from_tool_boundary",
        "reason": "retry_safe_idempotent_tool",
    }

    review_payload = build_tool_recovery_payload(
        AgentToolTrace(tool_name="file.review", status="completed", input_summary={}),
        1,
        spec=specs["file.review"],
    )
    assert review_payload["execution_marker"]["replay_safe"] is False
    assert review_payload["execution_marker"]["resume_strategy"] == "manual_restart_required"
    assert review_payload["execution_marker"]["reason"] == "tool_not_retry_safe"


def test_save_point_projection_maps_tool_trace_to_tool_completed(session: Session) -> None:
    """现有 tool_trace event 是阶段 5 可利用的 tool_completed durable boundary。"""

    from app.domains.agent_runs.save_points import build_agent_run_save_point_projection
    from app.domains.agent_runs.service import record_agent_event

    run = _seed_agent_run(session, public_id="run-save-point-tool-trace")
    event = record_agent_event(
        session,
        run,
        event_type="tool_trace",
        actor="tool-registry",
        message="工具 context.load 返回 completed。",
        payload={
            "index": 0,
            "trace": {
                "tool_name": "context.load",
                "status": "completed",
                "audit_event_id": "audit-1",
            },
            "recovery": {
                "kind": "tool_completed",
                "tool_name": "context.load",
                "status": "completed",
                "index": 0,
                "retry_safe": True,
                "idempotent": True,
                "execution_mode": "sync",
                "artifact_kinds": [],
                "execution_marker": {
                    "kind": "after_tool",
                    "source": "tool_trace",
                    "tool_name": "context.load",
                    "tool_index": 0,
                    "status": "completed",
                    "replay_safe": True,
                    "resume_strategy": "replay_from_tool_boundary",
                    "reason": "retry_safe_idempotent_tool",
                },
            },
        },
    )

    projection = build_agent_run_save_point_projection(
        run,
        events=_stored_run_events(session, run),
        artifacts=_stored_run_artifacts(session, run),
    )

    assert projection["save_points"] == [
        {
            "kind": "tool_completed",
            "source": "event",
            "event_id": event.id,
            "event_type": "tool_trace",
            "sequence": event.sequence,
            "summary": {
                "kind": "tool_completed",
                "tool_name": "context.load",
                "status": "completed",
                "index": 0,
                "retry_safe": True,
                "idempotent": True,
                "execution_mode": "sync",
                "artifact_kinds": [],
                "execution_marker": {
                    "kind": "after_tool",
                    "source": "tool_trace",
                    "tool_name": "context.load",
                    "tool_index": 0,
                    "status": "completed",
                    "replay_safe": True,
                    "resume_strategy": "replay_from_tool_boundary",
                    "reason": "retry_safe_idempotent_tool",
                },
            },
        }
    ]
    assert projection["runtime_recovery"] == {
        "latest_execution_marker": {
            "event_id": event.id,
            "sequence": event.sequence,
            "kind": "after_tool",
            "source": "tool_trace",
            "tool_name": "context.load",
            "status": "completed",
            "resume_strategy": "replay_from_tool_boundary",
            "reason": "retry_safe_idempotent_tool",
            "tool_index": 0,
            "replay_safe": True,
        },
        "latest_replay_safe_marker": {
            "event_id": event.id,
            "sequence": event.sequence,
            "kind": "after_tool",
            "source": "tool_trace",
            "tool_name": "context.load",
            "status": "completed",
            "resume_strategy": "replay_from_tool_boundary",
            "reason": "retry_safe_idempotent_tool",
            "tool_index": 0,
            "replay_safe": True,
        },
        "latest_control": None,
        "latest_interruption": None,
        "latest_resume_diagnostic": None,
        "latest_failure": None,
        "latest_pending_call": None,
        "latest_pending_call_resolution": None,
        "automatic_resume_supported": False,
        "manual_restart_required": False,
    }


def test_failed_run_with_runtime_marker_still_requires_manual_restart_without_checkpoint(session: Session) -> None:
    """runtime marker 本身不是 checkpoint；失败且无 checkpoint 仍不能自动恢复。"""

    from app.domains.agent_runs.save_points import build_agent_run_save_point_projection
    from app.domains.agent_runs.service import record_agent_event

    run = _seed_agent_run(session, public_id="run-runtime-marker-failed")
    tool_event = record_agent_event(
        session,
        run,
        event_type="tool_trace",
        actor="tool-registry",
        message="工具 context.load 返回 completed。",
        payload={
            "index": 0,
            "trace": {"tool_name": "context.load", "status": "completed"},
            "recovery": {
                "kind": "tool_completed",
                "tool_name": "context.load",
                "status": "completed",
                "index": 0,
                "retry_safe": True,
                "idempotent": True,
                "execution_mode": "sync",
                "artifact_kinds": [],
                "execution_marker": {
                    "kind": "after_tool",
                    "source": "tool_trace",
                    "tool_name": "context.load",
                    "tool_index": 0,
                    "status": "completed",
                    "replay_safe": True,
                    "resume_strategy": "replay_from_tool_boundary",
                    "reason": "retry_safe_idempotent_tool",
                },
            },
        },
    )
    run.status = "failed"
    run.current_step = "failed"
    session.add(run)
    session.commit()
    record_agent_event(
        session,
        run,
        event_type="agent_run_failed",
        actor="root-agent",
        message="provider timeout",
        payload={"runtime": "agent_runtime"},
    )

    projection = build_agent_run_save_point_projection(
        run,
        events=_stored_run_events(session, run),
        artifacts=_stored_run_artifacts(session, run),
    )

    assert projection["recoverability"]["resume_strategy"] == "manual_restart_required"
    assert projection["recoverability"]["failed_without_checkpoint"] is True
    assert projection["runtime_recovery"]["latest_replay_safe_marker"]["tool_name"] == "context.load"
    assert projection["runtime_recovery"]["latest_failure"] == {
        "event_id": projection["recoverability"]["terminal_event_id"],
        "sequence": 2,
        "event_type": "agent_run_failed",
        "failed_without_checkpoint": True,
        "manual_restart_required": True,
        "resume_strategy": "manual_restart_required",
        "message": "provider timeout",
        "latest_execution_marker": {
            "event_id": tool_event.id,
            "sequence": 1,
            "kind": "after_tool",
            "tool_name": "context.load",
            "status": "completed",
            "resume_strategy": "replay_from_tool_boundary",
            "reason": "retry_safe_idempotent_tool",
            "replay_safe": True,
            "tool_index": 0,
        },
    }
    assert projection["runtime_recovery"]["manual_restart_required"] is True


def test_agent_run_save_points_endpoint_projects_existing_event_store(client: TestClient) -> None:
    """REST save-points endpoint 只读投影事件和 artifact，不替代 /events。"""

    stream_agent_message(
        client,
        "session-save-points-endpoint",
        run_id="run-save-points-endpoint",
        user_message="解释这一段",
        intent="chat.explain",
        args={"context": "林岚走进港口。"},
    )

    projection_response = client.get("/api/agent-runs/run-save-points-endpoint/save-points")
    events_response = client.get("/api/agent-runs/run-save-points-endpoint/events")

    assert projection_response.status_code == 200, projection_response.text
    assert events_response.status_code == 200, events_response.text
    projection = projection_response.json()
    events = events_response.json()
    assert projection["run_id"] == "run-save-points-endpoint"
    assert projection["recoverability"]["resume_strategy"] == "none"
    assert [item["kind"] for item in projection["save_points"]] == [
        "run_started",
        "run_completed",
    ]
    event_types = [event["event_type"] for event in events]
    assert event_types[0] == "agent_run_started"
    assert event_types[-1] == "agent_run_completed"


def test_agent_run_save_points_endpoint_projects_tool_recovery_metadata(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """save-points endpoint 可从旧 tool_trace 事件读取 recovery 元数据，不新增事件类型。"""

    monkeypatch.setattr(review_reasoning, "missing_book_generation_env", lambda: ["STORYFORGE_LLM_API_KEY"])

    stream_agent_message(
        client,
        "session-save-points-review",
        run_id="run-save-points-review",
        user_message="审查当前章节",
        intent="file.review",
        args={
            "file_path": "正文/第01章.md",
            "content": "林岚走进港口。她看见灯塔熄灭。",
            "context_bundle": {"files": []},
        },
    )

    events = client.get("/api/agent-runs/run-save-points-review/events").json()
    projection = client.get("/api/agent-runs/run-save-points-review/save-points").json()
    event_types = [event["event_type"] for event in events]
    assert "tool_completed" not in event_types
    assert "tool_trace" in event_types
    context_tool = next(
        item
        for item in projection["save_points"]
        if item["kind"] == "tool_completed" and item["summary"].get("tool_name") == "context.load"
    )
    assert context_tool["event_type"] == "tool_trace"
    assert context_tool["summary"]["retry_safe"] is True
    assert context_tool["summary"]["idempotent"] is True
    assert context_tool["summary"]["execution_mode"] == "sync"
    assert context_tool["summary"]["execution_marker"] == {
        "kind": "after_tool",
        "source": "tool_trace",
        "tool_name": "context.load",
        "status": "completed",
        "resume_strategy": "replay_from_tool_boundary",
        "reason": "retry_safe_idempotent_tool",
        "tool_index": 0,
        "replay_safe": True,
    }
    assert projection["runtime_recovery"]["latest_execution_marker"]["source"] == "tool_trace"
    assert projection["runtime_recovery"]["automatic_resume_supported"] is False


def test_agent_run_save_points_redacts_legacy_event_and_artifact_values(session: Session) -> None:
    """save-points 是读时投影，必须兜住绕过 service 脱敏的历史事实行。"""

    from app.domains.agent_runs.save_points import build_agent_run_save_point_projection

    run = _seed_agent_run(session, "run-save-points-redaction")
    run.status = "failed"
    control = AgentRunEvent(
        run_id=run.id,
        event_type=event_types.PAUSE_RUN,
        actor="desktop-ide",
        message="",
        payload={
            "control_type": "pause_run",
            "reason": "api_key=secret-savepoint-control",
            "source": "secret-source-value",
            "session_id": "session-secret-savepoint-control",
        },
        sequence=1,
    )
    failed = AgentRunEvent(
        run_id=run.id,
        event_type=event_types.AGENT_RUN_FAILED,
        actor="agent",
        message="provider failed with sk-secret-savepoint-failure",
        payload={},
        sequence=2,
    )
    artifact = AgentArtifact(
        run_id=run.id,
        kind="proposed_patch",
        payload={
            "kind": "file_revision",
            "file_path": "正文/第02章.md",
            "intent": "file.review",
            "api_key": "secret-savepoint-artifact",
            "context_output": {
                "file_path": "正文/第03章.md",
                "content": "password=secret-savepoint-context",
            },
        },
        requires_confirmation=True,
    )
    session.add_all([control, failed, artifact])
    session.commit()

    projection = build_agent_run_save_point_projection(
        run,
        events=_stored_run_events(session, run),
        artifacts=_stored_run_artifacts(session, run),
    )
    rendered = json.dumps(projection, ensure_ascii=False)

    assert "secret-savepoint-control" not in rendered
    assert "secret-source-value" not in rendered
    assert "sk-secret-savepoint-failure" not in rendered
    assert "secret-savepoint-artifact" not in rendered
    assert "secret-savepoint-context" not in rendered
    assert REDACTED in rendered
    assert projection["save_points"][-1]["summary"]["file_path"] == "正文/第03章.md"
    assert projection["save_points"][-1]["summary"]["content_chars"] == len(
        "password=secret-savepoint-context"
    )


def test_agent_run_websocket_replay_redacts_legacy_goal_and_plan_values(session: Session) -> None:
    """断线重放从 durable event/run 读数据，legacy raw 值也不能穿过 WS 帧。"""

    from app.domains.agent_runs.event_encoders import websocket_stream_events_from_agent_event

    run = _seed_agent_run(session, "run-ws-replay-redaction")
    run.goal = "请用 api_key=secret-replay-goal 审查"
    run.scope = {
        "agent_role_hints": ["sk-secret-replay-role"],
        "agent_role_mentions": ["@reviewer token=secret-replay-mention"],
    }
    started = AgentRunEvent(
        run_id=run.id,
        event_type=event_types.AGENT_RUN_STARTED,
        actor="agent",
        message="started",
        payload={},
        sequence=1,
    )
    plan = AgentRunEvent(
        run_id=run.id,
        event_type=event_types.AGENT_PLAN_CREATED,
        actor="agent",
        message="plan",
        payload={
            "plan": [
                {
                    "step": "api_key=secret-replay-step",
                    "detail": "Bearer sk-secret-replay-detail",
                    "status": "running",
                }
            ]
        },
        sequence=2,
    )
    session.add_all([started, plan])
    session.commit()

    frames = [
        frame
        for event in _stored_run_events(session, run)
        for frame in websocket_stream_events_from_agent_event(event)
    ]
    rendered = json.dumps(frames, ensure_ascii=False)

    assert "secret-replay-goal" not in rendered
    assert "sk-secret-replay-role" not in rendered
    assert "secret-replay-mention" not in rendered
    assert "secret-replay-step" not in rendered
    assert "sk-secret-replay-detail" not in rendered
    assert REDACTED in rendered
    assert frames[0]["type"] == "agent_run_started"
    assert frames[1]["type"] == "agent_step"
