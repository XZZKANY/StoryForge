"""Agent run oracle (P3-5b2b): the real `run_agent_user_message` with the model scripted at the HTTP layer.

Every scenario starts a fresh in-memory sqlite database and synthetic project, then drives one author message
through run creation, the chat loop (real configured + observed provider, real tool handlers), the single-turn
fallback, hidden system jobs and execution settlement. Control writes flip the run row at a named interruption
boundary or while a request is in flight, and a virtual clock stands in for time. Recorded: frames, text frames,
the result or error, every row the run wrote (runs / events / artifacts / assistant sessions / messages / tool
calls), the HTTP requests and the interruption boundaries asked about. Long strings are kept as digests.
"""

from __future__ import annotations

import datetime as real_datetime
import email.message
import hashlib
import io
import json
import os
import shutil
from types import SimpleNamespace
from urllib import error
from uuid import UUID

import prometheus_client  # noqa: F401 - imported before the audit hook: its process collector probes /proc
from golden_fs import Project, isolated_fs_oracle, stable
from golden_llm_harness import FakeBody, sse

SECRET = "sk-oracle-secret-123456"
STEP = 0.25
SOURCES = [
    "app/domains/agent_runs/runtime.py",
    "app/domains/agent_runs/loop/conversation_runtime.py",
    "app/domains/agent_runs/tools/execution_runtime.py",
    "app/domains/agent_runs/runtime_delivery.py",
    "app/domains/agent_runs/service.py",
    "app/domains/agent_runs/events/review_sources.py",
]
SOURCE = {
    "STORYFORGE_LLM_PROVIDER": "openai",
    "STORYFORGE_LLM_MODEL": "m-1",
    "STORYFORGE_LLM_API_KEY": SECRET,
    "STORYFORGE_LLM_BASE_URL": "https://llm.example/v1",
    "STORYFORGE_LLM_TIMEOUT_SECONDS": "60",
    "STORYFORGE_LLM_RETRY_MAX_ATTEMPTS": "1",
    # Non-integral rates: TS numbers drop Python's 2.0 / 2 split, and these values end up inside evidence digests.
    "STORYFORGE_LLM_INPUT_CNY_PER_M_TOKENS": "2.5",
    "STORYFORGE_LLM_OUTPUT_CNY_PER_M_TOKENS": "8.5",
}
FILES = {
    "正文/第001章.md": "第一章 风起\n\n林舟推开门。\n",
    "正文/第002章.md": "第二章 夜行\n\n沈禾问路。\n",
    "人物/主角.md": "# 林舟\n\n左臂有旧伤。\n",
}
PROPOSAL = {"target_path": "设定/规则.md", "operation": "create", "title": "铁城宵禁", "claim": "铁城入夜宵禁",
            "kind": "world_rule", "confidence": "inferred", "sources": [{"type": "project_file", "path": "正文/第001章.md"}],
            "reason": "第一章提到"}
FIXED_NOW = (2026, 10, 12, 8, 30, 0)
HISTORY = [["user" if i % 2 == 0 else "assistant", f"第{i}条消息" + "。" * 20] for i in range(14)]


def completion(content="", calls=(), finish="stop", usage=(12, 5), **effects):
    message = {"role": "assistant", "content": content}
    if calls:
        message["tool_calls"] = [{"id": i, "type": "function", "function": {"name": n, "arguments": a}}
                                 for i, n, a in calls]
    body = {"id": "resp-1", "choices": [{"index": 0, "message": message, "finish_reason": finish}],
            "usage": {"prompt_tokens": usage[0], "completion_tokens": usage[1], "total_tokens": usage[0] + usage[1]}}
    return {"status": 200, "body": json.dumps(body, ensure_ascii=False), **effects}


