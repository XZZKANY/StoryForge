from __future__ import annotations

import inspect
import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker
from test_book_runs import seed_locked_blueprint

from app.domains.agent_runs import event_types
from app.domains.agent_runs.bookrun_summary import (
    _bookrun_budget_details,
    _bookrun_budget_summary,
    _bookrun_chapter_plan_summary,
    _bookrun_risk_summary,
)
from app.domains.agent_runs.intent import SUPPORTED_INTENTS as RUNTIME_SUPPORTED_INTENTS
from app.domains.agent_runs.intent import _detect_intent as detect_runtime_intent
from app.domains.agent_runs.intent import _role_hints, _role_mentions
from app.domains.agent_runs.models import AgentArtifact, AgentRun, AgentRunEvent, SubagentRun
from app.domains.ide import review_reasoning
from app.domains.ide import router as ide_router


def _seed_agent_run(session: Session, public_id: str = "run-low-level-events") -> AgentRun:
    run = AgentRun(
        public_id=public_id,
        session_id=f"session-{public_id}",
        goal="验证 AgentRun 底层事件顺序。",
        scope={},
        permission_profile="risk_confirm",
        budget={},
        status="running",
        root_plan=[],
        current_step=None,
    )
    session.add(run)
    session.commit()
    session.refresh(run)
    return run


def _stored_run_events(session: Session, run: AgentRun) -> list[AgentRunEvent]:
    return list(session.query(AgentRunEvent).filter_by(run_id=run.id).order_by(AgentRunEvent.sequence, AgentRunEvent.id))


def _stored_run_artifacts(session: Session, run: AgentRun) -> list[AgentArtifact]:
    return list(session.query(AgentArtifact).filter_by(run_id=run.id).order_by(AgentArtifact.id))


def _seed_chapter_review_scene_packet(session: Session) -> dict[str, int | str]:
    from app.domains.books.models import Book, Chapter, Scene
    from app.domains.continuity.models import ScenePacket

    content = "林岚举起左臂，旁人看见左臂完好无损。作者直接解释这说明她早已摆脱旧伤。"
    book = Book(title="灯塔余烬", status="draft", premise="林岚在港口追查灯塔信号。")
    session.add(book)
    session.flush()
    chapter = Chapter(book_id=book.id, ordinal=1, title="旧伤", status="draft", summary=None)
    session.add(chapter)
    session.flush()
    scene = Scene(chapter_id=chapter.id, ordinal=1, title="港口谈判", status="draft", content=content)
    session.add(scene)
    session.flush()
    packet = ScenePacket(
        scene_id=scene.id,
        status="assembled",
        packet={
            "必须包含事实": ["左臂受伤"],
            "风格规则": ["克制"],
            "证据链接": [{"source_ref": "asset://character/lin-lan#v1", "rationale": "角色资产要求左臂仍受伤。"}],
        },
        version=1,
    )
    session.add(packet)
    session.commit()
    return {"scene_packet_id": packet.id, "content": content}


def test_agent_run_models_are_registered_in_metadata() -> None:
    """Agent Runtime 控制平面表必须进入统一 ORM 元数据。"""

    assert AgentRun.__tablename__ == "agent_runs"
    assert AgentRunEvent.__tablename__ == "agent_run_events"
    assert SubagentRun.__tablename__ == "subagent_runs"
    assert AgentArtifact.__tablename__ == "agent_artifacts"


def test_agent_run_event_type_constants_preserve_existing_protocol_values() -> None:
    """事件常量只收敛既有协议名，不夹带 turn/streaming 新模型。"""

    from app.domains.agent_runs.service import _control_event_type

    assert frozenset(
        {
            "agent_run_started",
            "agent_plan_created",
            "subagent_started",
            "subagent_completed",
            "tool_trace",
            "permission_required",
            "agent_artifact",
            "agent_run_completed",
            "agent_run_failed",
            "system_job",
            "permission_approved",
            "permission_denied",
            "pause_run",
            "resume_run",
            "stop_run",
            "retry_from_checkpoint",
        }
    ) == event_types.AGENT_RUN_EVENT_TYPES
    assert frozenset(
        {
            "approve_permission",
            "deny_permission",
            "pause_run",
            "resume_run",
            "stop_run",
            "retry_from_checkpoint",
        }
    ) == event_types.CONTROL_MESSAGE_TYPES
    assert frozenset(
        {
            "permission_approved",
            "permission_denied",
            "pause_run",
            "resume_run",
            "stop_run",
            "retry_from_checkpoint",
        }
    ) == event_types.CONTROL_MESSAGE_EVENT_TYPES
    assert _control_event_type("approve_permission") == "permission_approved"
    assert _control_event_type("deny_permission") == "permission_denied"
    assert _control_event_type("pause_run") == "pause_run"
    assert event_types.event_type_for_control_message("custom_legacy_event") == "custom_legacy_event"
    assert "turn_started" not in event_types.AGENT_RUN_EVENT_TYPES
    assert "message_delta" not in event_types.AGENT_RUN_EVENT_TYPES


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


