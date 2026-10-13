"""Model request evidence + hidden system jobs oracle (P3-5b2a).

Real `request_evidence` (snapshots, route origin, the agent request observer) behind the real
`observe_provider` on in-memory sqlite: a scripted base provider completes, streams, fails, reports transport
progress and loses its evidence commits. Plus the deterministic hidden title / summary / compaction job plans and
the compaction job wrapper (`prepare_conversation_compaction`) with a scripted provider quoting every source.
"""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import replace

import prometheus_client  # noqa: F401 - imported before the audit hook: its process collector probes /proc
from golden_fs import isolated_fs_oracle

SECRET = "sk-oracle-secret-123456"
SOURCES = [
    "app/domains/agent_runs/request_evidence.py",
    "app/common/llm_observation.py",
    "app/domains/agent_runs/system_jobs.py",
    "app/domains/agent_runs/compaction_job.py",
]
SOURCE_KEY = "plain-source-key-abc"
SOURCE_TOKEN = "plain-source-token-xyz"
SOURCE = {"STORYFORGE_LLM_PROVIDER": "openai", "STORYFORGE_LLM_MODEL": "m-1", "STORYFORGE_LLM_API_KEY": SOURCE_KEY,
          "STORYFORGE_LLM_AUTH_TOKEN": SOURCE_TOKEN,
          "STORYFORGE_LLM_BASE_URL": "https://LLM.Example:8443/v1/chat?x=1",
          "STORYFORGE_LLM_INPUT_CNY_PER_M_TOKENS": "2", "STORYFORGE_LLM_OUTPUT_CNY_PER_M_TOKENS": "8"}
TOOL = {"type": "function", "function": {"name": "fs_read", "description": "读文件",
                                         "parameters": {"type": "object", "properties": {"path": {"type": "string"}}}}}
BASE_MESSAGES = [{"role": "system", "content": "你是写作助手。"}, {"role": "user", "content": "看看第一章😀"}]
TOOL_ROUND = [*BASE_MESSAGES,
              {"role": "assistant", "content": None,
               "tool_calls": [{"id": "c1", "type": "function", "function": {"name": "fs_read",
                                                                             "arguments": '{"path":"a.md"}'}}]},
              {"role": "tool", "content": '{"content": "林舟"}', "tool_call_id": "c1", "name": "fs_read"}]


def request(messages=BASE_MESSAGES, tools=(), temperature=0.7, max_tokens=None, tool_choice=None,
            reasoning_effort=None, metadata=None, model="m-1", continuation_at=None):
    return {"model": model, "messages": list(messages), "tools": list(tools), "temperature": temperature,
            "max_tokens": max_tokens, "tool_choice": tool_choice, "reasoning_effort": reasoning_effort,
            "metadata": metadata or {}, "continuation_at": continuation_at}


U = [12, 5, 17, "provider_usage"]
PROGRESS = [{"phase": "request_started", "request_number": 1, "timeout_seconds": 60.0, "url": "x"},
            {"phase": "retry_wait", "request_number": 1, "delay_seconds": 1.5},
            {"phase": "retry_started", "request_number": 2}, {"phase": "other", "request_number": 2}]


