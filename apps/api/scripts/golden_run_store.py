"""Run store oracle (P3-5a): the real run lifecycle services and event sink on in-memory sqlite.

A JSON operation script (start a run, record plan / traces / artifacts / permission / system jobs /
progress, guarded completion and failure, worker settlement, plus out-of-band status changes standing in
for the control channel) runs through the Python code; every operation records the rows it appended,
the frames it emitted and the run row afterwards.
"""

from __future__ import annotations

import copy
import hashlib
import json
import os

import prometheus_client  # noqa: F401 - imported before the audit hook: its process collector probes /proc
from golden_fs import isolated_fs_oracle

SECRET = "sk-oracle-secret-123456"
SOURCES = [
    "app/domains/agent_runs/event_sink.py",
    "app/domains/agent_runs/service_store.py",
    "app/domains/agent_runs/service_lifecycle.py",
    "app/domains/agent_runs/service_execution.py",
    "app/domains/agent_runs/events/contracts.py",
    "app/domains/agent_runs/events/runtime_support.py",
]
PATCH = {"id": "patch-1", "kind": "file_revision", "file_path": "正文/第001章.md", "before": "旧", "after": "新",
         "requires_confirmation": True, "created_by_tool": "file.revise"}


def result(summary="完成", **extra):
    base = {"type": "agent_result", "session_id": "sess-a", "assistant_session_id": 7, "intent": "chat.explain",
            "user_message": "u", "plan": [{"step": "agent.loop", "detail": "d", "status": "completed"}],
            "agent_result": {"summary": summary, "requires_user_confirmation": False}, "tool_trace": [],
            "proposed_patch": None}
    for key, value in extra.items():
        if key == "agent_result":
            base["agent_result"] = {**base["agent_result"], **value}
        else:
            base[key] = value
    return base


