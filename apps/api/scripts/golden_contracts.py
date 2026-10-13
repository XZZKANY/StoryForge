"""Agent contracts oracle: permission policy, intent, run payloads, result contracts, author view,
tool traces / recovery markers, runtime progress, frame encoders and the text-stream frames."""

from __future__ import annotations

import hashlib
import json
import os
from types import SimpleNamespace

from golden_fs import isolated_fs_oracle

SECRET = "sk-oracle-secret-123456"
SOURCES = [
    "app/domains/agent_runs/permission/policy.py",
    "app/domains/agent_runs/intent.py",
    "app/domains/agent_runs/run_payloads.py",
    "app/domains/agent_runs/result_contracts.py",
    "app/domains/agent_runs/event_types.py",
    "app/domains/agent_runs/event_encoders.py",
    "app/domains/agent_runs/ws_messages.py",
    "app/domains/agent_runs/text_stream.py",
    "app/domains/agent_runs/runtime_progress.py",
    "app/domains/agent_runs/runtime_recovery.py",
    "app/domains/agent_runs/trace.py",
    "app/domains/agent_runs/loop/author_view.py",
]
PROFILES = [None, "", "  ", "ask", " auto ", "read", "full", "risk_confirm", "step_confirm", "autonomous",
            "full_allow", "autonomous_approval", "bogus", "ASK", 1, True]
STAGES = ["explore", "brief", "draft", "proposed_patch", "writeback", "deploy"]
TOOLS = [("read", "inline"), ("analyze", "inline"), ("write_pending", "inline"), ("long_running", "control"),
         ("long_running", "managed_run"), ("deploy", "inline")]
PAYLOADS = [None, {}, {"confirmed": True}, {"confirmed": "true"}, {"confirmed": 1}]
MESSAGES = ["", "确认写回", "就这版写回吧", "接受当前补丁", "确认当前修订", "把它写回", "应用这版", "写回去，确认",
            "应用一下当前补丁", "Accept this", "please APPLY THIS now", "confirm writeback", "确认一下人设", "接受",
            "写回", "帮我改第三章", "  Accept   this  "]
ROLE_ARGS = [{}, {"agent_role_hints": ["plot_reviewer", " prose_reviewer ", "nobody", 3, ""]},
             {"agent_role_mentions": ["情节", "@情节审稿", "人物", "不存在", " "]},
             {"agent_role_hints": "plot_reviewer"}, {"agent_role_hints": ["plot_reviewer", "plot_reviewer"],
                                                   "agent_role_mentions": ["plot_reviewer"]},
             {"agent_role_hints": ["continuity_reviewer"], "agent_role_mentions": ["连续性"]},
             {"agent_role_hints": ["main_agent", "writer"]}]