def observer_steps():
    s = []
    s.append({"op": "complete", "operation": "agent.loop", "request": request(TOOL_ROUND, tools=[TOOL]),
              "provenance": {"projection_version": 1, "assistant_session_id": 9,
                             "sections": [{"section": "system_prompt", "sha256": "a" * 64}],
                             "continuation": {"x": 1}, "nested": [{"thought_signature": "s"}],
                             "note": f"含 {SECRET}", "api_key": "v", f"key-{SOURCE_KEY}": 1,
                             "note2": f"源 {SOURCE_KEY} / {SOURCE_TOKEN}"},
              "reply": {"content": "好", "usage": U, "finish": "stop"}, "progress": PROGRESS})
    s.append({"op": "complete", "request": request(), "reply": {"content": "截", "usage": U, "finish": "length"}})
    s.append({"op": "complete", "request": request(temperature=None, max_tokens=8192, tool_choice="auto",
                                                   reasoning_effort="high"),
              "raise": {"type": "ProviderError", "category": "rate_limit", "message": "限流", "usage": U}})
    s.append({"op": "complete", "request": request(), "raise": {"type": "LLMRunInterrupted", "message": "paused"}})
    s.append({"op": "complete", "request": request(), "raise": {"type": "RuntimeError", "message": "坏"}})
    s.append({"op": "set_run", "current_step": "agent.loop", "assistant_session_id": None})
    s.append({"op": "stream", "operation": "agent.loop", "provenance": {"assistant_session_id": 3},
              "request": request(), "progress": PROGRESS[:2],
              "events": [{"text": "好"}, {"usage": [5, 1, 6, "provider_usage"]},
                         {"completed": {"content": "好", "usage": U, "finish": "stop"}}]})
    s.append({"op": "stream", "request": request(),
              "events": [{"text": "半"}, {"usage": [5, 1, 6, "provider_usage"]},
                         {"raise": {"type": "ProviderError", "category": "connection", "message": "断"}}]})
    s.append({"op": "stream", "request": request(),
              "events": [{"usage": [5, 1, 6, "provider_usage"]},
                         {"completed": {"content": "好", "usage": U, "finish": "stop"}, "no_event_usage": True}]})
    s.append({"op": "stream", "request": request(
        [{"role": "user", "content": f"带源密钥 {SOURCE_KEY} 与 {SOURCE_TOKEN}"}]),
              "events": [{"usage": [5, 1, 6, "provider_usage"]},
                         {"raise": {"type": "ProviderError", "category": "connection", "message": "断",
                                    "usage": [30, 2, 32, "provider_usage"]}}]})
    s.append({"op": "stream", "request": request(), "events": [{"text": "半"}]})
    s.append({"op": "stream", "request": request(), "events": [{"text": "半"}, {"text": "截"}], "consumer_breaks": 1})
    s.append({"op": "stream", "request": request(),
              "events": [{"completed": {"content": "好", "usage": U, "finish": "content_filter"}},
                         {"raise": {"type": "RuntimeError", "message": "收尾后报错"}}]})
    s.append({"op": "complete", "request": request(), "progress": [PROGRESS[0]] * 130,
              "reply": {"content": "多次重试", "usage": U, "finish": "stop"}})
    s.append({"op": "complete", "request": request([{"role": "user", "content_repeat": ["长", 700_000]}]),
              "reply": {"content": "", "usage": U, "finish": "stop"}})
    s.append({"op": "complete", "operation": "agent.loop", "provenance": {"blob_repeat": ["长", 700_000]},
              "request": request(), "reply": {"content": "", "usage": U, "finish": "stop"}})
    s.append({"op": "complete", "request": request(), "fail_commit": "begin",
              "reply": {"content": "", "usage": U, "finish": "stop"}})
    s.append({"op": "complete", "request": request(), "fail_commit": "finish",
              "reply": {"content": "好", "usage": U, "finish": "stop"}})
    s.append({"op": "complete", "request": request(), "scope": False,
              "reply": {"content": "范围外", "usage": U, "finish": "stop"}})
    s.append({"op": "complete", "request": request(
        [{"role": "system", "content": f"密钥 {SECRET}"}, {"role": "user", "content": "Bearer abcdefghijklmnop", "extra": 1}],
        metadata={"operation": "conversation.compact", "prompt_version": 2, "flag": True, "other": "x"},
        continuation_at=1), "reply": {"content": "", "usage": U, "finish": "stop"}})
    s.append({"op": "complete", "request": request(metadata={"operation": "x", "prompt_version": True}),
              "reply": {"content": "", "usage": U, "finish": "stop"}})
    return s


