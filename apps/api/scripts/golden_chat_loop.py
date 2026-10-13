"""Chat loop oracle (P3-5b1): the real `run_chat_loop` and its SDK adapters on in-memory sqlite.

A scripted provider (patched over `loop_runtime.build_llm_provider`) answers each model request, a scripted
`execute_fs_tool` stands in for the per-tool handlers, and scripted control writes flip the run row the way the
control channel does. Each scenario records the model requests, the interruption boundaries the run control asked
about, the evidence-store operations, the traces and text frames, the checkpoints and the final outcome.
"""

from __future__ import annotations

import hashlib
import json
import os
import time

import prometheus_client  # noqa: F401 - imported before the audit hook: its process collector probes /proc
from golden_fs import Project, isolated_fs_oracle, stable

SECRET = "sk-oracle-secret-123456"
SOURCES = [
    "app/domains/agent_runs/loop_runtime.py",
    "app/domains/agent_runs/loop/sdk_adapters.py",
    "app/domains/agent_runs/loop/sdk_context.py",
    "app/domains/agent_runs/loop/types.py",
    "app/domains/agent_runs/loop/run_control.py",
    "app/domains/agent_runs/loop/checkpoint_store.py",
    "app/domains/agent_runs/patches/types.py",
]
SOURCE = {
    "STORYFORGE_LLM_PROVIDER": "openai",
    "STORYFORGE_LLM_MODEL": "m-1",
    "STORYFORGE_LLM_API_KEY": SECRET,
    "STORYFORGE_LLM_BASE_URL": "https://llm.example/v1",
    "STORYFORGE_LLM_INPUT_CNY_PER_M_TOKENS": "2",
    "STORYFORGE_LLM_OUTPUT_CNY_PER_M_TOKENS": "8",
}
FILES = {
    "正文/第001章.md": "第一章 风起\n\n林舟推开门。\n",
    "正文/第002章.md": "第二章 夜行\n\n沈禾问路。\n",
    "人物/主角.md": "# 林舟\n\n左臂有旧伤。\n",
}
PATCH = {"id": "patch-1", "kind": "file_revision", "file_path": "正文/第001章.md", "before": "旧", "after": "新",
         "requires_confirmation": True, "created_by_tool": "file.revise"}
MANIFEST = {"version": "generation-sources-v1", "delivery_boundary": "writer_provider_seam",
            "project_identity_sha256": "a" * 64, "request": {"system_sha256": "b" * 64, "user_sha256": "c" * 64}}
U = [12, 5, 17, "provider_usage"]
PROPOSAL = {"target_path": "设定/规则.md", "operation": "create", "title": "铁城宵禁", "claim": "铁城入夜宵禁",
            "kind": "world_rule", "confidence": "inferred", "sources": [{"path": "正文/第001章.md"}],
            "reason": "第一章提到"}


def call(call_id, name, args="{}"):
    return [call_id, name, args]


def reply(content="", calls=(), usage=None, finish="stop", **extra):
    return {"content": content, "calls": list(calls), "usage": usage, "finish": finish, **extra}


def ok(output, trace=None, artifacts=(), **extra):
    return {"result": {"status": "completed", "output": output, "trace": trace or {}, "artifacts": list(artifacts)},
            **extra}


def boom(kind, message="", **extra):
    return {"raise": {"type": kind, "message": message}, **extra}


READ = ok({"path": "正文/第001章.md", "content": "林舟推开门。", "returned_chars": 6, "truncated": False})
REVIEW = ok({"review_report": {"file_path": "正文/第001章.md", "mode": "multi_agent",
                               "issues": [{"id": "i1", "category": "plot", "severity": "minor", "message": "节奏慢",
                                           "evidence": "长"}], "suggested_actions": ["收紧"]},
             "summary": "1 个问题"},
            trace={"input_summary": {"file_path": "正文/第001章.md", "content_chars": 6},
                   "output_summary": {"issue_count": 1, "mode": "multi_agent"}},
            artifacts=[["review_report", {"issues": []}, False]])


