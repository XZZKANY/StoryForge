from __future__ import annotations

import pytest
from agent_run_test_support import (
    _seed_agent_run,
    _seed_chapter_review_scene_packet,
    _stored_run_artifacts,
    _stored_run_events,
)
from agent_transport import agent_result, control_agent
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.domains.agent_runs.models import AgentRun
from app.domains.ide import review_reasoning


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

    paused = agent_result(
        client,
        "session-control-resume-review",
        run_id="run-control-resume-review",
        user_message="审查当前章节",
        intent="file.review",
        args={
            "file_path": "正文/第01章.md",
            "content": "林岚走进港口。她看见灯塔熄灭。",
            "context_bundle": {"files": []},
        },
    )
    resumed_ack = control_agent(
        client,
        "session-control-resume-review",
        control_type="resume_run",
        run_id="run-control-resume-review",
        payload={"reason": "continue pending review"},
    )

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


def test_resume_run_parks_unresumable_agent_loop_run_as_stopped(session: Session) -> None:
    """chat.explain 等无 resume anchor 的 agent 循环被暂停后点恢复：不能留成 running 僵尸，回落 stopped。"""

    from app.domains.agent_runs.service import (
        get_agent_run,
        handle_agent_control_message,
        list_agent_artifacts,
    )

    run = _seed_agent_run(session, public_id="run-chat-loop-unresumable")
    run.status = "paused"
    run.current_step = "paused"
    session.add(run)
    session.commit()

    control = handle_agent_control_message(
        session,
        public_id=run.public_id,
        session_id=run.session_id,
        control_type="resume_run",
        payload={"reason": "resume a paused chat loop"},
    )

    assert control.resumed_result is None
    assert control.resume_diagnostic == {
        "kind": "runtime_pending_call_resume",
        "can_resume": False,
        "resume_via_control_channel": False,
        "requires_manual_restart": False,
        "reason": "no_pending_call",
        "resume_strategy": "start_new_message",
        "reverted_status": "stopped",
    }
    refreshed = get_agent_run(session, run.public_id)
    assert refreshed.status == "stopped"
    assert refreshed.current_step == "stopped"
    assert control.event.payload["runtime_recovery"]["resume_diagnostic"] == control.resume_diagnostic
    assert list_agent_artifacts(session, run.public_id) == []


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