ROUTES = ["https://LLM.Example:8443/v1/chat?x=1", "http://127.0.0.1/v1", "https://[::1]:9000/v1", "ftp://x/y",
          "https://user:pw@host.example/x", "https://host:0/x", "https://host:99999/x", "https://host:08/x",
          "https://host:a/x", "", "not a url", "https://[bad/x", "HTTPS://Host.Example", "https://host.example:443"]


def title_cases():
    return ["@林舟 请帮我 审一下 当前章节的结构人物和节奏！", "帮我把第三章改紧凑一点。", "  ", "《夜行》、写？", "我想",
            "请你" + "长句" * 20, "😀😀 emoji 标题测试", "IDE Agent: x", "把当前段落\u3000缩短", "a\u2028b@x\tc"]


def system_job_cases():
    messages = [{"id": 1, "role": "user", "content": "  "}, {"id": 2, "role": "user", "content": "帮我审第一章 节奏"},
                {"id": 3, "role": "assistant", "content": "好的" + " 句子" * 400},
                {"id": 4, "role": "user", "content": "再看\n\n看第二章"}]
    result = {"user_message": "  原话  ", "intent": "chat.explain", "tool_trace": [{}, {}],
              "agent_result": {"summary": "  完成了\n审稿  ", "review_report": {"issues": [1, 2, 3]},
                               "confirmation_required": True}}
    completed = {"kind": "system_compaction", "status": "completed", "assistant_session_id": 5, "summary": "已压缩",
                 "covered_through_message_id": 9, "message_count": 14, "compacted_message_count": 10,
                 "retained_message_count": 4, "entries": [], "checkpoint_digest": "d"}
    failed = {"status": "failed", "assistant_session_id": 5, "code": "compaction_rejected", "message_count": 14,
              "compacted_message_count": 10, "retained_message_count": 4}
    return [
        {"title": "新的创作会话", "messages": messages, "result": result, "compaction": None},
        {"title": "我的会话", "messages": [], "result": {"user_message": "  "}, "compaction": completed},
        {"title": "", "messages": messages[:1], "result": {"user_message": "从结果起名"}, "compaction": failed},
        {"title": "IDE Agent: 旧标题", "messages": [], "result": {"agent_result": "坏"}, "compaction": None},
    ]


def compaction_cases():
    long_history = [["user" if i % 2 == 0 else "assistant", f"第{i}条消息" + "。" * 20] for i in range(14)]
    return [
        {"id": "under-threshold", "messages": long_history[:6], "mode": "ok"},
        {"id": "under-threshold-missing-model", "messages": long_history[:6], "mode": "ok",
         "source": {"STORYFORGE_LLM_MODEL": None}},
        {"id": "interrupted-after-response", "messages": long_history, "mode": "ok",
         "interrupt_at": "after_compaction_provider"},
        {"id": "with-parent", "messages": long_history, "mode": "ok",
         "more": [["user" if i % 2 == 0 else "assistant", f"第{i}条补充" + "。" * 20] for i in range(6)]},
        {"id": "published", "messages": long_history, "mode": "ok", "tool_calls": [["fs.read", {"path": "a.md"}]]},
        {"id": "llm-error", "messages": long_history, "mode": "LLMError"},
        {"id": "provider-error", "messages": long_history, "mode": "ProviderError"},
        {"id": "bad-json", "messages": long_history, "mode": "bad_json"},
        {"id": "interrupted", "messages": long_history, "mode": "LLMRunInterrupted"},
        {"id": "missing-model", "messages": long_history, "mode": "ok", "source": {"STORYFORGE_LLM_MODEL": None}},
        {"id": "budget", "messages": [["user", ["长", 100_000]], ["assistant", "好"]] * 3, "mode": "ok"},
        {"id": "length-finish", "messages": long_history, "mode": "length"},
    ]