def streamed(chunks=(), calls=(), finish="stop", usage=(12, 5), **effects):
    events = [{"choices": [{"index": 0, "delta": {"content": chunk}}]} for chunk in chunks]
    for index, (call_id, name, args) in enumerate(calls):
        events.append({"choices": [{"index": 0, "delta": {"tool_calls": [
            {"index": index, "id": call_id, "type": "function", "function": {"name": name, "arguments": args}}]}}]})
    events.append({"choices": [{"index": 0, "delta": {}, "finish_reason": finish}]})
    events.append({"choices": [], "usage": {"prompt_tokens": usage[0], "completion_tokens": usage[1],
                                            "total_tokens": usage[0] + usage[1]}})
    return {"status": 200, "body": sse(*events), **effects}


def message(text, run_id="run-1", project=True, file=True, **extra):
    args = {"project_path": "$ROOT"} if project else {}
    if file:
        args["file_path"] = "$ROOT/正文/第001章.md"
    args.update(extra.pop("args", {}))
    return {"type": "user_message", "user_message": text, "run_id": run_id, "args": args, **extra}


def scenario(name, msg, replies=(), **options):
    return {"id": name, "message": msg, "replies": list(replies), "env": options.pop("env", {}),
            "triggers": options.pop("triggers", []), "stream": options.pop("stream", False),
            "history": options.pop("history", None), "sessions": options.pop("sessions", []), **options}


def scenarios():
    s = []
    s.append(scenario("answer", message("第一章怎么样"), [completion("第一章节奏紧。")]))
    s.append(scenario("read-then-answer", message("读一下第一章再说", permission_profile="read"), [
        completion("", [("c1", "fs_read", '{"path":"正文/第001章.md"}'), ("c2", "fs_list", "{}")]),
        completion("读完了，开头很紧。")]))
    s.append(scenario("tools-in-two-rounds", message("先列再读"), [
        completion("", [("c1", "fs_list", "{}")]), completion("", [("c2", "fs_read", '{"path":"人物/主角.md"}')]),
        completion("都看过了。")]))
    s.append(scenario("stop-after-compaction", message("继续聊", assistant_session_id=1), [
        completion("好的。"), {"compaction_quote": True}], history=HISTORY,
        sessions=[{"title": "新的创作会话", "project_path": "$ROOT"}],
        triggers=[{"boundary": "before_publish:system_job:title", "nth": 1, "status": "stopped",
                   "current_step": "stopped"}]))
    s.append(scenario("stop-before-finalize", message("收尾前停"), [completion("答完了。")],
                      triggers=[{"boundary": "before_finalize:assistant.chat_loop", "nth": 1, "status": "stopped",
                                 "current_step": "stopped"}]))
    s.append(scenario("streaming", message("流式回答"), [
        streamed(["我先", "看看"], [("c1", "fs_list", "{}")]), streamed(["看完", f"了 {SECRET}"])], stream=True))
    s.append(scenario("long-history-compaction", message("继续聊", assistant_session_id=1), [
        completion("好的。"), {"compaction_quote": True}], history=HISTORY,
        sessions=[{"title": "新的创作会话", "project_path": "$ROOT"}]))
    s.append(scenario("pause-after-tool", message("先列目录"), [completion("", [("c1", "fs_list", "{}")])],
                      triggers=[{"boundary": "after_tool", "nth": 1, "status": "paused", "current_step": "paused"}]))
    s.append(scenario("stop-during-request", message("停"), [completion("答到一半", set_status=["stopped", "stopped"])]))
    s.append(scenario("fallback-not-configured", message("没配模型"), env={"STORYFORGE_LLM_API_KEY": None}))
    s.append(scenario("fallback-no-project", message("随便聊聊", project=False, file=False,
                                                     args={"selection_text": "选中的一句"}),
                      [completion("单轮回答。")]))
    s.append(scenario("fallback-llm-error", message("随便聊聊", project=False, file=False),
                      [{"status": 500, "body": '{"error":{"message":"upstream down"}}'}]))
    s.append(scenario("loop-provider-error", message("出错"), [
        completion("", [("c1", "fs_list", "{}")]), {"status": 500, "body": '{"error":{"message":"boom"}}'}]))
    s.append(scenario("session-project-mismatch", message("归属不对", assistant_session_id=1),
                      sessions=[{"title": "别处", "project_path": "D:/elsewhere"}]))
    s.append(scenario("session-id-conflict", message("两个会话", assistant_session_id=1,
                                                    args={"assistant_session_id": 2})))
    s.append(scenario("session-missing", message("不存在的会话", assistant_session_id=9)))
    s.append(scenario("file-intent-downgrade", message("审稿", file=False, intent="file.review"),
                      [completion("没有打开文件，按对话处理。")]))
    s.append(scenario("stop-before-title-job", message("收尾时停"), [completion("答完了。")],
                      triggers=[{"boundary": "before_publish:system_job:title", "nth": 1, "status": "stopped",
                                 "current_step": "stopped"}]))
    s.append(scenario("deadline", message("超时"), [completion("", [("c1", "fs_list", "{}")], advance=901)]))
    s.append(scenario("offered-review-not-latest", message(
        "按审稿意见改第一章", args={"review_report": {"report_id": "rr-1", "content_sha256": "x" * 64}})))
    s.append(scenario("stop-before-fallback", message("单轮前停", project=False, file=False),
                      triggers=[{"boundary": "before_fallback", "nth": 1, "status": "stopped",
                                 "current_step": "stopped"}]))
    s.append(scenario("knowledge-proposal", message("记一条设定"), [
        completion("", [("c1", "knowledge_propose", json.dumps({"proposals": [PROPOSAL]}, ensure_ascii=False))]),
        completion("提议已记下。")]))
    review = {"report_id": "rr-1", "file_path": "正文/第001章.md", "issues": []}
    s.append(scenario("required-review-unbound", message("按审稿意见改第一章", assistant_session_id=1,
                                                        args={"review_report": {"report_id": "rr-1"}}),
                      sessions=[{"title": "审稿会话", "project_path": "$ROOT"}], seed_review=review))
    s.append(scenario("offered-review-current", message(
        "按审稿意见改第一章", assistant_session_id=1,
        args={"review_report": {"report_id": "rr-1", "content_sha256": "c" * 64}}), [completion("先看看。")],
        sessions=[{"title": "审稿会话", "project_path": "$ROOT"}],
        seed_review={**review, "content_sha256": "c" * 64}))
    s.append(scenario("title-kept", message("老会话", assistant_session_id=1), [completion("好。")],
                      sessions=[{"title": "我自己起的名字", "project_path": "$ROOT"}]))
    return s