def revise(requires_confirmation=True):
    patch = {**PATCH, "requires_confirmation": requires_confirmation}
    return ok({"proposed_patch": patch, "file_path": "正文/第001章.md", "summary": "改好了",
               "applied_scope": {"mode": "paragraph"}},
              trace={"input_summary": {"file_path": "正文/第001章.md"},
                     "output_summary": {"patch_id": "patch-1", "applied_scope": {"mode": "paragraph"}},
                     "audit_event_id": "audit-1"},
              artifacts=[["proposed_patch", patch, requires_confirmation]])


def scenario(name, model, tools=None, **options):
    return {"id": name, "model": model, "tools": tools or {}, "profile": options.pop("profile", "ask"),
            "source": options.pop("source", {}), "streaming": options.pop("streaming", False),
            "triggers": options.pop("triggers", []), "user_message": options.pop("user_message", "看看第一章"),
            "current_file": options.pop("current_file", "正文/第001章.md"), **options}


def scenarios():
    s = []
    s.append(scenario("text-only", [reply("第一章写得紧凑。", usage=U)]))
    s.append(scenario("markup-annotated", [reply('<tool_call>{"name":"fs_read"}</tool_call>', usage=U)]))
    s.append(scenario("read-then-answer", [
        reply("", [call("c1", "fs_read", '{"path":"正文/第001章.md"}')], usage=U),
        reply("读完了。", usage=[30, 4, 34, "provider_usage"])], {"fs.read": [READ]}))
    s.append(scenario("call-ids", [
        reply("", [call("", "fs_list"), call("", "fs_list", '{"path":"正文"}')], usage=U),
        reply("", [call("call_0", "fs_list"), call("call_0", "fs_list")]),
        reply("列完了。")], {"fs.list": [ok({"entries": [], "truncated": False})] * 4}))
    s.append(scenario("parallel-calls", [
        reply("", [call("c1", "fs_list"), call("c2", "fs_search", '{"query":"林舟"}')], usage=U),
        reply("找到了。", usage=U)],
        {"fs.list": [ok({"entries": [{"path": "正文"}], "truncated": False})],
         "fs.search": [ok({"matches": [{"path": "正文/第001章.md"}], "scanned_files": 3, "truncated": False})]}))
    s.append(scenario("review-revise-single-patch", [
        reply("", [call("c1", "file_review", '{"path":"正文/第001章.md"}')], usage=U),
        reply("", [call("c2", "file_revise", '{"path":"正文/第001章.md","instruction":"收紧节奏"}')], usage=U),
        reply("", [call("c3", "file_create", '{"path":"正文/第003章.md","instruction":"起草"}')], usage=U),
        reply("补丁等你确认。", usage=U)],
        {"file.review": [REVIEW], "file.revise": [revise()]}))
    s.append(scenario("two-patches-one-batch", [
        reply("", [call("c1", "file_revise", '{"path":"正文/第001章.md","instruction":"改"}'),
                   call("c2", "file_create", '{"path":"正文/第003章.md","instruction":"写"}')], usage=U),
        reply("先处理一个。")], {"file.revise": [revise(False)]}, profile="auto"))
    s.append(scenario("read-profile-denies-writer", [
        reply("", [call("c1", "file_revise", '{"path":"正文/第001章.md","instruction":"改"}')], usage=U),
        reply("只读档不能改。")], profile="read"))
    s.append(scenario("invalid-and-unknown", [
        reply("", [call("c1", "fs_read", "not json"), call("c2", "fs_read", '{"path":3}'),
                   call("c3", "nope_tool", '{"x":1}'), call("c4", "", "长" * 600)], usage=U),
        reply("参数不对。")]))
    s.append(scenario("tool-errors", [
        reply("", [call("c1", "fs_read", '{"path":"缺.md"}'), call("c2", "fs_search", '{"query":"x"}')], usage=U),
        reply("出错了。")],
        {"fs.read": [boom("FsToolError", "文件不存在：缺.md")], "fs.search": [boom("RuntimeError", "坏" * 600)]}))
    s.append(scenario("summary-only-and-handler-owned", [
        reply("", [call("c1", "project_promise_check"),
                   call("c2", "knowledge_propose", json.dumps({"proposals": [PROPOSAL]}, ensure_ascii=False))], usage=U),
        reply("检查完了。")],
        {"project.promise_check": [ok({"summary": "两条伏笔未回收", "promises": [1, 2]})],
         "knowledge.propose": [ok({"proposal_group_id": "kpg-1", "summary": "提议一条"},
                                  trace={"input_summary": {"proposal_count": 1},
                                         "output_summary": {"proposal_count": 1}, "audit_event_id": "kp-1"},
                                  artifacts=[["knowledge_proposal", {"proposals": []}, False]])]},
        profile="auto"))
    s.append(scenario("generation-delivery", [
        reply("", [call("c1", "prose_continue", '{"path":"正文/第001章.md","generation_delivery_refs":[1]}')],
              usage=U),
        reply("续写好了。")],
        {"prose.continue": [ok({"proposed_patch": {**PATCH, "kind": "prose_continue",
                                                   "created_by_tool": "prose.continue"},
                                "file_path": "正文/第001章.md", "summary": "续写 200 字"},
                               trace={"input_summary": {"file_path": "正文/第001章.md", "target_chars": 200},
                                      "output_summary": {"patch_id": "patch-1"}},
                               deliver=[[901, MANIFEST], [902, {**MANIFEST, "version": "v2"}]])]}))
    s.append(scenario("pause-before-round", [
        reply("", [call("c1", "fs_read", '{"path":"正文/第001章.md"}')], usage=U), reply("不该到这里")],
        {"fs.read": [READ]}, triggers=[{"boundary": "before_round:2", "nth": 1, "status": "paused",
                                         "current_step": "paused"}]))
    s.append(scenario("stop-during-tool", [
        reply("", [call("c1", "fs_read", '{"path":"正文/第001章.md"}'), call("c2", "fs_list")], usage=U)],
        {"fs.read": [{**READ, "set_status": ["stopped", "stopped"]}]}))
    s.append(scenario("tool-raises-interrupt", [
        reply("", [call("c1", "fs_read", '{"path":"正文/第001章.md"}')], usage=U)],
        {"fs.read": [boom("LLMRunInterrupted", "paused", set_status=["paused", "paused"])]}))
    s.append(scenario("tool-raises-interrupt-without-control", [
        reply("", [call("c1", "fs_read", '{"path":"正文/第001章.md"}')], usage=U), reply("工具没跑成。")],
        {"fs.read": [boom("LLMRunInterrupted", "paused")]}))
    s.append(scenario("stop-after-model", [reply("答到一半", usage=U, set_status=["stopped", "stopped"])]))
    s.append(scenario("deadline", [
        reply("", [call("c1", "fs_read", '{"path":"正文/第001章.md"}')], usage=U, advance=901)],
        {"fs.read": [READ]}))
    s.append(scenario("provider-error-with-usage", [
        reply("", [call("c1", "fs_read", '{"path":"正文/第001章.md"}')], usage=U),
        {"raise": {"type": "ProviderError", "category": "rate_limit", "message": "Provider rate limited.",
                   "usage": [40, 0, 40, "provider_usage"]}}], {"fs.read": [READ]}))
    s.append(scenario("provider-unsupported-first", [
        {"raise": {"type": "ProviderError", "category": "unsupported", "message": "Tools unsupported."}}]))
    s.append(scenario("provider-unsupported-later", [
        reply("", [call("c1", "fs_list")]),
        {"raise": {"type": "ProviderError", "category": "unsupported", "message": "Tools unsupported."}}],
        {"fs.list": [ok({"entries": [], "truncated": False})]}))
    s.append(scenario("llm-error", [{"raise": {"type": "LLMError", "message": "上游 500"}}]))
    s.append(scenario("generic-error", [{"raise": {"type": "ValueError", "message": "坏响应"}}]))
    s.append(scenario("missing-model", [], source={"STORYFORGE_LLM_MODEL": None}))
    s.append(scenario("builder-config-error", [], builder_error="缺少真实 LLM 生成环境变量：STORYFORGE_LLM_BASE_URL。"))
    s.append(scenario("truncated", [reply("写到一半", usage=U, finish="length")]))
    s.append(scenario("round-limit", [
        reply("", [call(f"c{i}", "fs_list")], usage=U) for i in range(1, 8)] + [
        reply("", [call("c8", "fs_list")])], {"fs.list": [ok({"entries": [], "truncated": False})] * 7}))
    s.append(scenario("final-round-answer", [
        reply("", [call(f"c{i}", "fs_list")]) for i in range(1, 8)] + [reply("最后一轮直接回答。")],
        {"fs.list": [ok({"entries": [], "truncated": False})] * 7}))
    s.append(scenario("streaming-text", [
        reply("", [call("c1", "fs_list")], usage=U, chunks=["<think>想</think>", "我先看"]),
        reply(f"看完了 {SECRET} 结束", usage=U, chunks=["看完", f"了 {SECRET[:6]}", f"{SECRET[6:]} 结束"])],
        {"fs.list": [ok({"entries": [], "truncated": False})]}, streaming=True))
    s.append(scenario("streaming-error", [
        {"raise": {"type": "ProviderError", "category": "rate_limit", "message": "Provider rate limited."},
         "chunks": ["半句"]}], streaming=True))
    s.append(scenario("cost-metadata-and-mixed", [
        reply("", [call("c1", "fs_list")], usage=[10, 2, 12, "estimated_split"],
              metadata={"cost_cny_estimated": 0.25, "cost_breakdown": {"total_cny": 0.25, "currency": "CNY"}}),
        reply("", [call("c2", "fs_list")], usage=U, metadata={"cost_cny_estimated": None}),
        reply("好。", usage=[3, 3, 6, "provider_usage"], metadata={"cost_breakdown": {"total_cny": -1}})],
        {"fs.list": [ok({"entries": [], "truncated": False})] * 2}))
    s.append(scenario("no-cost-rates", [reply("好。", usage=U)],
                      source={"STORYFORGE_LLM_INPUT_CNY_PER_M_TOKENS": None}))
    s.append(scenario("failed-run-keeps-patch-for-confirmation", [
        reply("", [call("c1", "file_revise", '{"path":"正文/第001章.md","instruction":"改"}')], usage=U),
        {"raise": {"type": "LLMError", "message": "断了"}}], {"file.revise": [revise(False)]}, profile="auto"))
    s.append(scenario("protected-arguments", [
        reply("", [call("c1", "fs_read", '{"path":"正文/第001章.md","confirmed":true,"user_confirmed":true}')]),
        reply("好。")], {"fs.read": [READ]}))
    big = {"result": {**READ["result"], "big": 30000}}
    s.append(scenario("output-budget", [
        reply("", [call("c1", "fs_read", '{"path":"正文/第001章.md"}'), call("c2", "fs_read", '{"path":"正文/第001章.md"}'),
                   call("c3", "fs_read", '{"path":"正文/第002章.md"}'), call("c4", "fs_list")], usage=U),
        reply("", [call("c5", "fs_list")]), reply("预算用完了。")], {"fs.read": [big, big, big]}))
    s.append(scenario("fs-read-directory", [
        reply("", [call("c1", "fs_read", '{"path":"正文"}')], usage=U), reply("那是目录。")],
        {"fs.read": [boom("FsToolError", "不是文件：正文")]}))
    return s