def test_file_review_runtime_stops_at_context_boundary_when_control_event_arrives(
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """file.review 的第一条可中断 run loop 边界在 context.load 之后。"""

    from app.domains.agent_runs import runtime as agent_runtime
    from app.domains.agent_runs.event_sink import _AgentRunEventSink
    from app.domains.agent_runs.runtime import AgentRuntime
    from app.domains.agent_runs.save_points import build_agent_run_save_point_projection
    from app.domains.agent_runs.service import record_agent_control_event

    def fail_if_review_runs(*args, **kwargs):  # noqa: ANN002, ANN003 - test sentinel
        raise AssertionError("reviewers should not run after stop_run")

    class StopAfterContextSink(_AgentRunEventSink):
        def record_tool_trace(self, run: AgentRun, trace, index: int) -> None:  # noqa: ANN001
            super().record_tool_trace(run, trace, index)
            if trace.tool_name == "context.load":
                record_agent_control_event(
                    session,
                    public_id=run.public_id,
                    session_id=run.session_id,
                    control_type="stop_run",
                    payload={"reason": "test stop after context"},
                )

    monkeypatch.setattr(agent_runtime, "_build_multi_agent_review_report_with_executor", fail_if_review_runs)
    run = _seed_agent_run(session, public_id="run-interrupt-after-context")

    result = AgentRuntime(StopAfterContextSink(session)).run_user_message(
        session,
        run=run,
        agent_session_id=run.session_id,
        message={
            "type": "user_message",
            "run_id": run.public_id,
            "user_message": "审查当前章节",
            "intent": "file.review",
            "args": {
                "file_path": "正文/第01章.md",
                "content": "林岚走进港口。她看见灯塔熄灭。",
                "context_bundle": {"files": []},
            },
        },
    )

    assert result["type"] == "agent_result"
    assert result["runtime_interruption"] == {
        "kind": "runtime_interruption",
        "status": "stopped",
        "current_step": "stopped",
        "boundary": "after_tool:context.load",
        "uses_existing_status": True,
        "resume_strategy": "stopped_by_user",
        "automatic_resume_supported": False,
    }
    assert result["agent_result"]["runtime_interrupted"] is True
    assert "_events_recorded" not in result
    assert "_runtime_interrupted" not in result
    assert "_tool_artifacts" not in result
    assert [trace["tool_name"] for trace in result["tool_trace"]] == ["context.load"]

    events = _stored_run_events(session, run)
    event_types = [event.event_type for event in events]
    assert event_types == ["agent_plan_created", "tool_trace", "stop_run"]
    assert all(event.event_type != "subagent_started" for event in events)
    assert all(event.event_type != "agent_artifact" for event in events)
    assert all(event.event_type != "agent_run_completed" for event in events)
    assert _stored_run_artifacts(session, run) == []
    session.refresh(run)
    assert run.status == "stopped"
    assert run.current_step == "stopped"

    projection = build_agent_run_save_point_projection(
        run,
        events=events,
        artifacts=_stored_run_artifacts(session, run),
    )
    assert projection["recoverability"]["resume_strategy"] == "stopped_by_user"
    assert projection["runtime_recovery"]["latest_execution_marker"]["tool_name"] == "context.load"
    assert projection["runtime_recovery"]["latest_interruption"]["event_type"] == "stop_run"
    assert projection["runtime_recovery"]["latest_interruption"]["status"] == "stopped"


def test_file_review_runtime_stop_in_review_loop_does_not_leak_tool_artifacts(
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """reviewer trace 循环中途停止时，内部 _tool_artifacts 标记不得泄漏进返回结果。"""

    from app.domains.agent_runs import runtime as agent_runtime
    from app.domains.agent_runs.event_sink import _AgentRunEventSink
    from app.domains.agent_runs.runtime import AgentRuntime
    from app.domains.agent_runs.service import record_agent_control_event

    original_runtime_interruption = agent_runtime.AgentRuntime._runtime_interruption  # noqa: SLF001
    stopped_once = {"value": False}

    def stop_at_first_review_trace(self, run: AgentRun, *, boundary: str):  # noqa: ANN001, ANN202
        if (
            boundary.startswith("after_tool:")
            and boundary != "after_tool:context.load"
            and not stopped_once["value"]
        ):
            stopped_once["value"] = True
            record_agent_control_event(
                self._event_sink._session,  # noqa: SLF001
                public_id=run.public_id,
                session_id=run.session_id,
                control_type="stop_run",
                payload={"reason": "test stop mid review loop"},
            )
        return original_runtime_interruption(self, run, boundary=boundary)

    monkeypatch.setattr(agent_runtime.AgentRuntime, "_runtime_interruption", stop_at_first_review_trace)
    monkeypatch.setattr(review_reasoning, "missing_book_generation_env", lambda: ["STORYFORGE_LLM_API_KEY"])

    run = _seed_agent_run(session, public_id="run-stop-mid-review-loop")
    result = AgentRuntime(_AgentRunEventSink(session)).run_user_message(
        session,
        run=run,
        agent_session_id=run.session_id,
        message={
            "type": "user_message",
            "run_id": run.public_id,
            "user_message": "审查当前章节",
            "intent": "file.review",
            "args": {
                "file_path": "正文/第01章.md",
                "content": "林岚走进港口。她看见灯塔熄灭。",
                "context_bundle": {"files": []},
            },
        },
    )

    assert stopped_once["value"] is True
    assert result["type"] == "agent_result"
    assert result["runtime_interruption"]["status"] == "stopped"
    assert result["agent_result"]["runtime_interrupted"] is True
    assert "_events_recorded" not in result
    assert "_runtime_interrupted" not in result
    assert "_tool_artifacts" not in result


def test_file_review_runtime_resumes_from_pending_context_boundary(
    session: Session,
) -> None:
    """resume_run 后，file.review 可从隐藏 pending call artifact 继续 reviewer。"""

    from app.domains.agent_runs.event_sink import _AgentRunEventSink
    from app.domains.agent_runs.runtime import AgentRuntime
    from app.domains.agent_runs.service import (
        get_agent_run_save_points,
        list_agent_artifacts,
        record_agent_control_event,
    )

    class PauseAfterContextSink(_AgentRunEventSink):
        def record_tool_trace(self, run: AgentRun, trace, index: int) -> None:  # noqa: ANN001
            super().record_tool_trace(run, trace, index)
            if trace.tool_name == "context.load":
                record_agent_control_event(
                    session,
                    public_id=run.public_id,
                    session_id=run.session_id,
                    control_type="pause_run",
                    payload={"reason": "test pause after context"},
                )

    run = _seed_agent_run(session, public_id="run-resume-after-context")
    message = {
        "type": "user_message",
        "run_id": run.public_id,
        "user_message": "审查当前章节",
        "intent": "file.review",
        "args": {
            "file_path": "正文/第01章.md",
            "content": "林岚走进港口。她看见灯塔熄灭。",
            "context_bundle": {"files": []},
        },
    }

    paused = AgentRuntime(PauseAfterContextSink(session)).run_user_message(
        session,
        run=run,
        agent_session_id=run.session_id,
        message=message,
    )

    assert paused["runtime_interruption"]["status"] == "paused"
    assert paused["runtime_interruption"]["resume_strategy"] == "await_resume"
    assert list_agent_artifacts(session, run.public_id) == []
    pause_projection = get_agent_run_save_points(session, run.public_id)
    pending_artifact_id = pause_projection["pending"]["runtime_pending_call_artifact_id"]
    assert isinstance(pending_artifact_id, int)
    assert pause_projection["pending"]["runtime_pending_tool"] == "file.review"
    assert pause_projection["runtime_recovery"]["latest_pending_call"] == {
        "artifact_id": pending_artifact_id,
        "artifact_kind": "runtime_pending_call",
        "intent": "file.review",
        "boundary": "after_tool:context.load",
        "status": "pending",
        "resume_strategy": "continue_after_context_load",
        "pending_tool": "file.review",
    }

    record_agent_control_event(
        session,
        public_id=run.public_id,
        session_id=run.session_id,
        control_type="resume_run",
        payload={"reason": "continue review"},
    )
    session.refresh(run)
    resumed = AgentRuntime(_AgentRunEventSink(session)).run_user_message(
        session,
        run=run,
        agent_session_id=run.session_id,
        message=message,
    )

    assert resumed["type"] == "agent_result"
    assert resumed["agent_result"]["resumed_from_pending_call"] is True
    assert resumed["agent_result"]["pending_call_artifact_id"] == pending_artifact_id
    assert resumed["agent_result"]["review_report"]["kind"] == "review_report"

    events = _stored_run_events(session, run)
    context_tool_events = [
        event
        for event in events
        if event.event_type == "tool_trace" and event.payload.get("trace", {}).get("tool_name") == "context.load"
    ]
    assert len(context_tool_events) == 1
    assert any(event.event_type == "resume_run" for event in events)
    assert any(event.event_type == "subagent_started" for event in events)
    assert events[-1].event_type == "agent_run_completed"
    session.refresh(run)
    assert run.status == "completed"
    assert run.current_step == "completed"

    visible_artifacts = list_agent_artifacts(session, run.public_id)
    assert [artifact.kind for artifact in visible_artifacts] == ["review_report"]
    completed_projection = get_agent_run_save_points(session, run.public_id)
    assert completed_projection["pending"]["runtime_pending_call_artifact_id"] is None
    assert completed_projection["runtime_recovery"]["latest_pending_call"] is None
    resolution = completed_projection["runtime_recovery"]["latest_pending_call_resolution"]
    assert isinstance(resolution["artifact_id"], int)
    assert resolution == {
        "artifact_id": resolution["artifact_id"],
        "artifact_kind": "runtime_pending_call_resolution",
        "status": "resolved",
        "resolution": "resumed",
        "resolved_by": "agent_runtime",
        "result_status": "completed",
        "intent": "file.review",
        "boundary": "after_tool:context.load",
        "pending_tool": "file.review",
        "pending_resume_strategy": "continue_after_context_load",
        "pending_artifact_id": pending_artifact_id,
    }


def test_resume_run_control_message_drives_pending_file_review_resume(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """WebSocket resume_run ack 可携带 pending file.review 的自动续跑结果。"""

    from app.domains.agent_runs import runtime as agent_runtime
    from app.domains.agent_runs.service import record_agent_control_event

    original_runtime_interruption = agent_runtime.AgentRuntime._runtime_interruption  # noqa: SLF001
    paused_once = {"value": False}

    def pause_once_after_context(self, run: AgentRun, *, boundary: str):  # noqa: ANN001
        if boundary == "after_tool:context.load" and not paused_once["value"]:
            paused_once["value"] = True
            record_agent_control_event(
                self._event_sink._session,  # noqa: SLF001
                public_id=run.public_id,
                session_id=run.session_id,
                control_type="pause_run",
                payload={"reason": "test pause before websocket resume"},
            )
        return original_runtime_interruption(self, run, boundary=boundary)

    monkeypatch.setattr(agent_runtime.AgentRuntime, "_runtime_interruption", pause_once_after_context)
    monkeypatch.setattr(review_reasoning, "missing_book_generation_env", lambda: ["STORYFORGE_LLM_API_KEY"])

    with client.websocket_connect("/api/ide/agent/sessions/session-control-resume-review") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "run_id": "run-control-resume-review",
                "user_message": "审查当前章节",
                "intent": "file.review",
                "args": {
                    "file_path": "正文/第01章.md",
                    "content": "林岚走进港口。她看见灯塔熄灭。",
                    "context_bundle": {"files": []},
                },
            }
        )
        paused = websocket.receive_json()
        websocket.send_json(
            {
                "type": "resume_run",
                "run_id": "run-control-resume-review",
                "payload": {"reason": "continue pending review"},
            }
        )
        resumed_ack = websocket.receive_json()

    assert paused["runtime_interruption"]["status"] == "paused"
    assert resumed_ack["type"] == "resume_run"
    assert resumed_ack["status"] == "recorded"
    assert resumed_ack["resumed_result"]["type"] == "agent_result"
    assert resumed_ack["resumed_result"]["agent_result"]["resumed_from_pending_call"] is True
    assert resumed_ack["resumed_result"]["agent_result"]["review_report"]["kind"] == "review_report"

    events = client.get("/api/agent-runs/run-control-resume-review/events").json()
    event_types = [event["event_type"] for event in events]
    assert "resume_run" in event_types
    assert event_types[-1] == "agent_run_completed"
    context_tool_events = [
        event
        for event in events
        if event["event_type"] == "tool_trace" and event["payload"].get("trace", {}).get("tool_name") == "context.load"
    ]
    assert len(context_tool_events) == 1
    projection = client.get("/api/agent-runs/run-control-resume-review/save-points").json()
    assert projection["pending"]["runtime_pending_call_artifact_id"] is None
    assert projection["runtime_recovery"]["latest_pending_call"] is None
    assert projection["runtime_recovery"]["latest_pending_call_resolution"]["pending_tool"] == "file.review"
    artifacts = client.get("/api/agent-runs/run-control-resume-review/artifacts").json()
    assert [artifact["kind"] for artifact in artifacts] == ["review_report"]


def test_resume_run_records_diagnostic_for_unsupported_pending_call(session: Session) -> None:
    """unsupported pending call 不会被 resume_run 自动执行，但原因会进入事件事实源。"""

    from app.domains.agent_runs.runtime_recovery import RUNTIME_PENDING_CALL_ARTIFACT_KIND
    from app.domains.agent_runs.service import (
        get_agent_run_save_points,
        handle_agent_control_message,
        list_agent_artifacts,
        record_agent_artifact,
    )

    run = _seed_agent_run(session, public_id="run-unsupported-pending-resume")
    run.status = "paused"
    run.current_step = "paused"
    session.add(run)
    session.commit()
    pending = record_agent_artifact(
        session,
        run,
        kind=RUNTIME_PENDING_CALL_ARTIFACT_KIND,
        payload={
            "kind": RUNTIME_PENDING_CALL_ARTIFACT_KIND,
            "intent": "file.revise",
            "boundary": "after_tool:context.load",
            "status": "pending",
            "resume_strategy": "continue_file_revise",
            "resume_message": {"type": "user_message", "intent": "file.revise"},
        },
        requires_confirmation=False,
    )

    control = handle_agent_control_message(
        session,
        public_id=run.public_id,
        session_id=run.session_id,
        control_type="resume_run",
        payload={"reason": "try unsupported pending"},
    )

    assert control.resumed_result is None
    assert control.resume_diagnostic == {
        "kind": "runtime_pending_call_resume",
        "can_resume": False,
        "resume_via_control_channel": False,
        "requires_manual_restart": True,
        "reason": "unsupported_pending_call_intent",
        "resume_strategy": "manual_restart_required",
        "artifact_id": pending.id,
        "artifact_kind": "runtime_pending_call",
        "run_status": "running",
        "current_step": "resumed",
        "intent": "file.revise",
        "boundary": "after_tool:context.load",
        "status": "pending",
        "pending_resume_strategy": "continue_file_revise",
    }
    assert control.event.payload["runtime_recovery"]["resume_diagnostic"] == control.resume_diagnostic
    assert list_agent_artifacts(session, run.public_id) == []
    projection = get_agent_run_save_points(session, run.public_id)
    assert projection["pending"]["runtime_pending_call_artifact_id"] == pending.id
    assert projection["pending"]["runtime_pending_tool"] is None
    assert projection["runtime_recovery"]["latest_resume_diagnostic"]["reason"] == "unsupported_pending_call_intent"
    assert projection["runtime_recovery"]["latest_resume_diagnostic"]["requires_manual_restart"] is True
    assert projection["runtime_recovery"]["latest_pending_call"]["intent"] == "file.revise"
    assert projection["runtime_recovery"]["latest_pending_call_resolution"] is None


def test_resume_run_records_diagnostic_for_malformed_file_review_pending_call(session: Session) -> None:
    """file.review pending call 缺少 resume envelope 时保守降级，不重跑 context 或 reviewer。"""

    from app.domains.agent_runs.runtime_recovery import RUNTIME_PENDING_CALL_ARTIFACT_KIND
    from app.domains.agent_runs.service import (
        get_agent_run_save_points,
        handle_agent_control_message,
        record_agent_artifact,
    )

    run = _seed_agent_run(session, public_id="run-malformed-pending-resume")
    run.status = "paused"
    run.current_step = "paused"
    session.add(run)
    session.commit()
    pending = record_agent_artifact(
        session,
        run,
        kind=RUNTIME_PENDING_CALL_ARTIFACT_KIND,
        payload={
            "kind": RUNTIME_PENDING_CALL_ARTIFACT_KIND,
            "intent": "file.review",
            "boundary": "after_tool:context.load",
            "status": "pending",
            "resume_strategy": "continue_after_context_load",
            "context_output": {"file_path": "正文/第01章.md", "content": "林岚走进港口。"},
        },
        requires_confirmation=False,
    )

    control = handle_agent_control_message(
        session,
        public_id=run.public_id,
        session_id=run.session_id,
        control_type="resume_run",
        payload={"reason": "try malformed pending"},
    )

    assert control.resumed_result is None
    assert control.resume_diagnostic["reason"] == "missing_resume_message"
    assert control.resume_diagnostic["pending_tool"] == "file.review"
    assert control.resume_diagnostic["requires_manual_restart"] is True
    assert control.event.payload["runtime_recovery"]["resume_diagnostic"]["artifact_id"] == pending.id
    events = _stored_run_events(session, run)
    assert [event.event_type for event in events] == ["agent_artifact", "resume_run"]
    projection = get_agent_run_save_points(session, run.public_id)
    assert projection["runtime_recovery"]["latest_resume_diagnostic"]["reason"] == "missing_resume_message"
    assert projection["runtime_recovery"]["latest_pending_call"]["pending_tool"] == "file.review"
    assert projection["runtime_recovery"]["latest_pending_call_resolution"] is None


def test_file_review_resume_after_subagent_boundary_does_not_rerun_reviewers(
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """reviewer 已完成后暂停，resume 只补齐剩余事件和 artifact。"""

    from app.domains.agent_runs import runtime as agent_runtime
    from app.domains.agent_runs.event_sink import _AgentRunEventSink
    from app.domains.agent_runs.runtime import AgentRuntime
    from app.domains.agent_runs.service import (
        get_agent_run_save_points,
        list_agent_artifacts,
        record_agent_control_event,
    )

    original_builder = agent_runtime._build_multi_agent_review_report_with_executor
    builder_calls = {"count": 0}

    def counting_builder(*args, **kwargs):  # noqa: ANN002, ANN003
        builder_calls["count"] += 1
        return original_builder(*args, **kwargs)

    class PauseAfterFirstReviewerSink(_AgentRunEventSink):
        def record_tool_trace(self, run: AgentRun, trace, index: int) -> None:  # noqa: ANN001
            super().record_tool_trace(run, trace, index)
            if trace.tool_name == "subagent.plot_reviewer":
                record_agent_control_event(
                    session,
                    public_id=run.public_id,
                    session_id=run.session_id,
                    control_type="pause_run",
                    payload={"reason": "pause after first reviewer trace"},
                )

    monkeypatch.setattr(agent_runtime, "_build_multi_agent_review_report_with_executor", counting_builder)
    run = _seed_agent_run(session, public_id="run-resume-after-reviewer")
    message = {
        "type": "user_message",
        "run_id": run.public_id,
        "user_message": "审查当前章节",
        "intent": "file.review",
        "args": {
            "file_path": "正文/第01章.md",
            "content": "林岚走进港口。她看见灯塔熄灭。",
            "context_bundle": {"files": []},
        },
    }

    paused = AgentRuntime(PauseAfterFirstReviewerSink(session)).run_user_message(
        session,
        run=run,
        agent_session_id=run.session_id,
        message=message,
    )

    assert builder_calls["count"] == 1
    assert paused["runtime_interruption"]["status"] == "paused"
    assert paused["runtime_interruption"]["boundary"] == "after_tool:subagent.plot_reviewer"
    pause_projection = get_agent_run_save_points(session, run.public_id)
    assert pause_projection["runtime_recovery"]["latest_pending_call"]["pending_tool"] == "file.review.postprocess"
    assert pause_projection["runtime_recovery"]["latest_pending_call"]["next_trace_index"] == 2

    record_agent_control_event(
        session,
        public_id=run.public_id,
        session_id=run.session_id,
        control_type="resume_run",
        payload={"reason": "continue postprocess"},
    )
    session.refresh(run)
    resumed = AgentRuntime(_AgentRunEventSink(session)).run_user_message(
        session,
        run=run,
        agent_session_id=run.session_id,
        message=message,
    )

    assert builder_calls["count"] == 1
    assert resumed["agent_result"]["resumed_from_pending_call"] is True
    assert resumed["agent_result"]["resumed_from_boundary"] == "after_tool:subagent.plot_reviewer"
    events = _stored_run_events(session, run)
    tool_names = [
        event.payload["trace"]["tool_name"]
        for event in events
        if event.event_type == "tool_trace" and isinstance(event.payload.get("trace"), dict)
    ]
    assert tool_names == [
        "context.load",
        "subagent.plot_reviewer",
        "subagent.character_reviewer",
        "subagent.prose_reviewer",
        "subagent.continuity_reviewer",
        "subagent.synthesizer",
    ]
    assert events[-1].event_type == "agent_run_completed"
    assert [artifact.kind for artifact in list_agent_artifacts(session, run.public_id)] == ["review_report"]
    completed_projection = get_agent_run_save_points(session, run.public_id)
    assert completed_projection["runtime_recovery"]["latest_pending_call"] is None
    assert completed_projection["runtime_recovery"]["latest_pending_call_resolution"]["pending_tool"] == "file.review.postprocess"


def test_chapter_review_runtime_resumes_after_judge_run_without_repairing(
    session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """chapter.review 可在 judge.run 后恢复，但恢复路径不自动进入 judge.repair 写工具。"""

    from app.domains.agent_runs.event_sink import _AgentRunEventSink
    from app.domains.agent_runs.runtime import AgentRuntime
    from app.domains.agent_runs.service import (
        get_agent_run_save_points,
        handle_agent_control_message,
        list_agent_artifacts,
        record_agent_control_event,
    )

    class PauseAfterJudgeRunSink(_AgentRunEventSink):
        def record_tool_trace(self, run: AgentRun, trace, index: int) -> None:  # noqa: ANN001
            super().record_tool_trace(run, trace, index)
            if trace.tool_name == "judge.run":
                record_agent_control_event(
                    session,
                    public_id=run.public_id,
                    session_id=run.session_id,
                    control_type="pause_run",
                    payload={"reason": "test pause after judge.run"},
                )

    counts = {"judge.run": 0, "judge.repair": 0}
    original_execute_tool = AgentRuntime._execute_tool

    def counting_execute_tool(self, tool_name, context, payload):  # noqa: ANN001
        if tool_name in counts:
            counts[tool_name] += 1
        if tool_name == "judge.repair":
            raise AssertionError("resume should not execute judge.repair")
        return original_execute_tool(self, tool_name, context, payload)

    monkeypatch.setattr(AgentRuntime, "_execute_tool", counting_execute_tool)

    seeded = _seed_chapter_review_scene_packet(session)
    run = _seed_agent_run(session, public_id="run-chapter-review-pending")
    message = {
        "type": "user_message",
        "run_id": run.public_id,
        "user_message": "审阅当前场景",
        "intent": "chapter.review",
        "args": {"scene_packet_id": seeded["scene_packet_id"]},
    }

    paused = AgentRuntime(PauseAfterJudgeRunSink(session)).run_user_message(
        session,
        run=run,
        agent_session_id=run.session_id,
        message=message,
    )

    assert paused["runtime_interruption"]["status"] == "paused"
    assert paused["runtime_interruption"]["boundary"] == "after_tool:judge.run"
    assert [trace["tool_name"] for trace in paused["tool_trace"]] == ["judge.run"]
    assert counts == {"judge.run": 1, "judge.repair": 0}
    assert list_agent_artifacts(session, run.public_id) == []

    pause_projection = get_agent_run_save_points(session, run.public_id)
    pending_artifact_id = pause_projection["pending"]["runtime_pending_call_artifact_id"]
    assert isinstance(pending_artifact_id, int)
    assert pause_projection["pending"]["runtime_pending_tool"] == "chapter.review.postprocess"
    assert pause_projection["runtime_recovery"]["latest_pending_call"] == {
        "artifact_id": pending_artifact_id,
        "artifact_kind": "runtime_pending_call",
        "intent": "chapter.review",
        "boundary": "after_tool:judge.run",
        "status": "pending",
        "resume_strategy": "continue_chapter_review_postprocess",
        "pending_tool": "chapter.review.postprocess",
    }

    control = handle_agent_control_message(
        session,
        public_id=run.public_id,
        session_id=run.session_id,
        control_type="resume_run",
        payload={"reason": "continue chapter review"},
    )

    assert control.resume_diagnostic is None
    assert control.resumed_result is not None
    resumed = control.resumed_result
    assert resumed["type"] == "agent_result"
    assert resumed["intent"] == "chapter.review"
    assert resumed["agent_result"]["resumed_from_pending_call"] is True
    assert resumed["agent_result"]["pending_call_artifact_id"] == pending_artifact_id
    assert resumed["agent_result"]["repair_patch_count"] == 0
    assert resumed["agent_result"]["requires_user_confirmation"] is False
    assert resumed.get("proposed_patch") is None
    assert counts == {"judge.run": 1, "judge.repair": 0}

    events = _stored_run_events(session, run)
    judge_run_events = [
        event
        for event in events
        if event.event_type == "tool_trace" and event.payload.get("trace", {}).get("tool_name") == "judge.run"
    ]
    judge_repair_events = [
        event
        for event in events
        if event.event_type == "tool_trace" and event.payload.get("trace", {}).get("tool_name") == "judge.repair"
    ]
    assert len(judge_run_events) == 1
    assert judge_repair_events == []
    assert events[-1].event_type == "agent_run_completed"

    completed_projection = get_agent_run_save_points(session, run.public_id)
    assert completed_projection["pending"]["runtime_pending_call_artifact_id"] is None
    assert completed_projection["runtime_recovery"]["latest_pending_call"] is None
    resolution = completed_projection["runtime_recovery"]["latest_pending_call_resolution"]
    assert resolution["pending_tool"] == "chapter.review.postprocess"
    assert resolution["pending_resume_strategy"] == "continue_chapter_review_postprocess"
    assert resolution["pending_artifact_id"] == pending_artifact_id


def test_resume_run_records_diagnostic_for_malformed_chapter_review_pending_call(session: Session) -> None:
    """chapter.review pending call 缺少 judge payload 时保守降级，不重跑 judge 或 repair。"""

    from app.domains.agent_runs.runtime_recovery import RUNTIME_PENDING_CALL_ARTIFACT_KIND
    from app.domains.agent_runs.service import (
        get_agent_run_save_points,
        handle_agent_control_message,
        record_agent_artifact,
    )

    run = _seed_agent_run(session, public_id="run-malformed-chapter-review-pending")
    run.status = "paused"
    run.current_step = "paused"
    session.add(run)
    session.commit()
    pending = record_agent_artifact(
        session,
        run,
        kind=RUNTIME_PENDING_CALL_ARTIFACT_KIND,
        payload={
            "kind": RUNTIME_PENDING_CALL_ARTIFACT_KIND,
            "intent": "chapter.review",
            "boundary": "after_tool:judge.run",
            "status": "pending",
            "resume_strategy": "continue_chapter_review_postprocess",
            "resume_message": {
                "type": "user_message",
                "intent": "chapter.review",
                "args": {"scene_packet_id": 1},
            },
        },
        requires_confirmation=False,
    )

    control = handle_agent_control_message(
        session,
        public_id=run.public_id,
        session_id=run.session_id,
        control_type="resume_run",
        payload={"reason": "try malformed chapter review pending"},
    )

    assert control.resumed_result is None
    assert control.resume_diagnostic["reason"] == "missing_resume_payload"
    assert control.resume_diagnostic["pending_tool"] == "chapter.review.postprocess"
    assert control.resume_diagnostic["requires_manual_restart"] is True
    assert control.event.payload["runtime_recovery"]["resume_diagnostic"]["artifact_id"] == pending.id

    projection = get_agent_run_save_points(session, run.public_id)
    assert projection["runtime_recovery"]["latest_resume_diagnostic"]["reason"] == "missing_resume_payload"
    assert projection["runtime_recovery"]["latest_pending_call"]["pending_tool"] == "chapter.review.postprocess"
    assert projection["runtime_recovery"]["latest_pending_call_resolution"] is None


def test_agent_run_save_points_endpoint_projects_existing_event_store(client: TestClient) -> None:
    """REST save-points endpoint 只读投影事件和 artifact，不替代 /events。"""

    with client.websocket_connect("/api/ide/agent/sessions/session-save-points-endpoint") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "run_id": "run-save-points-endpoint",
                "user_message": "解释这一段",
                "intent": "chat.explain",
                "args": {"context": "林岚走进港口。"},
            }
        )
        websocket.receive_json()

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

    with client.websocket_connect("/api/ide/agent/sessions/session-save-points-review") as websocket:
        websocket.send_json(
            {
                "type": "user_message",
                "run_id": "run-save-points-review",
                "user_message": "审查当前章节",
                "intent": "file.review",
                "args": {
                    "file_path": "正文/第01章.md",
                    "content": "林岚走进港口。她看见灯塔熄灭。",
                    "context_bundle": {"files": []},
                },
            }
        )
        websocket.receive_json()

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


def test_record_agent_event_sequences_increment_from_existing_max(session: Session) -> None:
    """底层事件写入必须按 run 内最大 sequence 递增，给 service.py 拆分提供顺序护栏。"""

    from app.domains.agent_runs.service import record_agent_event

    run = _seed_agent_run(session)
    session.add(
        AgentRunEvent(
            run_id=run.id,
            event_type="seeded",
            actor="test",
            message="已有事件",
            payload={"seed": True},
            sequence=7,
        )
    )
    session.commit()

    first = record_agent_event(
        session,
        run,
        event_type="tool_trace",
        actor="root-agent",
        message="第一条新增事件",
        payload={"step": 1},
    )
    second = record_agent_event(
        session,
        run,
        event_type="agent_run_completed",
        actor="root-agent",
        message="第二条新增事件",
        payload={"step": 2},
    )

    assert [first.sequence, second.sequence] == [8, 9]
    stored_sequences = [
        event.sequence
        for event in session.query(AgentRunEvent).filter_by(run_id=run.id).order_by(AgentRunEvent.sequence)
    ]
    assert stored_sequences == [7, 8, 9]


def test_encode_agent_run_sse_event_is_stable_json_snapshot(session: Session) -> None:
    """SSE 编码必须只投影 AgentRunEvent 事实源，不引入额外运行态。"""

    from app.domains.agent_runs.service import encode_agent_run_sse_event, record_agent_event

    run = _seed_agent_run(session, public_id="run-sse-encoder")
    event = record_agent_event(
        session,
        run,
        event_type="tool_trace",
        actor="tool-registry",
        message="命令 audit.open 已执行。",
        payload={"command_id": "audit.open", "result": {"ok": True}},
    )

    encoded = encode_agent_run_sse_event(event)

    assert encoded.startswith("event: tool_trace\n")
    assert encoded.endswith("\n\n")
    assert encoded.count("\ndata: ") == 1
    payload = json.loads(encoded.split("data: ", 1)[1].split("\n\n", 1)[0])
    assert payload == {
        "id": event.id,
        "run_id": run.id,
        "event_type": "tool_trace",
        "actor": "tool-registry",
        "message": "命令 audit.open 已执行。",
        "payload": {"command_id": "audit.open", "result": {"ok": True}},
        "sequence": 1,
        "created_at": event.created_at.isoformat(),
    }


def test_websocket_user_message_enters_through_runtime_facade() -> None:
    """IDE WebSocket 不应直接串联 user_message run 的 start/execute 细节。"""

    source = inspect.getsource(ide_router.agent_session)

    assert "run_agent_user_message(" in source
    assert "start_agent_user_message_run(" not in source
    assert "execute_agent_user_message_run(" not in source


def test_agent_runtime_supported_intents_are_registered() -> None:
    assert {
        "chat.explain",
        "file.review",
        "file.revise",
        "chapter.review",
        "chapter.repair",
        "bookrun.start",
    } == RUNTIME_SUPPORTED_INTENTS


def test_agent_runtime_detect_intent_honors_explicit_intent_over_free_text() -> None:
    """F11：关键词表已下线。自由文本不再被「修/审」等词劫进固定管线，
    只有显式 intent 或结构化参数（reviewer role hint）才路由到 file.review/revise。"""

    file_args = {"file_path": "正文/第01章.md", "content": "正文内容"}

    # 无显式 intent、无 role hint 的自由文本一律落 chat.explain 工具循环。
    assert detect_runtime_intent("修选中问题：plot-1 prose-1", file_args, None) == "chat.explain"
    # 显式 intent 始终优先。
    assert detect_runtime_intent("修选中问题：plot-1 prose-1", file_args, "file.revise") == "file.revise"
    assert detect_runtime_intent("随便一句话", file_args, "file.review") == "file.review"
    # reviewer role hint + 文件上下文仍走 file.review 固定管线。
    review_args = {**file_args, "agent_role_hints": ["plot_reviewer"]}
    assert detect_runtime_intent("看看这章", review_args, None) == "file.review"


def test_agent_runtime_role_hints_resolve_mentions_and_filter_unknowns() -> None:
    args = {
        "agent_role_hints": ["plot_reviewer", "unknown_reviewer", "@人物"],
        "agent_role_mentions": ["@剧情", "@文风", "@未知"],
    }

    assert _role_hints(args) == ["plot_reviewer", "character_reviewer", "prose_reviewer"]
    assert _role_mentions(args) == ["@剧情", "@文风", "@未知"]


def test_agent_runtime_bookrun_summary_helpers_describe_budget_and_risks() -> None:
    command_args = {"chapter_budget": 6, "token_budget": 9000, "time_budget_sec": 1800}

    assert _bookrun_chapter_plan_summary(command_args) == "生成最多 6 章"
    assert _bookrun_budget_summary(command_args) == "9000 tokens，1800 秒"
    assert _bookrun_budget_details(command_args) == {
        "token_budget": 9000,
        "time_budget_sec": 1800,
        "chapter_budget": 6,
        "uses_default_budget": False,
    }
    assert _bookrun_risk_summary(command_args) == [
        "token_budget 较高，可能产生更长运行时间和更高成本",
        "chapter_budget 较高，建议确认章节范围",
        "time_budget_sec 较长，运行会停留在后台",
        "写作任务以 managed 模式运行，不会写入当前 Desktop 草稿或 pending patch",
    ]


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
                    "project_path": "D:/novels/demo",
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
    # 桌面端会话历史按项目过滤依赖 agent 建会话时落 project_path
    assert session_response.json()["project_path"] == "D:/novels/demo"


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
    assert "event: tool_completed" not in body
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
    assert checkpoints[0]["payload"]["tokens_used"] == 420
    assert checkpoints[0]["payload"]["token_budget"] == 500
    assert checkpoints[0]["payload"]["completed_count"] == 1
    assert checkpoints[0]["payload"]["checkpoint_count"] == 1

    save_points = client.get(f"/api/agent-runs/{run_id}/save-points").json()
    checkpoint_save_point = next(item for item in save_points["save_points"] if item["kind"] == "bookrun_checkpoint")
    assert checkpoint_save_point["summary"]["tokens_used"] == 420
    assert checkpoint_save_point["summary"]["token_budget"] == 500
    assert checkpoint_save_point["summary"]["completed_count"] == 1
    assert checkpoint_save_point["summary"]["checkpoint_count"] == 1
    assert checkpoint_save_point["summary"]["latest_checkpoint_chapter_index"] == 1
    assert checkpoint_save_point["summary"]["latest_checkpoint_model_run_id"] == 11
    assert save_points["recoverability"]["resume_strategy"] == "bookrun_checkpoint"


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

    save_points = client.get(f"/api/agent-runs/{run_id}/save-points").json()
    control_save_points = [item for item in save_points["save_points"] if item["kind"] == "control_message"]
    assert [item["event_type"] for item in control_save_points] == ["pause_run", "resume_run"]
    assert control_save_points[0]["summary"]["control_type"] == "pause_run"
    assert control_save_points[0]["summary"]["book_run_status"] == "paused_by_user"
    assert control_save_points[1]["summary"]["control_type"] == "resume_run"
    assert control_save_points[1]["summary"]["book_run_status"] == "running"
    assert save_points["runtime_recovery"]["latest_control"]["event_type"] == "stop_run"
    assert save_points["runtime_recovery"]["latest_control"]["control_type"] == "stop_run"
    assert save_points["runtime_recovery"]["latest_control"]["book_run_status"] == "stopped"


def test_agent_run_retry_from_checkpoint_projects_bookrun_retry_metadata(
    client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    """retry_from_checkpoint 控制消息要把 retry 起点镜像进 AgentRun facts。"""

    scope = seed_locked_blueprint(session_factory)
    created = client.post("/api/book-runs", json={**scope, "token_budget": 500}).json()
    run_id = f"bookrun-{created['id']}"
    progress = {
        "completed_chapters": [
            {"chapter_index": 1, "status": "completed", "model_run_id": 11, "judge_report_id": 12, "approved_scene_id": 13}
        ],
        "budget": {"tokens_used": 420},
    }
    progress_response = client.patch(
        f"/api/book-runs/{created['id']}/progress",
        json={"status": "paused_by_user", "current_chapter_index": 1, "progress": progress},
    )
    assert progress_response.status_code == 200, progress_response.text

    with client.websocket_connect("/api/ide/agent/sessions/session-bookrun-retry") as websocket:
        websocket.send_json(
            {
                "type": "retry_from_checkpoint",
                "run_id": run_id,
                "payload": {"reason": "retry from latest checkpoint"},
            }
        )
        retry_ack = websocket.receive_json()

    assert retry_ack["type"] == "retry_from_checkpoint"
    assert retry_ack["status"] == "recorded"
    assert retry_ack["run_id"] == run_id
    book_run = client.get(f"/api/book-runs/{created['id']}").json()
    assert book_run["status"] == "running"
    assert book_run["current_chapter_index"] == 2
    assert book_run["progress"]["retry_from_chapter_index"] == 2
    assert book_run["progress"]["retry_from_checkpoint"]["chapter_index"] == 1

    events = client.get(f"/api/agent-runs/{run_id}/events").json()
    retry_event = next(event for event in events if event["event_type"] == "retry_from_checkpoint")
    assert retry_event["payload"]["writing_run"]["status"] == "running"
    assert retry_event["payload"]["book_run"]["status"] == "running"
    tool_events = [event for event in events if event["event_type"] == "tool_trace" and event["actor"] == "bookrun-agent"]
    assert tool_events[-1]["payload"]["source"] == "agentrun.retry_from_checkpoint"
    assert tool_events[-1]["payload"]["retry_from_chapter_index"] == 2
    assert tool_events[-1]["payload"]["retry_checkpoint_chapter_index"] == 1

    checkpoints = client.get(f"/api/agent-runs/{run_id}/checkpoints").json()
    latest_checkpoint = checkpoints[-1]["payload"]
    assert latest_checkpoint["source"] == "agentrun.retry_from_checkpoint"
    assert latest_checkpoint["retry_from_chapter_index"] == 2
    assert latest_checkpoint["retry_checkpoint_chapter_index"] == 1
    assert latest_checkpoint["retry_checkpoint"]["model_run_id"] == 11

    save_points = client.get(f"/api/agent-runs/{run_id}/save-points").json()
    checkpoint_save_points = [item for item in save_points["save_points"] if item["kind"] == "bookrun_checkpoint"]
    latest_save_point = checkpoint_save_points[-1]
    assert latest_save_point["summary"]["retry_from_chapter_index"] == 2
    assert latest_save_point["summary"]["retry_checkpoint_chapter_index"] == 1
    assert latest_save_point["summary"]["retry_checkpoint_model_run_id"] == 11
    control_save_point = next(item for item in save_points["save_points"] if item["kind"] == "control_message")
    assert control_save_point["event_type"] == "retry_from_checkpoint"
    assert control_save_point["summary"]["control_type"] == "retry_from_checkpoint"
    assert control_save_point["summary"]["book_run_status"] == "running"
    assert save_points["runtime_recovery"]["latest_control"]["event_type"] == "retry_from_checkpoint"
    assert save_points["runtime_recovery"]["latest_control"]["control_type"] == "retry_from_checkpoint"
    assert save_points["runtime_recovery"]["latest_control"]["book_run_status"] == "running"
    assert save_points["recoverability"]["resume_strategy"] == "bookrun_checkpoint"


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


def test_agent_run_event_sequence_unique_index_rejects_duplicates(session: Session) -> None:
    """同一 run 内重复 sequence 必须被唯一索引拒绝，事件重放顺序不允许歧义。"""

    from sqlalchemy.exc import IntegrityError

    run = _seed_agent_run(session, public_id="run-sequence-unique")
    session.add(AgentRunEvent(run_id=run.id, event_type="tool_trace", actor="root-agent", sequence=1))
    session.commit()

    session.add(AgentRunEvent(run_id=run.id, event_type="tool_trace", actor="root-agent", sequence=1))
    with pytest.raises(IntegrityError):
        session.commit()
    session.rollback()


def test_record_agent_event_retries_on_sequence_conflict(session: Session) -> None:
    """并发写读到相同 max(sequence) 时，冲突方必须重读重试而不是丢事件。"""

    from sqlalchemy import event as sa_event

    from app.domains.agent_runs.service import record_agent_event

    run = _seed_agent_run(session, public_id="run-sequence-retry")
    record_agent_event(session, run, event_type="agent_run_started", actor="root-agent")

    conflicts: list[int] = []

    def inject_conflicting_row(flush_session: Session, *_args: object) -> None:
        # 模拟另一连接抢先提交同号事件：在 ORM flush 之前塞入同 (run_id, sequence) 行。
        # 该行与失败的插入同处一个 SAVEPOINT，回滚后重试路径必须成功拿到该序号。
        conflicts.append(1)
        flush_session.connection().exec_driver_sql(
            "INSERT INTO agent_run_events (run_id, event_type, actor, message, payload, sequence) "
            f"VALUES ({run.id}, 'tool_trace', 'rival-writer', '', '{{}}', 2)"
        )

    sa_event.listen(session, "before_flush", inject_conflicting_row, once=True)

    recorded = record_agent_event(session, run, event_type="tool_trace", actor="root-agent")

    assert conflicts == [1]
    assert recorded.sequence == 2
    sequences = [event.sequence for event in _stored_run_events(session, run)]
    assert sequences == [1, 2]


def test_bootstrap_sqlite_renumbers_legacy_duplicate_sequences(tmp_path) -> None:
    """存量 sidecar 库带重复 (run_id, sequence) 时，bootstrap 必须先重排再补唯一索引。"""

    from sqlalchemy import create_engine
    from sqlalchemy import inspect as sa_inspect

    from app.db.base import Base
    from app.db.session import bootstrap_sqlite_database

    engine = create_engine(f"sqlite+pysqlite:///{tmp_path / 'legacy.sqlite3'}")
    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        connection.exec_driver_sql("DROP INDEX uq_agent_run_events_run_sequence")
        connection.exec_driver_sql(
            "INSERT INTO agent_runs (public_id, session_id, goal, scope, permission_profile, budget, status, root_plan) "
            "VALUES ('run-legacy', 'session-legacy', 'goal', '{}', 'risk_confirm', '{}', 'running', '[]')"
        )
        for sequence in (1, 2, 2, 3):
            connection.exec_driver_sql(
                "INSERT INTO agent_run_events (run_id, event_type, actor, message, payload, sequence) "
                f"VALUES (1, 'tool_trace', 'root-agent', '', '{{}}', {sequence})"
            )

    bootstrap_sqlite_database(engine)

    with engine.connect() as connection:
        rows = connection.exec_driver_sql(
            "SELECT sequence FROM agent_run_events WHERE run_id = 1 ORDER BY sequence, id"
        ).fetchall()
    assert [row[0] for row in rows] == [1, 2, 3, 4]
    index_names = {index["name"] for index in sa_inspect(engine).get_indexes("agent_run_events")}
    assert "uq_agent_run_events_run_sequence" in index_names
    engine.dispose()


def test_detect_intent_requires_scene_packet_for_chapter_review() -> None:
    """自由文本「审阅」没带 scene_packet_id 时必须落回 chat.explain 工具循环：
    chapter.review 绑定 DB 实体，路由过去只会因缺参报「这轮没跑通」。"""

    assert detect_runtime_intent("帮我审阅一下这个项目", {}, None) == "chat.explain"
    assert detect_runtime_intent("章节审阅", {}, None) == "chat.explain"
    assert detect_runtime_intent("审阅这一章", {"scene_packet_id": 3}, None) == "chapter.review"
    # F11：仅有文件上下文、无 reviewer role hint 的自由文本也落 chat.explain，
    # 由循环内 file.review 工具自主决定，不再被「审阅」关键词劫进固定管线。
    file_args = {"file_path": "正文/第01章.md", "content": "正文"}
    assert detect_runtime_intent("审阅这份稿子", file_args, None) == "chat.explain"
    # 带 reviewer role hint 才路由固定 file.review 管线。
    assert detect_runtime_intent("审阅这份稿子", {**file_args, "agent_role_hints": ["prose_reviewer"]}, None) == "file.review"


def test_reap_non_terminal_agent_runs_fails_stale_and_records_reason(session: Session) -> None:
    """起服收尸：running（线程已随进程消失）收为 failed 并写 reason=process_restart；
    paused（等待作者确认补丁 / 用户暂停的持久可恢复态）与已终态的不动。

    paused 必须保住：收尸它会毁掉待确认补丁并锁死 approve 门（仅在 status==paused 放行）。"""

    from app.domains.agent_runs.service import reap_non_terminal_agent_runs

    running = _seed_agent_run(session, public_id="run-reap-running")
    paused = _seed_agent_run(session, public_id="run-reap-paused")
    paused.status = "paused"
    already_done = _seed_agent_run(session, public_id="run-reap-done")
    already_done.status = "completed"
    session.add_all([paused, already_done])
    session.commit()

    reaped = reap_non_terminal_agent_runs(session)
    assert reaped == 1

    session.refresh(running)
    session.refresh(paused)
    session.refresh(already_done)
    assert running.status == "failed"
    assert paused.status == "paused"
    assert already_done.status == "completed"

    running_events = _stored_run_events(session, running)
    assert running_events[-1].event_type == "agent_run_failed"
    assert running_events[-1].payload["reason"] == "process_restart"


def test_complete_agent_run_payload_carries_rebuild_fields(session: Session) -> None:
    """AGENT_RUN_COMPLETED payload 落齐重建终态所需字段：断线后拉事件表即可复原（F10）。"""

    from app.domains.agent_runs.service import complete_agent_run

    run = _seed_agent_run(session, public_id="run-complete-payload")
    result = {
        "intent": "chat.explain",
        "assistant_session_id": 7,
        "agent_result": {
            "summary": "已完成审阅。",
            "requires_user_confirmation": False,
            "chat_loop": {"rounds": 3, "tool_call_count": 5, "extra": "略"},
        },
        "proposed_patch": {
            "id": "patch-1",
            "created_by_tool": "file.revise",
            "file_path": "正文/第01章.md",
            "before": "长" * 5000,
            "after": "长" * 5000,
        },
    }

    complete_agent_run(session, run, result=result)
    events = _stored_run_events(session, run)
    payload = events[-1].payload
    assert payload["intent"] == "chat.explain"
    assert payload["assistant_session_id"] == 7
    assert payload["summary"] == "已完成审阅。"
    assert payload["has_proposed_patch"] is True
    assert payload["proposed_patch"] == {
        "id": "patch-1",
        "created_by_tool": "file.revise",
        "file_path": "正文/第01章.md",
    }
    # 补丁全文不进事件表，避免膨胀。
    assert "before" not in payload["proposed_patch"]
    assert payload["chat_loop"] == {"rounds": 3, "tool_call_count": 5}


def test_websocket_terminal_encoder_emits_completed_event(session: Session) -> None:
    """完成事件必须能被编码成 WS 流消息，供断线重建路径重放（F10）。"""

    from app.domains.agent_runs.event_encoders import websocket_stream_events_from_agent_event
    from app.domains.agent_runs.service import complete_agent_run

    run = _seed_agent_run(session, public_id="run-terminal-encoder")
    complete_agent_run(
        session,
        run,
        result={
            "intent": "chat.explain",
            "assistant_session_id": 3,
            "agent_result": {"summary": "收工。", "requires_user_confirmation": False},
        },
    )
    completed_event = _stored_run_events(session, run)[-1]
    assert completed_event.event_type == "agent_run_completed"

    encoded = websocket_stream_events_from_agent_event(completed_event)
    assert len(encoded) == 1
    message = encoded[0]
    assert message["type"] == "agent_run_completed"
    assert message["run_id"] == run.public_id
    assert message["assistant_session_id"] == run.assistant_session_id
    assert message["status"] == "completed"
    assert message["payload"]["summary"] == "收工。"