SCRIPTS = [
    ("happy-path", [
        {"op": "start", "agent_session_id": "sess-a", "message": {
            "type": "user_message", "intent": "chat.explain", "user_message": f"  帮我看看 token={SECRET}  ",
            "run_id": "run-a", "permission_profile": "risk_confirm",
            "args": {"file_path": "正文/第001章.md", "content": "正文", "project_name": "书", "token_budget": 100,
                     "agent_role_hints": ["prose_reviewer", "nobody"], "agent_role_mentions": ["情节", "某某"],
                     "author_view": {"cursor_line": 3, "selection_text": "选中"}}}},
        {"op": "execution_start", "run": "run-a"},
        {"op": "plan", "run": "run-a", "result": {"intent": "chat.explain", "assistant_session_id": 7, "plan": [
            {"step": "agent.loop", "detail": f"用 {SECRET} 读文件", "status": "running"}, "bad",
            {"step": "respond", "detail": "回答", "status": "pending"}]}},
        {"op": "tool_trace", "run": "run-a", "index": 0, "trace": {
            "tool_name": "fs.read", "status": "completed", "input_summary": {"path": "正文/第001章.md"},
            "output_summary": {"returned_chars": 12}, "assistant_tool_call_id": 3}},
        {"op": "tool_trace", "run": "run-a", "index": 1, "trace": {
            "tool_name": "subagent.plot_reviewer", "status": "completed", "input_summary": {"api_key": "k"},
            "output_summary": {"issue_count": 2}}},
        {"op": "tool_trace", "run": "run-a", "index": 2, "trace": {
            "tool_name": "file.review", "status": "failed", "input_summary": {}, "error_message": "坏了"}},
        {"op": "artifact", "run": "run-a", "kind": "review_report", "payload": {"issues": [], "token": SECRET},
         "requires_confirmation": False},
        {"op": "artifact", "run": "run-a", "kind": "knowledge_proposal", "requires_confirmation": False,
         "payload": {"proposal_group_id": "kpg-1", "revision": 2, "proposals": [{"target_path": "设定/a.md"},
                                                                                {"target_path": 3}, "x"]}},
        {"op": "artifact", "run": "run-a", "kind": "runtime_pending_call", "requires_confirmation": False,
         "payload": {"status": "pending", "intent": "chapter.write", "secret_body": "正文"}},
        {"op": "progress", "run": "run-a", "payload": {"phase": "retry_wait", "request_number": 2,
                                                       "delay_seconds": 1.5, "url": "x"}},
        {"op": "runtime_interruption", "run": "run-a", "boundary": "before_round:2"},
        {"op": "system_job", "run": "run-a", "key": "title", "payload": {
            "status": "completed", "message": "标题已更新。", "title": "新标题"}},
        {"op": "system_job", "run": "run-a", "key": "summary", "payload": {"status": "completed",
                                                                           "actor": "system-summary"},
         "artifact_kind": "system_summary", "artifact_payload": {"summary": "摘要"}},
        {"op": "system_job", "run": "run-a", "key": "compaction", "payload": {"status": "skipped"},
         "artifact_kind": "system_compaction", "artifact_payload": None},
        {"op": "complete", "run": "run-a", "result": result(
            "全部完成" + "😀" * 10 + "长" * 4100, proposed_patch=PATCH,
            agent_result={"chat_loop": {"rounds": 2, "tool_call_count": 3}, "review_report": {"issues": []}})},
        {"op": "complete", "run": "run-a", "result": result("重复完成")},
        {"op": "finish", "run": "run-a", "result": result()},
    ]),
    ("permission-wait", [
        {"op": "start", "agent_session_id": "sess-b", "message": {"user_message": "改第一章", "run_id": "run-b"}},
        {"op": "execution_start", "run": "run-b"},
        {"op": "plan", "run": "run-b", "result": {"intent": "file.revise", "assistant_session_id": 5, "plan": []}},
        {"op": "permission_required", "run": "run-b", "reason": "requires_user_confirmation", "result": result(
            "补丁待确认", proposed_patch=PATCH, agent_result={
                "requires_user_confirmation": True, "confirmation_action": {"type": "accept"},
                "confirmation_kind": "patch", "execution_outcome": {"status": "partial", "code": "c", "message": "m"}})},
        {"op": "permission_required", "run": "run-b", "reason": "again", "result": result("第二次")},
        {"op": "finish", "run": "run-b", "result": result("补丁待确认", agent_result={"requires_user_confirmation": True})},
    ]),
    ("author-pause", [
        {"op": "start", "agent_session_id": "sess-c", "message": {"content": "写下一章", "run_id": "run-c",
                                                                  "permission_profile": "auto"}},
        {"op": "execution_start", "run": "run-c"},
        {"op": "set_status", "run": "run-c", "status": "paused", "current_step": "paused"},
        {"op": "runtime_interruption", "run": "run-c", "boundary": "after_tool:fs.read"},
        {"op": "complete", "run": "run-c", "result": result("不该完成")},
        {"op": "fail", "run": "run-c", "message": "不该失败", "payload": {}},
        {"op": "permission_required", "run": "run-c", "reason": "x", "result": result()},
        {"op": "finish", "run": "run-c", "result": result("循环停下", agent_result={"chat_loop": {"rounds": 1}})},
    ]),
    ("stop-without-result", [
        {"op": "start", "agent_session_id": "sess-d", "message": {"message": "停", "run_id": "run-d"}},
        {"op": "execution_start", "run": "run-d"},
        {"op": "permission_required", "run": "run-d", "reason": "requires_user_confirmation",
         "result": result("待确认", proposed_patch={**PATCH, "created_by_tool": "file.create"},
                          agent_result={"requires_user_confirmation": True,
                                                                     "execution_outcome": {"status": "failed",
                                                                                           "code": "x", "message": "y"}})},
        {"op": "set_status", "run": "run-d", "status": "stopped", "current_step": "stopped"},
        {"op": "finish", "run": "run-d", "result": None},
    ]),
    ("failure", [
        {"op": "start", "agent_session_id": "sess-e", "message": {"user_message": "x", "run_id": "run-e",
                                                                  "permission_profile": "full"}},
        {"op": "execution_start", "run": "run-e"},
        {"op": "fail", "run": "run-e", "message": f"出错 {SECRET}", "payload": {
            "reason": "provider_error", "session_id": "sess-e", "run_id": "run-e", "runtime": "agent_runtime",
            "execution_result": {"plan": []}, "extra": 3}},
        {"op": "finish", "run": "run-e", "result": None},
    ]),
    ("resume-terminal-run", [
        {"op": "start", "agent_session_id": "sess-a", "message": {"user_message": "再来一次", "run_id": "run-a",
                                                                  "args": {"book_id": 3}}},
        {"op": "execution_start", "run": "run-a"},
        {"op": "complete", "run": "run-a", "result": result("第二轮完成", assistant_session_id=True)},
        {"op": "finish", "run": "run-a", "result": result()},
    ]),
    ("paused-confirmation-brief", [
        {"op": "start", "agent_session_id": "sess-f", "message": {"user_message": "写", "run_id": "run-f"}},
        {"op": "execution_start", "run": "run-f"},
        {"op": "set_status", "run": "run-f", "status": "paused", "current_step": "chapter.brief.confirm"},
        {"op": "finish", "run": "run-f", "result": result("章纲待确认", agent_result={
            "requires_user_confirmation": True, "runtime_interrupted": True},
            runtime_interruption={"status": "paused"})},
    ]),
    ("cross-session-resume", [
        {"op": "start", "agent_session_id": "sess-z", "message": {"user_message": "抢", "run_id": "run-a"}},
    ]),
    ("resume-keeps-profile", [
        {"op": "start", "agent_session_id": "sess-e", "message": {"user_message": f"接着 {SECRET}", "run_id": "run-e"}},
        {"op": "start", "agent_session_id": "sess-a", "message": {"user_message": "无参续接", "run_id": "run-a"}},
    ]),
    ("stop-bare", [
        {"op": "start", "agent_session_id": "sess-g", "message": {"user_message": "停", "run_id": "run-g"}},
        {"op": "execution_start", "run": "run-g"},
        {"op": "plan", "run": "run-g", "result": {"intent": "chat.explain", "plan": [
            {"step": "agent.loop", "detail": "d", "status": "running"}]}},
        {"op": "set_status", "run": "run-g", "status": "stopped", "current_step": "stopped"},
        {"op": "finish", "run": "run-g", "result": None},
    ]),
    ("stop-after-plain-permission", [
        {"op": "start", "agent_session_id": "sess-h", "message": {"user_message": "改", "run_id": "run-h"}},
        {"op": "execution_start", "run": "run-h"},
        {"op": "permission_required", "run": "run-h", "reason": "requires_user_confirmation", "result": result(
            "待确认", intent="file.revise", proposed_patch={**PATCH, "created_by_tool": None},
            agent_result={"requires_user_confirmation": True})},
        {"op": "set_status", "run": "run-h", "status": "stopped", "current_step": "stopped"},
        {"op": "finish", "run": "run-h", "result": None},
        {"op": "start", "agent_session_id": "sess-h", "message": {"user_message": "再停", "run_id": "run-h"}},
        {"op": "execution_start", "run": "run-h"},
        {"op": "set_status", "run": "run-h", "status": "stopped", "current_step": "stopped"},
        {"op": "finish", "run": "run-h", "result": result("第二轮", intent="file.revise", user_message="第二轮原话")},
        {"op": "start", "agent_session_id": "sess-h", "message": {"user_message": "三停", "run_id": "run-h"}},
        {"op": "execution_start", "run": "run-h"},
        {"op": "set_status", "run": "run-h", "status": "stopped", "current_step": "stopped"},
        {"op": "finish", "run": "run-h", "result": None},
    ]),
    ("paused-with-interruption", [
        {"op": "start", "agent_session_id": "sess-i", "message": {"user_message": "暂停", "run_id": "run-i"}},
        {"op": "execution_start", "run": "run-i"},
        {"op": "set_status", "run": "run-i", "status": "paused", "current_step": "paused"},
        {"op": "finish", "run": "run-i", "result": result("中途", agent_result={"proposed_patch": PATCH},
                                                          runtime_interruption={
            "status": "paused", "boundary": "before_round:3", "requested_by": "author"})},
    ]),
    ("paused-permission-without-confirmation", [
        {"op": "start", "agent_session_id": "sess-j", "message": {"user_message": "等", "run_id": "run-j"}},
        {"op": "execution_start", "run": "run-j"},
        {"op": "set_status", "run": "run-j", "status": "paused", "current_step": "permission.confirm"},
        {"op": "finish", "run": "run-j", "result": result("无需确认")},
    ]),
]