CONTROL_SOURCES = [
    "app/domains/agent_runs/service_control.py",
    "app/domains/agent_runs/service_execution.py",
    "app/domains/agent_runs/loop/recovery.py",
    "app/domains/agent_runs/loop/checkpoint_store.py",
    "app/domains/agent_runs/loop/recovery_sources.py",
]
PATCH = {"id": "patch-1", "kind": "file_revision", "file_path": "正文/第001章.md", "before": "旧", "after": "新",
         "requires_confirmation": True, "created_by_tool": "file.revise"}


def waiting(outcome=None):
    agent_result = {"summary": "补丁待确认", "requires_user_confirmation": True}
    if outcome:
        agent_result["execution_outcome"] = outcome
    return {"type": "agent_result", "session_id": "sess-1", "assistant_session_id": None, "intent": "file.revise",
            "user_message": "改第一章", "agent_result": agent_result, "tool_trace": [], "proposed_patch": PATCH,
            "plan": [{"step": "file.revise", "detail": "修订", "status": "completed"},
                     {"step": "permission.confirm", "detail": "等作者确认", "status": "needs_approval"}]}


def control_scenarios():
    pause, stop = {"type": "pause_run"}, {"type": "stop_run"}
    resume = {"op": "control", "type": "resume_run"}
    s = []
    s.append(scenario("pause-then-resume", message("先列目录再答"), [
        completion("", [("c1", "fs_list", "{}")], controls=[pause]), completion("看完了。")], ops=[resume]))
    s.append(scenario("pause-edit-then-resume", message("先读再答"), [
        completion("", [("c1", "fs_read", '{"path":"正文/第002章.md"}')], controls=[pause])],
        ops=[{"op": "edit", "path": "正文/第001章.md", "content": "第一章 改过"}, resume]))
    after_tool = [{"boundary": "after_tool", "nth": 1, "status": "paused", "current_step": "paused"}]
    # Paused after the first of two reads (the second, a directory, is still pending); the resumed run finishes
    # it, runs one more round and answers, numbering traces after the ones already recorded.
    s.append(scenario("pause-after-tool-then-resume", message("读人物再答"), [
        completion("", [("c1", "fs_read", '{"path":"人物/主角.md"}'), ("c2", "fs_read", '{"path":"正文"}')]),
        completion("", [("c3", "fs_list", "{}")]), completion("看过了。")], triggers=after_tool, ops=[resume]))
    s.append(scenario("pause-after-tool-unknown-tool-pending-then-resume", message("读人物再答"), [
        completion("", [("c1", "fs_read", '{"path":"人物/主角.md"}'), ("c2", "no_such_tool", "{}")]),
        completion("好。")], triggers=after_tool, ops=[resume]))
    s.append(scenario("pause-before-read-tool-then-resume", message("读人物再答"), [
        completion("", [("c1", "fs_read", '{"path":"人物/主角.md"}')]), completion("看过了。")],
        triggers=[{"boundary": "before_tool:fs.read", "nth": 1, "status": "paused", "current_step": "paused"}],
        ops=[resume]))
    s.append(scenario("pause-after-tool-create-instructions-then-resume", message("读人物再答"), [
        completion("", [("c1", "fs_read", '{"path":"人物/主角.md"}')])], triggers=after_tool,
        ops=[{"op": "edit", "path": ".storyforge/agent-instructions.md", "content": "只写短句"}, resume]))
    s.append(scenario("edit-read-file-mid-turn-then-resume", message("读人物再答"), [
        completion("", [("c1", "fs_read", '{"path":"人物/主角.md"}')]),
        completion("", [("c2", "fs_list", "{}")], edits={"人物/主角.md": "# 林舟 中途改过"}, controls=[pause])],
        ops=[resume]))
    s.append(scenario("pause-context-file-edit-then-resume", message("对照人物答", args={"context_bundle": {
        "files": [{"relative_path": "人物/主角.md", "excerpt": "左臂有旧伤。"}]}}), [
        completion("", [("c1", "fs_list", "{}")], controls=[pause])],
        ops=[{"op": "edit", "path": "人物/主角.md", "content": "# 林舟 改过"}, resume]))
    s.append(scenario("pause-before-finalize-then-resume", message("收尾前停"), [completion("答完了。")],
                      triggers=[{"boundary": "before_finalize:assistant.chat_loop", "nth": 1, "status": "paused",
                                 "current_step": "paused"}], ops=[resume]))
    s.append(scenario("pause-and-resume-in-flight", message("先列目录再答"), [
        completion("", [("c1", "fs_list", "{}")], controls=[pause, {"type": "resume_run"}]),
        completion("看完了。")], ops=[resume]))
    s.append(scenario("pause-after-tool-edit-read-file-then-resume", message("读人物再答"), [
        completion("", [("c1", "fs_read", '{"path":"人物/主角.md"}')])], triggers=after_tool,
        ops=[{"op": "edit", "path": "人物/主角.md", "content": "# 林舟 改过"}, resume]))
    s.append(scenario("pause-resume-then-resume-again", message("再恢复一次"), [
        completion("", [("c1", "fs_list", "{}")], controls=[pause]), completion("好。")], ops=[resume, resume]))
    s.append(scenario("stop-in-flight-then-resume", message("停"), [
        completion("答到一半", controls=[stop, stop])], ops=[resume]))
    s.append(scenario("controls-on-completed-run", message("答完"), [completion("好。")],
                      ops=[{"op": "control", "type": "pause_run"}, {"op": "control", "type": "stop_run"}, resume]))
    s.append(scenario("resume-without-checkpoint", message("单轮", project=False, file=False),
                      triggers=[{"boundary": "before_fallback", "nth": 1, "status": "paused",
                                 "current_step": "paused"}], ops=[resume]))
    s.append(scenario("resume-model-outcome-unknown", message("流式"), [streamed(["半句"], controls=[pause])],
                      stream=True, ops=[resume]))
    s.append(scenario("resume-tool-outcome-unknown", message("记设定"), [
        completion("", [("c1", "knowledge_propose", json.dumps({"proposals": [PROPOSAL]}, ensure_ascii=False))])],
        triggers=[{"boundary": "before_tool:knowledge.propose", "nth": 1, "status": "paused",
                   "current_step": "paused"}], ops=[resume]))
    s.append(scenario("resume-while-running", message("恢复正在跑的"), [
        completion("好。", controls=[{"type": "resume_run"}])], ops=[]))
    s.append(scenario("approve-plain", None, setup="permission_wait", wait_result=waiting(),
                      ops=[{"op": "control", "type": "approve_permission"}]))
    s.append(scenario("approve-with-outcome", None, setup="permission_wait",
                      wait_result=waiting({"status": "partial", "code": "provider_error", "message": "部分完成"}),
                      ops=[{"op": "control", "type": "approve_permission"},
                           {"op": "control", "type": "approve_permission"}]))
    s.append(scenario("deny", None, setup="permission_wait", wait_result=waiting(),
                      ops=[{"op": "control", "type": "deny_permission"}]))
    s.append(scenario("pause-run-not-yet-executing", None, setup="started_only",
                      ops=[{"op": "control", "type": "pause_run"}, resume]))
    s.append(scenario("resume-permission-wait", None, setup="permission_wait", wait_result=waiting(), ops=[resume]))
    s.append(scenario("pause-permission-wait-then-resume", None, setup="permission_wait", wait_result=waiting(),
                      ops=[{"op": "control", "type": "pause_run"}, resume]))
    s.append(scenario("forged-control-payload", message("答完"), [completion("好。")], ops=[
        {"op": "control", "type": "pause_run",
         "payload": {"control_effect": "applied", "runtime_recovery": {"resume_diagnostic": {"can_resume": True}},
                     "note": "作者附言"}}]))
    s.append(scenario("resume-again-while-resumed-run-in-flight", message("先列目录再答"), [
        completion("", [("c1", "fs_list", "{}")], controls=[pause]),
        completion("看完了。", controls=[{"type": "resume_run"}])], ops=[resume]))
    s.append(scenario("foreign-session-control", message("别人的 run"), [completion("好。")],
                      ops=[{"op": "control", "type": "pause_run", "session": "sess-other"}]))
    return s