def contracts_snapshot(api) -> dict:
    from app.domains.agent_runs import intent, run_payloads
    from app.domains.agent_runs import runtime_recovery as recovery
    from app.domains.agent_runs.event_encoders import websocket_control_event, websocket_stream_events_from_agent_event
    from app.domains.agent_runs.event_types import event_type_for_control_message
    from app.domains.agent_runs.loop import author_view as av
    from app.domains.agent_runs.permission import (
        PermissionGate,
        PermissionPolicy,
        PermissionProfileError,
        canonical_permission_profile,
        normalize_permission_profile,
        patch_requires_confirmation,
    )
    from app.domains.agent_runs.result_contracts import execution_result_payload, resolve_execution_result
    from app.domains.agent_runs.runtime_progress import normalize_runtime_progress
    from app.domains.agent_runs.trace import AgentToolTrace

    records: list[dict] = []

    def record(fn, args, run):
        row = {"fn": fn, "args": args}
        try:
            row["output"] = json.loads(json.dumps(run(), ensure_ascii=False, default=str))
        except (PermissionProfileError, ValueError, intent.AgentOrchestrationError) as error:
            row["error"] = {"type": type(error).__name__, "message": str(error)}
        records.append(row)

    policy = PermissionPolicy()
    for value in PROFILES:
        for allow in (True, False):
            record("normalize_permission_profile", {"value": value, "allow_missing": allow},
                   lambda value=value, allow=allow: vars(normalize_permission_profile(value, allow_missing=allow)))
        for fallback in (None, "auto", "bogus"):
            record("canonical_permission_profile", {"value": value, "fallback": fallback},
                   lambda value=value, fallback=fallback: canonical_permission_profile(value, fallback=fallback))
        record("patch_requires_confirmation", {"profile": value},
               lambda value=value: patch_requires_confirmation(value))
        for stage in STAGES:
            record("decide_stage", {"profile": value, "stage": stage},
                   lambda value=value, stage=stage: vars(policy.decide_stage(value, stage)))
        for risk, mode in TOOLS:
            for payload in PAYLOADS:
                tool = SimpleNamespace(risk_level=risk, execution_mode=mode)
                args = {"profile": value, "risk_level": risk, "execution_mode": mode, "payload": payload}
                record("decide_tool", args, lambda value=value, tool=tool, payload=payload: vars(
                    policy.decide_tool(value, tool, payload=payload)))
                record("gate_decide", args, lambda value=value, tool=tool, payload=payload: vars(
                    PermissionGate().decide(SimpleNamespace(permission_profile=value), tool, payload=payload)))

    for message in MESSAGES:
        record("is_confirm_writeback_request", {"message": message},
               lambda message=message: intent._is_confirm_writeback_request(message))
    intent_args = [{}, {"file_path": "a.md", "content": "x"}, {"file_path": " ", "content": "x"},
                   {"file_path": "a.md", "content": 1}, {"file_path": "a.md", "content": "", "agent_role_hints":
                                                          ["prose_reviewer"]},
                   {"file_path": "a.md", "content": "x", "agent_role_mentions": ["情节"]},
                   {"file_path": "a.md", "agent_role_hints": ["plot_reviewer"]},
                   {"file_path": "a.md", "content": "x", "agent_role_hints": ["main_agent"]}]
    for message in ["审查一下", "确认写回"]:
        for args in intent_args:
            for explicit in (None, "file.revise", "chapter.write", "chapter.review", "bookrun.start", 3):
                record("detect_intent", {"message": message, "args": args, "explicit": explicit},
                       lambda m=message, a=args, e=explicit: intent.detect_intent(m, a, e))
    for message in [{}, {"user_message": "  hi  "}, {"user_message": " ", "message": "m"}, {"content": "c"},
                    {"user_message": 3, "content": " x "}, {"message": "　"}]:
        record("message_text", {"message": message}, lambda message=message: intent.message_text(message))
        record("payload_message_text", {"message": message}, lambda message=message: run_payloads.message_text(message))
    for message in [{}, {"args": [1]}, {"args": {"a": 1}}]:
        record("message_args", {"message": message}, lambda message=message: intent.message_args(message))
    for args in ROLE_ARGS:
        record("role_hints", {"args": args}, lambda args=args: intent.role_hints(args))
        record("role_mentions", {"args": args}, lambda args=args: intent.role_mentions(args))
        record("scope_summary", {"args": args}, lambda args=args: run_payloads.scope_summary(args))

    summaries = [
        {}, {"type": "user_message", "intent": "chat.explain", "args": {}},
        {"args": {"file_path": "正文/第1章.md", "content": "𠀀a\r\nb", "book_id": 0, "scene_packet_id": None}},
        {"assistant_session_id": 7, "args": {"assistant_session_id": 9, "blueprint_id": "bp"}},
        {"args": {"author_view": {"file_path": "x.md", "cursor_line": 3, "selection_text": "选中😀"},
                  "content": "正文"}},
        {"args": {"author_view": "bad"}, "assistant_session_id": 4},
        {"args": "notadict", "file_path": "top.md"},
    ]
    for message in summaries:
        record("message_input_summary", {"message": message},
               lambda message=message: run_payloads.message_input_summary(message))
    for args in [{"file_path": "a.md", "book_id": 3, "scene_packet_id": 2.5, "project_name": "书", "blueprint_id": True},
                 {"file_path": None, "project_name": ["x"]}]:
        record("scope_summary", {"args": args}, lambda args=args: run_payloads.scope_summary(args))
    for scope in [None, [], {}, {"a": None}, {"a": 0}, {"b": "x"}]:
        record("has_scope_key", {"scope": scope, "keys": ["a", "b"]},
               lambda scope=scope: run_payloads.has_scope_key(scope, "a", "b"))
        record("scope_string_list", {"scope": scope, "key": "b"},
               lambda scope=scope: run_payloads.scope_string_list(scope, "b"))
    for scope in [{"b": ["x", " ", 3, "y "]}, {"b": "x"}]:
        record("scope_string_list", {"scope": scope, "key": "b"},
               lambda scope=scope: run_payloads.scope_string_list(scope, "b"))
    for args in [{}, {"token_budget": 10, "time_budget_sec": 0}, {"token_budget": True, "time_budget_sec": 5},
                 {"token_budget": 2.5}]:
        record("budget_summary", {"args": args}, lambda args=args: run_payloads.budget_summary(args))
    for plan in [[], [{"step": "a", "status": "completed"}], [{"step": "a", "status": "completed"},
                                                                 {"step": None, "status": "running"}],
                 [1, {"step": "b", "status": "skipped"}, {"step": 3}], [{"step": "a", "status": "completed"}, "x"],
                 [{"status": "running"}], [{"step": "z", "status": "completed"}, {"step": "y", "status": "skipped"}]]:
        record("current_plan_step", {"plan": plan}, lambda plan=plan: run_payloads.current_plan_step(plan))
    for control in ["approve_permission", "deny_permission", "pause_run", "resume_run", "stop_run",
                    "retry_from_checkpoint", "weird"]:
        record("control_event_type", {"control": control},
               lambda control=control: run_payloads.control_event_type(control))
        record("event_type_for_control_message", {"control": control},
               lambda control=control: event_type_for_control_message(control))
        record("control_event_message", {"control": control},
               lambda control=control: run_payloads.control_event_message(control))

    result = {"type": "agent_result", "plan": [{"step": "agent.loop", "status": "completed", "detail": "d"},
                                               {"step": "permission.confirm", "status": "needs_approval",
                                                "detail": "x"}],
              "agent_result": {"summary": "s", "requires_user_confirmation": True}, "proposed_patch": {"id": "p"},
              "_events_recorded": True, "_internal": {"x": 1}}
    record("execution_result_payload", {"result": result}, lambda: execution_result_payload(result))
    for approved in (True, False):
        payload = execution_result_payload(result)
        record("resolve_execution_result", {"payload": payload, "approved": approved},
               lambda payload=payload, approved=approved: resolve_execution_result(payload, approved=approved))
    record("resolve_execution_result", {"payload": {"execution_result": "x"}, "approved": True},
           lambda: resolve_execution_result({"execution_result": "x"}, approved=True))

    contents = ["", "第一行\n第二行\n\n第三段\n第四行", "\n".join(f"段落{i}" * 40 for i in range(60)),
                "\n\n".join("长段" * 300 for _ in range(6)), "a\r\nb\r\n",
                "\n\n".join(f"第{i}段文字内容。" for i in range(80)), "a\n\n" + "𠀀" * 30]
    views = [{}, {"author_view": None, "file_path": " 正文/a.md "},
             {"author_view": {"file_path": "x.md", "cursor_line": 2, "cursor_column": 4, "selection_text": "  "},
              "content": contents[1]},
             {"author_view": {"cursor_line": True, "selection_text": "选" * 4100}, "content": "x"},
             {"author_view": {"cursor_line": -3, "cursor_column": 2.5}, "content": contents[1]},
             {"author_view": {"cursor_line": 30}, "content": contents[2], "file_path": "f.md"},
             {"author_view": {"cursor_line": 2}, "content": contents[3]},
             {"author_view": {"cursor_line": 99}, "content": contents[4]},
             {"author_view": {"cursor_line": 1}, "content": "\n\n\n"}]
    for args in views:
        view = av.AuthorView.from_payload(args)
        record("author_view", {"args": args}, lambda view=view: {
            "view": vars(view), "has_view": view.has_view, "block": av.build_author_view_block(view),
            "summary": av.author_view_summary(view)})
    for content in contents:
        for line in (0, 1, 3, 30, 1000):
            for before, after in ((1500, 600), (40, 30), (40, 120)):
                record("cursor_window", {"content": content, "line": line, "before": before, "after": after},
                       lambda c=content, ln=line, b=before, a=after: list(av.cursor_window(
                           c, ln, before_chars=b, after_chars=a)))
    for block in [None, "", " \n ", "  文件A摘录  ", "x" * 7000]:
        record("build_pinned_context_block", {"block": block},
               lambda block=block: av.build_pinned_context_block(block))

    traces = [AgentToolTrace("fs.read", "completed", {"path": "a.md"}),
              AgentToolTrace("file.revise", "failed", {}, {"x": 1}, "evt-1", 9, "boom"),
              AgentToolTrace("file.review", "completed", {}, None, None, 0, None)]
    specs = [None, SimpleNamespace(retry_safe=True, idempotent=True, execution_mode="inline",
                                   artifact_kinds=("review_report",)),
             SimpleNamespace(retry_safe=True, idempotent=False, execution_mode="inline", artifact_kinds=())]
    for trace in traces:
        record("trace_as_dict", {"trace": vars(trace)}, lambda trace=trace: trace.as_dict())
        for index, spec in enumerate(specs):
            spec_args = None if spec is None else {**vars(spec), "artifact_kinds": list(spec.artifact_kinds)}
            record("build_tool_recovery_payload", {"trace": vars(trace), "index": index, "spec": spec_args},
                   lambda trace=trace, index=index, spec=spec: recovery.build_tool_recovery_payload(
                       trace, index, spec=spec))
    for status, step in [("paused", "paused"), ("stopped", 3), ("running", "x"), ("completed", None),
                         ("paused", None)]:
        record("build_runtime_interruption_payload", {"status": status, "current_step": step, "boundary": "b:1"},
               lambda status=status, step=step: recovery.build_runtime_interruption_payload(
                   SimpleNamespace(status=status, current_step=step), boundary="b:1"))
    pending_payloads = [None, {}, {"status": "done"}, {"status": "pending", "intent": "file.review",
                                                        "boundary": "after_tool:context.load", "next_trace_index": 2},
                        {"status": "pending", "intent": "file.review", "boundary": "x", "resume_strategy": "r",
                         "next_trace_index": "3"},
                        {"status": "pending", "intent": "chapter.review", "boundary": ""},
                        {"status": "pending", "intent": "chapter.write", "secret": "s"},
                        {"status": "pending", "intent": 3}]
    for payload in pending_payloads:
        for artifact_id, kind in [(None, "runtime_pending_call"), (5, None), (6, "")]:
            record("build_runtime_pending_call_summary", {"payload": payload, "artifact_id": artifact_id,
                                                          "artifact_kind": kind},
                   lambda p=payload, i=artifact_id, k=kind: recovery.build_runtime_pending_call_summary(
                       p, artifact_id=i, artifact_kind=k))
    for event_type, payload in [("tool_trace", {"kind": "runtime_pending_call"}),
                                ("agent_artifact", {"kind": "review_report", "payload": {"a": 1}}),
                                ("agent_artifact", {"kind": "runtime_pending_call", "payload": pending_payloads[3],
                                                    "artifact_id": 4, "requires_confirmation": False}),
                                ("agent_artifact", {"kind": "runtime_pending_call", "payload": "x",
                                                    "artifact_id": True, "requires_confirmation": 1})]:
        record("public_runtime_event_payload", {"event_type": event_type, "payload": payload},
               lambda e=event_type, p=payload: recovery.public_runtime_event_payload(e, p))

    for progress in [{"phase": "request_started", "request_number": 1, "timeout_seconds": 60.0, "url": "x"},
                     {"phase": "retry_wait", "request_number": 2, "delay_seconds": 1.5},
                     {"phase": "retry_started", "request_number": 3, "extra": 1},
                     {"phase": "request_started", "request_number": 0, "timeout_seconds": 1},
                     {"phase": "retry_wait", "request_number": 1, "delay_seconds": -1},
                     {"phase": "retry_wait", "request_number": 1, "delay_seconds": True},
                     {"phase": "nope", "request_number": 1}, {"phase": "request_started", "request_number": True,
                                                              "timeout_seconds": 1},
                     {"phase": "request_started", "request_number": 1, "timeout_seconds": 0}]:
        record("normalize_runtime_progress", {"progress": progress},
               lambda progress=progress: normalize_runtime_progress(progress))

    run = SimpleNamespace(session_id="sess-1", public_id="run-1", assistant_session_id=7, status="paused",
                          goal=f"帮我看看 api_key={SECRET} 的问题", permission_profile="risk_confirm",
                          scope={"agent_role_hints": ["plot_reviewer", " ", 3, f"token {SECRET}"],
                                 "agent_role_mentions": "x"})
    bare = SimpleNamespace(session_id="sess-2", public_id="run-2", assistant_session_id=None, status="completed",
                           goal="g", permission_profile="bogus", scope=None)
    events = [
        ("agent_run_started", {}, "开始"),
        ("agent_plan_created", {"plan": [{"step": "agent.loop", "detail": f"用 {SECRET}", "status": "running"}, "x",
                                         {"step": 3, "detail": None}]}, "计划"),
        ("agent_plan_created", {"plan": "x"}, "计划"),
        ("agent_runtime_progress", {"phase": "request_started", "request_number": 2, "timeout_seconds": 60}, "m"),
        ("agent_runtime_progress", {"phase": "retry_wait", "request_number": 2, "delay_seconds": 1.5}, "m"),
        ("agent_runtime_progress", {"phase": "retry_wait", "request_number": 2, "delay_seconds": 2.0}, "m"),
        ("agent_runtime_progress", {"phase": "retry_wait", "request_number": 3, "delay_seconds": 0}, "m"),
        ("agent_runtime_progress", {"phase": "retry_started", "request_number": 2}, "m"),
        ("tool_trace", {"index": 3, "trace": {"tool_name": "fs.read", "input_summary": {
            "authorization": "Bearer abc", "path": "a.md"}}}, "t"),
        ("tool_trace", {"index": "3", "trace": "x"}, "t"),
        ("permission_required", {"permission_profile": "auto", "reason": f"need {SECRET}", "proposed_patch": {
            "id": "p1", "api_key": "k"}, "confirmation_action": {"type": "x"}, "blocked_tool": "file.revise"}, "p"),
        ("permission_required", {"proposed_patch": "x", "confirmation_action": f"token={SECRET}"}, "p"),
        ("agent_run_completed", {"result": {"summary": f"secret {SECRET}"}, "assistant_session_id": 7}, f"完成 {SECRET}"),
        ("agent_run_failed", {}, "失败"), ("agent_run_interrupted", {"status": "paused"}, "中断"),
        ("agent_artifact", {}, "a"), ("system_job", {}, "s"),
    ]
    for owner in (run, bare):
        for index, (event_type, payload, message) in enumerate(events):
            event = SimpleNamespace(id=100 + index, run_id=1, event_type=event_type, actor="agent-runtime",
                                    message=message, payload=payload, sequence=index + 1, run=owner)
            record("stream_frames", {"run": vars(owner), "event": {
                "id": event.id, "event_type": event_type, "message": message, "payload": payload,
                "sequence": event.sequence}}, lambda event=event: websocket_stream_events_from_agent_event(event))
    for control, payload in [("pause_run", {"session_id": "s", "run_id": "r", "control_effect": "applied",
                                           "runtime_state": "settled", "run_status": "paused"}),
                             ("permission_approved", {"session_id": None, "control_effect": None}),
                             ("resume_run", {"session_id": 0, "run_id": "", "run_status": "running"}),
                             ("stop_run", {"run_id": "r", "control_effect": "requested", "runtime_state": "in_flight"})]:
        event = SimpleNamespace(id=9, event_type=control, payload=payload)
        record("control_frame", {"event": {"id": 9, "event_type": control, "payload": payload}},
               lambda event=event: websocket_control_event(event))
    return records