def p3_run_evidence_snapshot() -> dict:
    with isolated_fs_oracle("storyforge-golden-run-evidence-") as (api, _run):
        os.environ["STORYFORGE_LLM_API_KEY"] = SECRET
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker
        from sqlalchemy.pool import StaticPool

        from app.common import llm_observation
        from app.common.llm_client import LLMError
        from app.common.llm_control import LLMRunControl, LLMRunInterrupted, llm_run_control
        from app.db.base import Base
        from app.domains.agent_runs import compaction_job, request_evidence, system_jobs
        from app.domains.agent_runs.models import AgentArtifact, AgentRun
        from app.domains.assistant import service as assistant_service
        from app.domains.assistant.models import AssistantMessage, AssistantSession, AssistantToolCall
        from app.platform.ai_sdk import ChatMessage, ChatRequest, ChatResponse, StreamEvent, TokenUsage
        from app.platform.ai_sdk.contracts import ProviderContinuation, StreamEventKind, tools_from_openai
        from app.platform.ai_sdk.errors import ProviderError, ProviderErrorCategory, ProviderErrorDetails

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
            return RuntimeError(spec["message"])

        def expand(item):
            if isinstance(item, dict):
                return {key.removesuffix("_repeat"): item[key][0] * item[key][1] if key.endswith("_repeat")
                        else expand(value) for key, value in item.items()}
            return item

        def build_request(spec):
            messages = [ChatMessage.from_openai(expand(item)) for item in spec["messages"]]
            if spec["continuation_at"] is not None:
                index = spec["continuation_at"]
                messages[index] = replace(messages[index], continuation=ProviderContinuation("p", {"sig": "s"}))
            return ChatRequest(model=spec["model"], messages=tuple(messages), tools=tools_from_openai(spec["tools"]),
                               temperature=spec["temperature"], max_tokens=spec["max_tokens"],
                               tool_choice=spec["tool_choice"], reasoning_effort=spec["reasoning_effort"],
                               metadata=spec["metadata"])

        def response(spec):
            return ChatResponse(content=spec["content"], usage=usage(spec["usage"]), finish_reason=spec["finish"])

        def outcome(run_fn):
            try:
                value = run_fn()
            except Exception as exc:  # noqa: BLE001 - the oracle records every failure shape
                carried = getattr(exc, "usage", None)
                return {"error": {"type": type(exc).__name__, "message": str(exc),
                                  "usage": carried.to_legacy() if isinstance(carried, TokenUsage) else None}}
            return {"output": value}

        engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
        Base.metadata.create_all(engine)
        db = sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)()
        attempts = iter(range(1, 1000))
        request_evidence.uuid4 = lambda: f"attempt-{next(attempts)}"

        snapshots = [outcome(lambda spec=spec: request_evidence.request_snapshot(build_request(spec), SOURCE))
                     for spec in (request(TOOL_ROUND, tools=[TOOL]), request(metadata={"operation": "o"}))]
        routes = [request_evidence._route_origin({"STORYFORGE_LLM_BASE_URL": url}) for url in ROUTES]
        routes.append(request_evidence._route_origin({"STORYFORGE_LLM_API_BASE_URL": "https://fallback.example/x"}))

        db.add(AssistantSession(title="会话", task_type="t", project_path=None))
        db.commit()
        run = AgentRun(public_id="run-e", session_id="sess-e", assistant_session_id=1, goal="g", scope={},
                       permission_profile="ask", budget={}, status="running", root_plan=[], current_step="started")
        db.add(run)
        db.commit()
        real_commit = db.commit
        fail = {"at": None, "count": 0}

        def guarded_commit():
            fail["count"] += 1
            if fail["at"] == fail["count"]:
                raise RuntimeError("disk full")
            real_commit()

        db.commit = guarded_commit

        class Scripted:
            def __init__(self, step):
                self.step = step

            def capabilities(self, model):
                return None

            def complete(self, chat_request):
                for values in self.step.get("progress", []):
                    llm_observation.observe_http_progress(values)
                if "raise" in self.step:
                    raise error(self.step["raise"])
                return response(self.step["reply"])

            def stream(self, chat_request):
                for values in self.step.get("progress", []):
                    llm_observation.observe_http_progress(values)
                for event in self.step["events"]:
                    if "raise" in event:
                        raise error(event["raise"])
                    if "text" in event:
                        yield StreamEvent(StreamEventKind.TEXT_DELTA, text=event["text"])
                    elif "usage" in event:
                        yield StreamEvent(StreamEventKind.USAGE, usage=usage(event["usage"]))
                    else:
                        final = response(event["completed"])
                        yield StreamEvent(StreamEventKind.COMPLETED, response=final,
                                          usage=None if event.get("no_event_usage") else final.usage)

        seen = {"artifact": 0}

        def artifact_rows():
            # Only rows created by this step: every later step leaves earlier rows untouched.
            db.expire_all()
            rows = db.query(AgentArtifact).filter(AgentArtifact.id > seen["artifact"]).order_by(AgentArtifact.id).all()
            if rows:
                seen["artifact"] = rows[-1].id
            return [{"id": row.id, "kind": row.kind, "payload": row.payload} for row in rows]

        steps = []
        for written in observer_steps():
            step = json.loads(json.dumps(written))
            if step["op"] == "set_run":
                run.current_step, run.assistant_session_id = step["current_step"], step["assistant_session_id"]
                db.add(run)
                real_commit()
                steps.append({"step_json": json.dumps(written, ensure_ascii=False), "artifacts": artifact_rows()})
                continue
            provider = llm_observation.observe_provider(Scripted(step), SOURCE)
            chat_request = build_request(step["request"])
            fail["count"] = 0
            fail["at"] = {"begin": 1, "finish": 2}.get(step.get("fail_commit"))

            def call(step=step, provider=provider, chat_request=chat_request):
                if step["op"] == "complete":
                    return provider.complete(chat_request).content
                received = []
                stream = provider.stream(chat_request)
                for event in stream:
                    received.append(event.kind.value)
                    if step.get("consumer_breaks") == len(received):
                        stream.close()
                        break
                return received

            def scoped(call=call, step=step):
                if step.get("operation"):
                    with llm_observation.model_operation(step["operation"], provenance=expand(step.get("provenance"))):
                        return call()
                return call()

            if step.get("scope", True):
                with request_evidence.agent_request_evidence_scope(db, run):
                    result = outcome(scoped)
            else:
                result = outcome(scoped)
            fail["at"] = None
            db.rollback()
            steps.append({"step_json": json.dumps(written, ensure_ascii=False), "result": result,
                          "artifacts": artifact_rows()})
        db.commit = real_commit

        titles = [{"text": text, "title": system_jobs._derive_title(text)} for text in title_cases()]

        class Message:
            def __init__(self, row):
                self.id, self.role, self.content = row["id"], row["role"], row["content"]

        jobs = []
        for case in system_job_cases():
            plans = system_jobs.build_conversation_system_jobs(
                assistant_session_id=5, current_title=case["title"], messages=[Message(m) for m in case["messages"]],
                result=case["result"], compaction_payload=case["compaction"])
            jobs.append({"case_json": json.dumps(case, ensure_ascii=False),
                         "plans": [{"key": p.key, "event_payload": p.event_payload, "result_payload": p.result_payload,
                                    "artifact_kind": p.artifact_kind, "artifact_payload": p.artifact_payload}
                                   for p in plans]})

        compactions = []
        for case in compaction_cases():
            local = sessionmaker(bind=_fresh(create_engine, StaticPool, Base), expire_on_commit=False,
                                 autoflush=False)()
            conversation = AssistantSession(title="会话", task_type="t", project_path=None)
            local.add(conversation)
            local.commit()
            for role, content in case["messages"]:
                text = content[0] * content[1] if isinstance(content, list) else content
                local.add(AssistantMessage(session_id=conversation.id, role=role, content=text))
            for name, summary in case.get("tool_calls", []):
                local.add(AssistantToolCall(session_id=conversation.id, tool_name=name, status="completed",
                                            input_summary=summary, output_summary={}))
            evidence_run = AgentRun(public_id="run-c", session_id="sess-c", assistant_session_id=None, goal="g",
                                    scope={}, permission_profile="ask", budget={}, status="running", root_plan=[],
                                    current_step="agent.loop")
            local.add(evidence_run)
            local.commit()
            mode = case["mode"]
            case_attempts = iter(range(1, 100))
            request_evidence.uuid4 = lambda case_attempts=case_attempts: f"attempt-{next(case_attempts)}"

            class CompactionProvider:
                def complete(self, chat_request, mode=mode):
                    if mode in {"LLMError", "ProviderError", "LLMRunInterrupted"}:
                        raise error({"type": mode, "message": "paused" if mode == "LLMRunInterrupted" else "压缩失败",
                                     "category": "timeout", "usage": U})
                    if mode == "bad_json":
                        return ChatResponse(content="不是 JSON", usage=usage(U), finish_reason="stop")
                    model_input = json.loads(chat_request.messages[1].content)
                    entries = [{"category": "decision", "text": f"摘要 {source['key']}", "source_id": source["key"],
                                "quote": source["content"][:10]} for source in model_input["new_sources"]]
                    return ChatResponse(content=json.dumps({"entries": entries}, ensure_ascii=False),
                                        usage=usage(U), finish_reason="length" if mode == "length" else "stop")

            source = {key: value for key, value in {**SOURCE, **case.get("source", {})}.items() if value is not None}
            compaction_job.build_llm_provider = lambda _source: llm_observation.observe_provider(
                CompactionProvider(), _source)
            assistant_service.resolved_llm_env = lambda source=source: source

            def compact(local=local, conversation=conversation, evidence_run=evidence_run, case=case):
                interrupt_at = case.get("interrupt_at")
                control = LLMRunControl(lambda boundary: "paused" if boundary == interrupt_at else None)
                with request_evidence.agent_request_evidence_scope(local, evidence_run), llm_run_control(control):
                    return outcome(lambda: compaction_job.prepare_conversation_compaction(local, conversation.id))

            if case.get("more"):
                # A published parent checkpoint lives on a run of this conversation; new messages follow it.
                session_run = AgentRun(public_id="run-s", session_id="sess-s", assistant_session_id=conversation.id,
                                       goal="g", scope={}, permission_profile="ask", budget={}, status="completed",
                                       root_plan=[], current_step=None)
                local.add(session_run)
                local.commit()
                parent = compact()["output"]
                local.add(AgentArtifact(run_id=session_run.id, kind="system_compaction", payload=parent,
                                        requires_confirmation=False))
                for role, content in case["more"]:
                    local.add(AssistantMessage(session_id=conversation.id, role=role, content=content))
                local.commit()
            result = compact()
            local.expire_all()
            compactions.append({
                "id": case["id"], "case_json": json.dumps(case, ensure_ascii=False), "result": result,
                "message_ids": [m.id for m in local.query(AssistantMessage).order_by(AssistantMessage.id)],
                "tool_calls": [{"id": c.id, "tool_name": c.tool_name, "status": c.status,
                                "input_summary": c.input_summary, "output_summary": c.output_summary}
                               for c in local.query(AssistantToolCall).order_by(AssistantToolCall.id)],
                "artifacts": [{"id": a.id, "kind": a.kind, "payload": a.payload}
                              for a in local.query(AgentArtifact).order_by(AgentArtifact.id)],
            })
            local.close()
        return {
            "format_version": 1,
            "suite": "p3-run-evidence",
            "secret": SECRET,
            "source": SOURCE,
            "sources": {path: hashlib.sha256((api / path).read_bytes()).hexdigest() for path in SOURCES},
            "snapshots": snapshots,
            "routes": [{"url": url, "origin": origin} for url, origin in zip([*ROUTES, "api-base"], routes, strict=True)],
            "observer_steps": steps,
            "titles": titles,
            "system_jobs": jobs,
            "compactions": compactions,
        }


def _fresh(create_engine, pool, base):
    engine = create_engine("sqlite://", poolclass=pool, connect_args={"check_same_thread": False})
    base.metadata.create_all(engine)
    return engine