def p3_chat_loop_snapshot() -> dict:
    with isolated_fs_oracle("storyforge-golden-chat-loop-") as (api, run):
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker
        from sqlalchemy.pool import StaticPool

        from app.common.generation_delivery import record_generation_delivery
        from app.common.llm_client import LLMConfigError, LLMError
        from app.common.llm_control import LLMRunInterrupted
        from app.db.base import Base
        from app.domains.agent_runs import fs_tools, loop_runtime, text_stream
        from app.domains.agent_runs.loop.run_control import agent_run_control_scope, current_run_control
        from app.domains.agent_runs.models import AgentArtifact, AgentRun
        from app.domains.agent_runs.permission import PermissionGate
        from app.domains.agent_runs.runtime_recovery import build_runtime_interruption_payload
        from app.domains.agent_runs.tools import ToolArtifact, ToolResult, list_loop_tool_specs
        from app.domains.agent_runs.tools.execution import tool_definition_from_spec
        from app.domains.agent_runs.trace import AgentToolTrace
        from app.domains.assistant import service as assistant_service
        from app.domains.assistant.models import AssistantSession
        from app.platform.ai_sdk import ChatResponse, StreamEvent, TokenUsage, ToolCall
        from app.platform.ai_sdk.capabilities import ProviderCapabilities
        from app.platform.ai_sdk.contracts import StreamEventKind
        from app.platform.ai_sdk.errors import ProviderError, ProviderErrorCategory, ProviderErrorDetails

        project = Project(run, "book", FILES)
        root = str(project.root)
        clock = {"now": 1000.0}
        real_monotonic = time.monotonic
        time.monotonic = lambda: clock["now"]
        definitions = [tool_definition_from_spec(spec, lambda *_: None) for spec in list_loop_tool_specs()]
        ops: list[dict] = []
        real_create, real_update = assistant_service.create_assistant_tool_call, assistant_service.update_assistant_tool_call

        def create_tool_call(session, sid, payload):
            ops.append({"op": "create_tool_call", "session_id": sid, "tool_name": payload.tool_name,
                        "status": payload.status, "input_summary": payload.input_summary})
            return real_create(session, sid, payload)

        def update_tool_call(session, tool_call_id, payload):
            ops.append({"op": "update_tool_call", "id": tool_call_id, **payload.model_dump(exclude_unset=True)})
            return real_update(session, tool_call_id, payload)

        assistant_service.create_assistant_tool_call = create_tool_call
        assistant_service.update_assistant_tool_call = update_tool_call

        def usage(spec):
            return TokenUsage(input_tokens=spec[0], output_tokens=spec[1], total_tokens=spec[2], source=spec[3])

        def error(spec):
            kind = spec["type"]
            if kind == "ProviderError":
                return ProviderError(ProviderErrorDetails(ProviderErrorCategory(spec["category"]), spec["message"]),
                                     usage=usage(spec["usage"]) if spec.get("usage") else None)
            if kind == "LLMError":
                return LLMError(spec["message"])
            if kind == "LLMRunInterrupted":
                return LLMRunInterrupted(spec["message"])
            if kind == "FsToolError":
                return fs_tools.FsToolError(spec["message"])
            return {"RuntimeError": RuntimeError, "ValueError": ValueError}[kind](spec["message"])

        def compact(message):
            return _compact_content(stable(message.to_openai(), project.root))

        def run_scenario(spec):
            db = sessionmaker(bind=_engine(create_engine, StaticPool, Base), expire_on_commit=False,
                              autoflush=False)()
            assistant = AssistantSession(title="会话", task_type="ide_agent_orchestration", project_path=root)
            db.add(assistant)
            db.commit()
            row = AgentRun(public_id="run-1", session_id="sess-1", assistant_session_id=assistant.id,
                           goal="g", scope={}, permission_profile=spec["profile"], budget={}, status="running",
                           root_plan=[], current_step=None)
            db.add(row)
            db.commit()
            clock["now"] = 1000.0
            ops.clear()
            requests, checks, traces, frames, tool_calls = [], [], [], [], []
            streams = iter(range(1, 100))
            text_stream.uuid4 = lambda: f"stream-{next(streams)}"
            model_steps = list(spec["model"])
            tool_steps = {name: list(items) for name, items in spec["tools"].items()}
            trigger_counts = [0] * len(spec["triggers"])

            def set_status(status, step):
                row.status, row.current_step = status, step
                db.add(row)
                db.commit()

            def effects(step):
                if step.get("set_status"):
                    set_status(*step["set_status"])
                clock["now"] += step.get("advance", 0)

            def should_interrupt(boundary):
                checks.append(boundary)
                for index, trigger in enumerate(spec["triggers"]):
                    if trigger["boundary"] == boundary:
                        trigger_counts[index] += 1
                        if trigger_counts[index] == trigger["nth"]:
                            set_status(trigger["status"], trigger["current_step"])
                db.refresh(row)
                return build_runtime_interruption_payload(row, boundary=boundary)

            class Scripted:
                def __init__(self):
                    self.streaming = spec["streaming"]

                def capabilities(self, model):
                    return ProviderCapabilities(streaming=self.streaming)

                def _take(self, request, streaming):
                    requests.append({"streaming": streaming, "model": request.model,
                                     "messages": [compact(m) for m in request.messages],
                                     "tools": [t.name for t in request.tools],
                                     "tools_sha256": hashlib.sha256(json.dumps(
                                         [t.to_openai() for t in request.tools], ensure_ascii=False, sort_keys=True,
                                         separators=(",", ":")).encode()).hexdigest(),
                                     "temperature": request.temperature, "max_tokens": request.max_tokens,
                                     "tool_choice": request.tool_choice, "reasoning_effort": request.reasoning_effort})
                    step = model_steps.pop(0)
                    effects(step)
                    return step

                def _response(self, step):
                    return ChatResponse(
                        content=step["content"],
                        tool_calls=tuple(ToolCall(i, n, a) for i, n, a in step["calls"]),
                        usage=usage(step["usage"]) if step.get("usage") else TokenUsage(),
                        finish_reason=step["finish"], metadata=step.get("metadata", {}))

                def complete(self, request):
                    step = self._take(request, False)
                    if "raise" in step:
                        raise error(step["raise"])
                    return self._response(step)

                def stream(self, request):
                    step = self._take(request, True)
                    for chunk in step.get("chunks", []):
                        yield StreamEvent(StreamEventKind.TEXT_DELTA, text=chunk)
                    if "raise" in step:
                        raise error(step["raise"])
                    response = self._response(step)
                    yield StreamEvent(StreamEventKind.COMPLETED, response=response, usage=response.usage)

            def build(source):
                if spec.get("builder_error"):
                    raise LLMConfigError(spec["builder_error"])
                return Scripted()

            loop_runtime.build_llm_provider = build

            def execute_fs_tool(registry_name, arguments):
                tool_calls.append({"registry_name": registry_name, "arguments": arguments})
                step = tool_steps[registry_name].pop(0)
                effects(step)
                for tool_call_id, manifest in step.get("deliver", []):
                    record_generation_delivery(tool_call_id, manifest)
                if "raise" in step:
                    raise error(step["raise"])
                result = step["result"]
                trace = result["trace"]
                output = {**result["output"], "content": "长" * result["big"]} if result.get("big") else result["output"]
                return ToolResult(
                    status=result["status"], output=output,
                    trace=AgentToolTrace(tool_name=registry_name, status="completed",
                                         input_summary=trace.get("input_summary", {}),
                                         output_summary=trace.get("output_summary"),
                                         audit_event_id=trace.get("audit_event_id")),
                    artifacts=tuple(ToolArtifact(kind, payload, flag) for kind, payload, flag in result["artifacts"]))

            source = {key: value for key, value in {**SOURCE, **spec["source"]}.items() if value is not None}
            record: dict = {"id": spec["id"], "spec_json": json.dumps(spec, ensure_ascii=False)}
            with agent_run_control_scope(should_interrupt):
                owner = current_run_control()
                try:
                    outcome = loop_runtime.run_chat_loop(
                        db, run=row, permission_gate=PermissionGate(), tool_definitions=definitions, llm_env=source,
                        assistant_session_id=assistant.id, user_message=spec["user_message"], project_path=root,
                        current_file=str(project.root / spec["current_file"]) if spec["current_file"] else None,
                        execute_fs_tool=execute_fs_tool,
                        on_trace=lambda trace: traces.append(trace.as_dict()),
                        on_text=(lambda frame: frames.append(frame.model_dump())) if spec["streaming"] else None,
                        should_interrupt=should_interrupt)
                except (loop_runtime.ChatLoopUnavailableError, LLMError, LLMConfigError, ValueError,
                        RuntimeError) as exc:
                    record["error"] = {"type": type(exc).__name__, "message": str(exc)}
                else:
                    record["outcome"] = _outcome(outcome)
                record["owner_interruption"] = owner.interruption
            checkpoints = [a.payload for a in db.query(AgentArtifact).filter(
                AgentArtifact.kind == "runtime_checkpoint").order_by(AgentArtifact.id)]
            assert all(item["redacted"] is False for item in checkpoints), spec["id"]
            record.update(
                requests=requests, checks=checks, assistant_ops=ops[:], traces=traces, text_frames=frames,
                tool_calls=tool_calls, unused_model_steps=len(model_steps),
                unused_tool_steps={name: len(items) for name, items in tool_steps.items() if items},
                checkpoints=[_checkpoint_digest(stable(item, project.root)) for item in checkpoints],
                final_checkpoint=_checkpoint_view(stable(checkpoints[-1], project.root)) if checkpoints else None,
                run={"status": row.status, "current_step": row.current_step},
            )
            db.close()
            return stable(record, project.root)

        scenarios_out = [run_scenario(spec) for spec in scenarios()]
        time.monotonic = real_monotonic
        assistant_service.create_assistant_tool_call = real_create
        assistant_service.update_assistant_tool_call = real_update
        return {
            "format_version": 1,
            "suite": "p3-chat-loop",
            "secret": SECRET,
            "source": SOURCE,
            "files": FILES,
            "sources": {path: hashlib.sha256((api / path).read_bytes()).hexdigest() for path in SOURCES},
            "platform": "windows" if os.name == "nt" else "posix",
            "synthetic_root": r"D:\synthetic-book" if os.name == "nt" else "/tmp/synthetic-book",
            "scenarios": scenarios_out,
        }