def text_stream_snapshot() -> list[dict]:
    from app.common.llm_control import LLMRunControl, LLMRunInterrupted, llm_run_control
    from app.domains.agent_runs import text_stream
    from app.platform.ai_sdk import ChatRequest, ChatResponse, StreamEvent, StreamEventKind, TokenUsage
    from app.platform.ai_sdk.errors import ProviderError, ProviderErrorCategory, ProviderErrorDetails

    text_stream.uuid4 = lambda: "stream-1"
    cases = [
        ("no-observer", False, True, [{"text": "x"}, {"done": "full text", "finish": "stop"}], None),
        ("not-streaming", True, False, [], None),
        ("plain", True, True, [{"text": "你好"}, {"text": "，世界"}, {"done": " 你好，世界 ", "finish": "stop",
                                                                         "usage": [3, 4, 7]}], None),
        ("think-and-secret", True, True, [{"text": "<think>内</th"}, {"text": "ink>答案 sk-abcdefghijklmn"},
                                          {"text": f" 与 {SECRET}"}, {"done": "<think>x</think>答案", "finish":
                                                                          "tool_calls"}], None),
        ("long-delta", True, True, [{"text": "长" * 9000}, {"done": "长" * 9000, "finish": "end_turn"}], None),
        ("length", True, True, [{"text": "半句"}, {"done": "半句", "finish": "length", "usage": [1, 1, 2]}], None),
        ("content-filter", True, True, [{"text": "x"}, {"done": "x", "finish": "content_filter"}], None),
        ("no-completed", True, True, [{"text": "x", "usage": [1, 2, 3]}], None),
        ("bad-finish", True, True, [{"text": "x"}, {"done": "x", "finish": "weird"}], None),
        ("finish-none", True, True, [{"done": "only final", "finish": None}], None),
        ("unsupported-first", True, True, [{"raise": "unsupported"}], None),
        ("unsupported-later", True, True, [{"text": "x", "usage": [2, 0, 2]}, {"raise": "unsupported"}], None),
        ("other-error", True, True, [{"text": "x", "usage": [2, 0, 2]}, {"raise": "timeout"}], None),
        ("interrupt-delta", True, True, [{"text": "a"}, {"text": "b"}, {"done": "ab", "finish": "stop"}],
         ("before_text_delta", 2)),
        ("interrupt-event", True, True, [{"text": "a", "usage": [5, 0, 5]}, {"text": "b"},
                                         {"done": "ab", "finish": "stop"}], ("before_text_stream_event", 2)),
    ]
    out = []
    for name, observer_on, streaming, script, interrupt in cases:
        frames = []

        class Provider:
            def capabilities(self, model, streaming=streaming):
                return SimpleNamespace(streaming=streaming)

            def complete(self, request, script=script):
                return ChatResponse("completed:" + request.model, finish_reason="stop")

            def stream(self, request, script=script):
                for item in script:
                    usage = TokenUsage(*item["usage"], source="provider_usage") if "usage" in item else None
                    if "raise" in item:
                        raise ProviderError(ProviderErrorDetails(ProviderErrorCategory(item["raise"]), "boom"))
                    if "done" in item:
                        response = ChatResponse(item["done"], finish_reason=item["finish"], usage=usage or TokenUsage())
                        yield StreamEvent(StreamEventKind.COMPLETED, response=response, usage=usage)
                    else:
                        yield StreamEvent(StreamEventKind.TEXT_DELTA, text=item["text"], usage=usage)

        counts = {}

        def check(boundary, interrupt=interrupt, counts=counts):
            counts[boundary] = counts.get(boundary, 0) + 1
            if interrupt and boundary == interrupt[0] and counts[boundary] >= interrupt[1]:
                return "stopped"
            return None

        context = SimpleNamespace(on_text=(lambda frame, frames=frames: frames.append(frame.to_wire())) if observer_on else None,
                                  run=SimpleNamespace(public_id="run-9"), completed_model_rounds=2,
                                  source={"STORYFORGE_LLM_API_KEY": SECRET, "STORYFORGE_LLM_MODEL": "m"})
        row = {"id": name, "observer": observer_on, "streaming": streaming, "script": script,
               "interrupt": list(interrupt) if interrupt else None}
        try:
            with llm_run_control(LLMRunControl(check)):
                response = text_stream.complete_with_text_stream(Provider(), ChatRequest(model="m", messages=()),
                                                                 context=context)
            row["response"] = {"content": response.content, "finish_reason": response.finish_reason}
        except (ProviderError, LLMRunInterrupted) as error:
            usage = getattr(error, "usage", None)
            row["error"] = {"type": type(error).__name__, "message": str(error),
                            "category": error.details.category.value if isinstance(error, ProviderError) else None,
                            "code": error.details.provider_code if isinstance(error, ProviderError) else None,
                            "usage": None if usage is None else usage.to_legacy()}
        row["frames"] = frames
        out.append(row)
    return out


def p3_contracts_snapshot() -> dict:
    with isolated_fs_oracle("storyforge-golden-contracts-") as (api, _run):
        os.environ["STORYFORGE_LLM_API_KEY"] = SECRET
        records = contracts_snapshot(api)
        streams = text_stream_snapshot()
        return {
            "format_version": 1,
            "suite": "p3-contracts",
            "secret": SECRET,
            "sources": {path: hashlib.sha256((api / path).read_bytes()).hexdigest() for path in SOURCES},
            "platform": "windows" if os.name == "nt" else "posix",
            "records": records,
            "text_stream": streams,
        }