def write_file(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content.encode("utf-8"))


def renumber_artifacts(record):
    """Checkpoints stay in engine memory in TS (§2.6), so they are dropped here and the remaining artifacts are
    numbered by rank; every `artifact_id` that pointed at one of them is rewritten the same way."""
    kept = [row for row in record["artifacts"] if row["kind"] != "runtime_checkpoint"]
    mapping = {row["id"]: rank for rank, row in enumerate(kept, start=1)}

    def remap(value):
        if isinstance(value, dict):
            return {key: mapping.get(item, item) if key == "artifact_id" and isinstance(item, int) else remap(item)
                    for key, item in value.items()}
        if isinstance(value, list):
            return [remap(item) for item in value]
        return value

    record["artifacts"] = [{**row, "id": mapping[row["id"]]} for row in kept]
    for key in ("events", "frames", "result"):
        if key in record:
            record[key] = remap(record[key])
    return record


def tool_digest(tools):
    encoded = json.dumps(tools, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return {"names": [tool["function"]["name"] for tool in tools], "sha256": hashlib.sha256(encoded.encode()).hexdigest()}


def compact(value):
    """Long strings become digests on both sides; tool schema lists become names plus a digest."""
    if isinstance(value, dict) and isinstance(value.get("tools"), list) and value["tools"] and all(
            isinstance(tool, dict) and "function" in tool for tool in value["tools"]):
        return {key: tool_digest(item) if key == "tools" else compact(item) for key, item in value.items()}
    if isinstance(value, str) and len(value) > 400:
        return {"sha256": hashlib.sha256(value.encode()).hexdigest(), "length": len(value)}
    if isinstance(value, dict):
        return {key: compact(item) for key, item in value.items()}
    if isinstance(value, list):
        return [compact(item) for item in value]
    return value


def p3_agent_run_snapshot() -> dict:
    return _snapshot("p3-agent-run", scenarios(), SOURCES)


def p3_agent_control_snapshot() -> dict:
    return _snapshot("p3-agent-control", control_scenarios(), SOURCES + CONTROL_SOURCES)


def drop_checkpoint_artifact_ids(value):
    """TS keeps checkpoints in engine memory (no artifact row), so its resume diagnostics carry no artifact_id."""
    if isinstance(value, dict):
        return {key: drop_checkpoint_artifact_ids(item) for key, item in value.items()
                if not (key == "artifact_id" and value.get("kind") == "runtime_checkpoint_resume")}
    if isinstance(value, list):
        return [drop_checkpoint_artifact_ids(item) for item in value]
    return value


def _snapshot(suite: str, specs: list, sources: list) -> dict:
    with isolated_fs_oracle("storyforge-golden-agent-run-", fixed=True) as (api, run_dir):
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker
        from sqlalchemy.pool import StaticPool

        from app.common import llm_client as lc
        from app.common import llm_control
        from app.common.version import APP_VERSION
        from app.db.base import Base
        from app.domains.agent_runs import event_sink, request_evidence, service, service_execution, text_stream
        from app.domains.agent_runs.event_encoders import websocket_stream_events_from_agent_event
        from app.domains.agent_runs.fs import knowledge_proposals as proposals_module
        from app.domains.agent_runs.loop import run_control
        from app.domains.agent_runs.models import AgentArtifact, AgentRun, AgentRunEvent, SubagentRun
        from app.domains.agent_runs.service_types import AgentRuntimeUserMessageError
        from app.domains.assistant.models import AssistantMessage, AssistantSession, AssistantToolCall
        from app.platform.ai_sdk.providers import openai_compatible

        class FixedDatetime(real_datetime.datetime):
            @classmethod
            def now(cls, tz=None):
                return real_datetime.datetime(*FIXED_NOW, tzinfo=tz)

        proposals_module.datetime = FixedDatetime
        clock = {"now": 100.0}
        virtual = SimpleNamespace(monotonic=lambda: clock["now"], sleep=lambda _s: None, time=lambda: clock["now"])
        for module in (lc, openai_compatible, run_control, llm_control):
            module.time = virtual
        real_check = event_sink.AgentRunEventSink.runtime_interruption
        state: dict = {}

        def runtime_interruption(self, run, *, boundary):
            state["checks"].append(boundary)
            for index, trigger in enumerate(state["triggers"]):
                if trigger["boundary"] == boundary:
                    state["trigger_counts"][index] += 1
                    if state["trigger_counts"][index] == trigger["nth"]:
                        set_status(trigger["status"], trigger["current_step"])
            return real_check(self, run, boundary=boundary)

        event_sink.AgentRunEventSink.runtime_interruption = runtime_interruption

        def set_status(status, step):
            db = state["db"]
            row = db.query(AgentRun).filter(AgentRun.public_id == "run-1").one()
            row.status, row.current_step = status, step
            db.add(row)
            db.commit()

        def fake_urlopen(req, timeout=None):
            clock["now"] += STEP
            body = json.loads(req.data.decode("utf-8")) if req.data is not None else None
            state["requests"].append({"url": req.full_url, "method": req.get_method(), "timeout": timeout,
                                      "body": body})
            reply = state["replies"].pop(0)
            if reply.get("set_status"):
                set_status(*reply["set_status"])
            for path, content in reply.get("edits", {}).items():
                write_file(state["project"].root / path, content)
            for control in reply.get("controls", []):
                state["controls"].append(run_control(control))
            clock["now"] += reply.get("advance", 0)
            if reply.get("compaction_quote"):
                model_input = json.loads(body["messages"][1]["content"])
                entries = [{"category": "decision", "text": f"摘要 {source['key']}", "source_id": source["key"],
                            "quote": source["content"][:10]} for source in model_input["new_sources"]]
                reply = completion(json.dumps({"entries": entries}, ensure_ascii=False))
            raw = reply.get("body", "").encode()
            if reply["status"] >= 400:
                headers = email.message.Message()
                raise error.HTTPError(req.full_url, reply["status"], "error", headers, io.BytesIO(raw))
            return FakeBody(raw, None, None, None)

        def run_control(control):
            # The control channel is another connection in production: a separate session on the same database.
            try:
                result = service.handle_agent_control_message(
                    state["control_db"], public_id="run-1", session_id=control.get("session", "sess-1"),
                    control_type=control["type"],
                    payload=control.get("payload"))
            except Exception as exc:  # noqa: BLE001 - the oracle records every failure shape
                return {"error": {"type": type(exc).__name__, "message": str(exc)}}
            return {"event": {"event_type": result.event.event_type, "sequence": result.event.sequence,
                              "payload": result.event.payload},
                    "resumed_result": result.resumed_result, "resume_diagnostic": result.resume_diagnostic}

        lc.request.urlopen = fake_urlopen
        records = []
        for spec in specs:
            if (run_dir / "book").exists():
                shutil.rmtree(run_dir / "book")
            project = Project(run_dir, "book", FILES)
            root = str(project.root)
            for key in list(os.environ):
                if key.startswith("STORYFORGE_LLM_"):
                    del os.environ[key]
            os.environ.update({k: v for k, v in {**SOURCE, **spec["env"]}.items() if v is not None})
            engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
            Base.metadata.create_all(engine)
            db = sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)()
            for session_spec in spec["sessions"]:
                db.add(AssistantSession(title=session_spec["title"], task_type="ide_agent_orchestration",
                                        project_path=session_spec["project_path"].replace("$ROOT", root)))
            db.commit()
            for role, content in spec["history"] or []:
                db.add(AssistantMessage(session_id=1, role=role, content=content))
            if spec.get("seed_review"):
                earlier = AgentRun(public_id="run-0", session_id="sess-0", assistant_session_id=1, goal="审稿",
                                   scope={}, permission_profile="ask", budget={}, status="completed", root_plan=[],
                                   current_step="completed")
                db.add(earlier)
                db.commit()
                db.add(AgentArtifact(run_id=earlier.id, kind="review_report", payload=spec["seed_review"],
                                     requires_confirmation=False))
            db.commit()
            clock["now"] = 100.0
            attempts, streams = iter(range(1, 100)), iter(range(1, 100))
            request_evidence.uuid4 = lambda attempts=attempts: f"attempt-{next(attempts)}"
            proposal_ids = iter(range(1, 100))
            proposals_module.uuid4 = lambda proposal_ids=proposal_ids: UUID(f"00000000-0000-4000-8000-{next(proposal_ids):012x}")
            text_stream.uuid4 = lambda streams=streams: f"stream-{next(streams)}"
            control_db = sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)()
            state.update(db=db, control_db=control_db, project=project, checks=[], requests=[], controls=[],
                         replies=json.loads(json.dumps(spec["replies"])),
                         triggers=spec["triggers"], trigger_counts=[0] * len(spec["triggers"]))
            frames, text_frames = [], []

            def on_event(event, frames=frames):
                frames.extend(websocket_stream_events_from_agent_event(event))

            record = {"id": spec["id"], "spec_json": json.dumps(spec, ensure_ascii=False)}
            if spec.get("setup"):
                # Built through the real lifecycle and sink: a run just created (no execution yet), or one
                # settled at permission.confirm.
                start = service.start_agent_user_message_run(
                    db, agent_session_id="sess-1", message={"user_message": "改第一章", "run_id": "run-1"})
                on_event(start.started_event)
                record["result"] = None
            if spec.get("setup") == "permission_wait":
                started = service_execution.start_agent_execution(db, start.run)
                sink = event_sink.AgentRunEventSink(db, on_event=on_event)
                sink.bind_execution(started)
                wait = json.loads(json.dumps(spec["wait_result"]))
                sink.record_permission_required(start.run, wait, reason="requires_user_confirmation")
                out_result, settled = service_execution.finish_agent_execution(db, start.run, started, wait)
                on_event(settled)
                record["result"] = out_result
            elif not spec.get("setup"):
                msg = json.loads(json.dumps(spec["message"]).replace("$ROOT", root.replace("\\", "\\\\")))
                if "file_path" in msg["args"]:
                    msg["args"]["file_path"] = str(project.root / "正文" / "第001章.md")
                try:
                    out = service.run_agent_user_message(
                        db, agent_session_id="sess-1", message=msg, on_event=on_event,
                        on_text=(lambda frame, text_frames=text_frames: text_frames.append(frame.model_dump()))
                        if spec["stream"] else None)
                    record["result"] = out.result
                except AgentRuntimeUserMessageError as exc:
                    record["error"] = {"type": type(exc).__name__, "message": str(exc)}
            for op in spec.get("ops", []):
                if op["op"] == "edit":
                    write_file(project.root / op["path"], op["content"])
                else:
                    state["controls"].append(run_control(op))
            if "ops" in spec:
                record["controls"] = state["controls"]
            control_db.close()
            db.expire_all()
            record.update(
                frames=frames, text_frames=text_frames, checks=state["checks"], requests=state["requests"],
                unused_replies=len(state["replies"]),
                runs=[{c: getattr(r, c) for c in ("id", "public_id", "session_id", "assistant_session_id", "goal",
                                                  "scope", "permission_profile", "budget", "status", "root_plan",
                                                  "current_step")} for r in db.query(AgentRun).order_by(AgentRun.id)],
                events=[{c: getattr(e, c) for c in ("id", "run_id", "event_type", "actor", "message", "payload",
                                                    "sequence")}
                        for e in db.query(AgentRunEvent).order_by(AgentRunEvent.id)],
                artifacts=[{c: getattr(a, c) for c in ("id", "run_id", "kind", "payload", "requires_confirmation")}
                           for a in db.query(AgentArtifact).order_by(AgentArtifact.id)],
                subagents=[{c: getattr(r, c) for c in ("id", "run_id", "role", "input", "output", "status")}
                           for r in db.query(SubagentRun).order_by(SubagentRun.id)],
                sessions=[{c: getattr(r, c) for c in ("id", "title", "task_type", "project_path")}
                          for r in db.query(AssistantSession).order_by(AssistantSession.id)],
                messages=[{c: getattr(r, c) for c in ("id", "session_id", "role", "content")}
                          for r in db.query(AssistantMessage).order_by(AssistantMessage.id)],
                tool_calls=[{c: getattr(r, c) for c in ("id", "session_id", "tool_name", "status", "input_summary",
                                                        "output_summary", "error_message")}
                            for r in db.query(AssistantToolCall).order_by(AssistantToolCall.id)],
            )
            plain = json.loads(json.dumps(record, ensure_ascii=False, default=str))
            normalized = compact(renumber_artifacts(drop_checkpoint_artifact_ids(stable(plain, project.root))))
            records.append({**normalized, "spec_json": record["spec_json"]})
            db.close()
        event_sink.AgentRunEventSink.runtime_interruption = real_check
        return {
            "format_version": 1,
            "suite": suite,
            "secret": SECRET,
            "source": SOURCE,
            "files": FILES,
            "history": HISTORY,
            "app_version": APP_VERSION,
            "step_seconds": STEP,
            "fixed_now": "2026-10-12T08:30:00Z",
            "sources": {path: hashlib.sha256((api / path).read_bytes()).hexdigest() for path in sources},
            "platform": "windows" if os.name == "nt" else "posix",
            "project_root": str(run_dir / "book"),
            "scenarios": records,
        }