def _engine(create_engine, pool, base):
    engine = create_engine("sqlite://", poolclass=pool, connect_args={"check_same_thread": False})
    base.metadata.create_all(engine)
    return engine


def _outcome(outcome) -> dict:
    return {
        "answer": outcome.answer, "rounds": outcome.rounds, "tool_call_count": outcome.tool_call_count,
        "completion_tokens": outcome.completion_tokens, "prompt_tokens": outcome.prompt_tokens,
        "token_usage": outcome.token_usage, "token_usage_source": outcome.token_usage_source,
        "cost_cny_estimated": outcome.cost_cny_estimated, "cost_breakdown": outcome.cost_breakdown,
        "exhausted": outcome.exhausted,
        "execution_outcome": outcome.execution_outcome.model_dump() if outcome.execution_outcome else None,
        "review_report": outcome.review_report, "proposed_patch": outcome.proposed_patch,
        "interrupted": outcome.interrupted, "interruption": outcome.interruption,
        "artifacts": [{"kind": a.kind, "payload": a.payload, "requires_confirmation": a.requires_confirmation}
                      for a in outcome.artifacts],
        "traces": [t.as_dict() for t in outcome.traces],
    }


def _ints(value):
    """Integral floats compare as ints: TS numbers do not keep Python's 2 / 2.0 type split for costs."""
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, dict):
        return {key: _ints(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_ints(item) for item in value]
    return value


def _canonical(value) -> str:
    return json.dumps(_ints(value), ensure_ascii=False, sort_keys=True)


def _sdk_checkpoint(payload: dict) -> dict:
    checkpoint = dict(payload["checkpoint"])
    assert checkpoint.pop("external_operation_id") is None
    return checkpoint


def _checkpoint_digest(payload: dict) -> dict:
    checkpoint = _sdk_checkpoint(payload)
    return {"phase": checkpoint["phase"], "round_count": checkpoint["round_count"],
            "sequence": checkpoint["sequence"], "dispatch_state": payload["dispatch_state"],
            "checkpoint_sha256": hashlib.sha256(_canonical(checkpoint).encode()).hexdigest(),
            "outcome_sha256": hashlib.sha256(_canonical(payload["outcome"]).encode()).hexdigest()}


def _compact_content(message: dict) -> dict:
    content = message.get("content")
    if isinstance(content, str) and len(content) > 300:
        return {**message, "content": {"sha256": hashlib.sha256(content.encode()).hexdigest(), "length": len(content)}}
    return message


def _checkpoint_view(payload: dict) -> dict:
    checkpoint = _sdk_checkpoint(payload)
    checkpoint["messages"] = [_compact_content(message) for message in checkpoint["messages"]]
    return {"checkpoint": checkpoint, "outcome": payload["outcome"],
            "dispatch_state": payload["dispatch_state"], "permission_profile": payload["permission_profile"],
            "assistant_session_id": payload["assistant_session_id"], "resume_message": payload["resume_message"]}
