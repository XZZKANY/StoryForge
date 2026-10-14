"""Save point projection records (P3-7b): synthetic events / artifacts through the real
`build_agent_run_save_point_projection`, for the type and ordering branches the end-to-end runs never reach
(booleans counted as ints, empty strings, non-dict payloads, unsorted rows, long failure messages)."""

from __future__ import annotations

from types import SimpleNamespace

LONG = "长" * 498 + "😀ab"


def ev(event_id, event_type, sequence, payload=None, message=""):
    return {"id": event_id, "event_type": event_type, "sequence": sequence, "payload": payload, "message": message}


def art(artifact_id, kind, payload=None, requires_confirmation=False):
    return {"id": artifact_id, "kind": kind, "payload": payload, "requires_confirmation": requires_confirmation}


PENDING = {"status": "pending", "intent": "file.review", "boundary": "after_tool:context.load",
           "pending_tool": "file.review", "resume_strategy": "continue_pending_call"}


def cases() -> list[dict]:
    run = {"public_id": "run-1", "status": "paused", "current_step": "paused"}
    c = []
    c.append({"id": "trace-types", "run": run, "artifacts": [], "events": [
        ev(1, "agent_run_started", 1),
        ev(2, "tool_trace", 2, {"trace": {"tool_name": "", "status": "completed", "audit_event_id": "a1"},
                                "index": True}),
        ev(3, "tool_trace", 3, {"trace": {"tool_name": "fs.read", "status": 1}, "index": 2.5}),
        ev(4, "tool_trace", 4, {"trace": "x", "index": 0}),
        ev(5, "tool_trace", 5, ["not", "a", "dict"]),
    ]})
    c.append({"id": "recovery-types", "run": run, "artifacts": [], "events": [
        ev(1, "tool_trace", 1, {"trace": {"tool_name": "t"}, "recovery": {
            "kind": "", "tool_name": "fs.read", "status": "completed", "execution_mode": "inline",
            "audit_event_id": "", "index": False, "retry_safe": True, "idempotent": "yes",
            "artifact_kinds": ["a", 1, None, "b"],
            "execution_marker": {"kind": "k", "source": "", "tool_name": "fs.read", "status": "done",
                                 "resume_strategy": "replay", "reason": "", "tool_index": True,
                                 "replay_safe": False}}}),
        ev(2, "tool_trace", 2, {"trace": {"tool_name": "fallback"}, "index": 7, "recovery": {}}),
        ev(3, "tool_trace", 3, {"trace": {"tool_name": "x"}, "recovery": {"execution_marker": {}}}),
        ev(4, "tool_trace", 4, {"recovery": {"execution_marker": {"replay_safe": True, "tool_index": 3}}}),
        ev(5, "tool_trace", 5, {"recovery": {"execution_marker": {"replay_safe": "yes", "kind": "late"}}}),
        ev(6, "tool_trace", 6, {"recovery": "x"}),
    ]})
    c.append({"id": "permission-pending", "run": run, "events": [
        ev(1, "agent_run_started", 1),
        ev(2, "permission_approved", 2, {"control_type": "", "reason": "r", "source": 1, "run_id": "run-1",
                                         "session_id": ""}),
        ev(3, "permission_required", 3, {"blocked_tool": ""}),
        ev(4, "permission_required", 4, {"blocked_tool": "file.revise"}),
    ], "artifacts": [art(1, "proposed_patch", {"kind": "file_revision"}, True)]})
    c.append({"id": "permission-decided-after", "run": run, "events": [
        ev(1, "permission_required", 1, "x"),
        ev(2, "permission_denied", 2, {}),
    ], "artifacts": [art(1, "proposed_patch", {}, True)]})
    c.append({"id": "permission-not-paused", "run": {**run, "status": "running"}, "events": [
        ev(1, "permission_required", 1, {"blocked_tool": "file.revise"}),
    ], "artifacts": [art(1, "proposed_patch", {}, True)]})
    c.append({"id": "artifact-summaries", "run": run, "events": [], "artifacts": [
        art(3, "review_report", {"kind": "x", "file_path": "", "status": 1, "intent": True, "boundary": None,
                                 "token_budget": 2.5, "total_chapters": 12, "resolution": "",
                                 "pending_artifact_id": True,
                                 "context_output": {"file_path": "正文/a.md", "content": "😀ab"}}),
        art(1, "proposed_patch", "not a dict"),
        art(2, "runtime_pending_call", {**PENDING, "status": "resolved"}),
        art(4, "runtime_pending_call_resolution", {"status": "resolved", "resolution": "", "resolved_by": "resume",
                                                    "pending_artifact_id": 2, "next_trace_index": True,
                                                    "pending_tool": 3}),
        art(5, "custom", {"context_output": {"file_path": "", "content": 3}}),
        art(6, "custom", {"context_output": {}}),
    ]})
    c.append({"id": "pending-call-active", "run": {**run, "status": "running", "current_step": "resumed"},
              "events": [ev(1, "agent_execution_started", 1)],
              "artifacts": [art(1, "runtime_pending_call", PENDING),
                            art(2, "runtime_pending_call_resolution", {"status": "resolved"}),
                            art(3, "runtime_pending_call", PENDING)]})
    c.append({"id": "pending-call-superseded", "run": run, "events": [],
              "artifacts": [art(1, "runtime_pending_call", PENDING),
                            art(2, "runtime_pending_call_resolution", {"status": "resolved", "pending_artifact_id": 1})]})
    c.append({"id": "pending-call-on-completed-run", "run": {**run, "status": "completed", "current_step": "completed"},
              "events": [ev(1, "agent_execution_settled", 1)],
              "artifacts": [art(1, "runtime_pending_call", PENDING)]})
    c.append({"id": "failure-with-marker", "run": {**run, "status": "failed", "current_step": "failed"}, "events": [
        ev(1, "tool_trace", 1, {"recovery": {"execution_marker": {"kind": "k", "tool_name": "t", "status": "s",
                                                                  "resume_strategy": "r", "reason": "why",
                                                                  "replay_safe": True, "tool_index": 2}}}),
        ev(2, "tool_trace", 2, {"recovery": {"execution_marker": {"kind": "k2", "replay_safe": False}}}),
        ev(3, "agent_run_failed", 3, {}, LONG),
        ev(4, "agent_run_failed", 4, {}, ""),
    ], "artifacts": []})
    c.append({"id": "failure-without-marker", "run": {**run, "status": "failed"}, "events": [
        ev(1, "agent_run_failed", 1, {}, "失败了"),
    ], "artifacts": []})
    c.append({"id": "controls-and-interruptions", "run": {**run, "status": "stopped", "current_step": "stopped"},
              "events": [
                  ev(1, "pause_run", 1, {"control_type": "pause_run", "reason": "author", "source": "desktop"}),
                  ev(2, "resume_run", 2, {"runtime_recovery": {"resume_diagnostic": {
                      "kind": "runtime_checkpoint_resume", "reason": "ok", "artifact_id": True, "next_trace_index": 3,
                      "can_resume": "true", "resume_via_control_channel": False, "status": "",
                      "requires_manual_restart": True}}}),
                  ev(3, "resume_run", 3, {"runtime_recovery": {"resume_diagnostic": {}}}),
                  ev(4, "resume_run", 4, {"runtime_recovery": "x"}),
                  ev(5, "retry_from_checkpoint", 5, {"session_id": "sess-1"}),
                  ev(6, "stop_run", 6, {"run_id": "run-1"}),
                  ev(7, "agent_run_interrupted", 7, {}),
              ], "artifacts": []})
    c.append({"id": "pause-latest-interruption", "run": run, "events": [
        ev(1, "stop_run", 1, {}), ev(2, "pause_run", 2, {}), ev(3, "agent_run_completed", 3, {})], "artifacts": []})
    c.append({"id": "unsorted-rows", "run": {**run, "status": "completed"}, "events": [
        ev(5, "agent_run_completed", 3, {}), ev(2, "agent_run_started", 1), ev(9, "tool_trace", 2, {"index": 1}),
        ev(4, "tool_trace", 2, {"index": 0}), ev(7, "agent_execution_started", 4),
        ev(8, "agent_execution_settled", 5)], "artifacts": [art(9, "a", {}), art(3, "b", {})]})
    c.append({"id": "no-execution-events-running", "run": {**run, "status": "running"}, "events": [
        ev(1, "agent_run_started", 1)], "artifacts": []})
    c.append({"id": "interrupted-is-latest-execution", "run": {**run, "status": "paused"}, "events": [
        ev(1, "agent_execution_started", 1), ev(2, "agent_run_interrupted", 2, {})], "artifacts": []})
    c.append({"id": "resolution-with-pending-status", "run": run, "events": [],
              "artifacts": [art(1, "runtime_pending_call_resolution", {**PENDING})]})
    c.append({"id": "stop-after-completion", "run": {**run, "status": "completed"}, "events": [
        ev(1, "agent_run_completed", 1, {}), ev(2, "stop_run", 2, {})], "artifacts": []})
    c.append({"id": "secret-in-payloads", "run": run, "events": [
        ev(1, "pause_run", 1, {"reason": "sk-oracle-secret-123456"})],
        "artifacts": [art(1, "custom", {"file_path": "sk-oracle-secret-123456"})]})
    return c


def save_point_records() -> list[dict]:
    from app.domains.agent_runs.save_points import build_agent_run_save_point_projection

    records = []
    for case in cases():
        run = SimpleNamespace(**case["run"])
        events = [SimpleNamespace(**row) for row in case["events"]]
        artifacts = [SimpleNamespace(**row) for row in case["artifacts"]]
        records.append({**case, "output": build_agent_run_save_point_projection(run, events=events,
                                                                                 artifacts=artifacts)})
    return records