def p3_run_store_snapshot() -> dict:
    with isolated_fs_oracle("storyforge-golden-runs-") as (api, _run):
        os.environ["STORYFORGE_LLM_API_KEY"] = SECRET
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker
        from sqlalchemy.pool import StaticPool

        from app.db.base import Base
        from app.domains.agent_runs import service_execution, service_lifecycle
        from app.domains.agent_runs.event_encoders import websocket_stream_events_from_agent_event
        from app.domains.agent_runs.event_sink import AgentRunEventSink
        from app.domains.agent_runs.models import AgentArtifact, AgentRun, AgentRunEvent, SubagentRun
        from app.domains.agent_runs.service_types import AgentRunNotFoundError
        from app.domains.agent_runs.trace import AgentToolTrace
        from app.domains.assistant.models import AssistantSession  # noqa: F401 - registers the FK target

        engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
        Base.metadata.create_all(engine)
        db = sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)()
        for index in range(1, 8):
            db.add(AssistantSession(title=f"s{index}", task_type="t", project_path=None))
        db.commit()
        frames: list = []

        def on_event(event):
            frames.append(websocket_stream_events_from_agent_event(event))

        sinks, started = {}, {}
        seen = {"events": 0, "artifacts": 0, "subagents": 0}

        def run_row(public_id):
            row = db.query(AgentRun).filter(AgentRun.public_id == public_id).one()
            db.refresh(row)
            return row

        def snapshot(row):
            return {key: getattr(row, key) for key in ("id", "public_id", "session_id", "assistant_session_id", "goal",
                                                        "scope", "permission_profile", "budget", "status", "root_plan",
                                                        "current_step")}

        def new_rows(model, key, columns):
            rows = db.query(model).filter(model.id > seen[key]).order_by(model.id).all()
            if rows:
                seen[key] = rows[-1].id
            return [{column: getattr(row, column) for column in columns} for row in rows]

        scripts = []
        for name, operations in SCRIPTS:
            steps = []
            for written in operations:
                op = copy.deepcopy(written)
                frames.clear()
                returned = None
                kind = op["op"]
                if kind == "start":
                    try:
                        out = service_lifecycle.start_agent_user_message_run(
                            db, agent_session_id=op["agent_session_id"], message=op["message"])
                    except AgentRunNotFoundError as exc:
                        db.rollback()
                        returned = {"error": type(exc).__name__, "message": str(exc)}
                    else:
                        on_event(out.started_event)
                        sinks[out.run.public_id] = AgentRunEventSink(db, on_event=on_event)
                        returned = out.run.public_id
                else:
                    row = run_row(op["run"])
                    sink = sinks[op["run"]]
                    if kind == "execution_start":
                        event = service_execution.start_agent_execution(db, row)
                        sink.bind_execution(event)
                        started[op["run"]] = event
                    elif kind == "plan":
                        sink.record_plan(row, op["result"])
                    elif kind == "tool_trace":
                        trace = op["trace"]
                        sink.record_tool_trace(row, AgentToolTrace(
                            tool_name=trace["tool_name"], status=trace["status"], input_summary=trace["input_summary"],
                            output_summary=trace.get("output_summary"),
                            assistant_tool_call_id=trace.get("assistant_tool_call_id"),
                            error_message=trace.get("error_message")), op["index"])
                    elif kind == "artifact":
                        sink.record_artifact(row, kind=op["kind"], payload=op["payload"],
                                             requires_confirmation=op["requires_confirmation"])
                    elif kind == "permission_required":
                        sink.record_permission_required(row, op["result"], reason=op["reason"])
                    elif kind == "system_job":
                        sink.record_system_job(row, key=op["key"], payload=op["payload"],
                                               artifact_kind=op.get("artifact_kind"),
                                               artifact_payload=op.get("artifact_payload"))
                    elif kind == "progress":
                        sink.record_runtime_progress(row, op["payload"])
                    elif kind == "runtime_interruption":
                        returned = sink.runtime_interruption(row, boundary=op["boundary"])
                    elif kind == "complete":
                        sink.complete(row, op["result"])
                    elif kind == "fail":
                        sink.fail(row, message=op["message"], payload=op["payload"])
                    elif kind == "set_status":
                        row.status, row.current_step = op["status"], op["current_step"]
                        db.add(row)
                        db.commit()
                    elif kind == "finish":
                        out_result, settled = service_execution.finish_agent_execution(
                            db, row, started[op["run"]], op["result"])
                        on_event(settled)
                        returned = out_result
                steps.append({
                    "op": written, "returned": returned,
                    "events": new_rows(AgentRunEvent, "events", ("id", "run_id", "event_type", "actor", "message",
                                                                  "payload", "sequence")),
                    "artifacts": new_rows(AgentArtifact, "artifacts", ("id", "run_id", "kind", "payload",
                                                                       "requires_confirmation")),
                    "subagents": new_rows(SubagentRun, "subagents", ("id", "run_id", "parent_run_id", "role", "input",
                                                                     "output", "status")),
                    "frames": [frame for batch in frames for frame in batch],
                    "run": snapshot(run_row(op["message"]["run_id"] if kind == "start" else op["run"])),
                })
            scripts.append({"id": name, "steps_json": json.dumps(steps, ensure_ascii=False, default=str)})
        return {
            "format_version": 1,
            "suite": "p3-run-store",
            "secret": SECRET,
            "sources": {path: hashlib.sha256((api / path).read_bytes()).hexdigest() for path in SOURCES},
            "platform": "windows" if os.name == "nt" else "posix",
            "scripts": scripts,
        }
