"""Real assistant use-case oracle: revise / continue (SSE frames) / draft / chat / provider health,
run through the actual service functions on a synthetic project. The session store and the model are
the service's own seams, replaced by an in-memory recorder and scripted replies (no DB, no network)."""

from __future__ import annotations

import hashlib
import json
import os
from types import SimpleNamespace

from golden_canon_chain import CANON, CHAPTERS, HOOKS, _dumps
from golden_fs import Project, isolated_fs_oracle, stable

SYNTHETIC_ROOT = r"D:\synthetic-book"
SOURCES = [
    "app/domains/assistant/provider_health.py",
    "app/domains/assistant/service.py",
    "app/domains/assistant/session_scope.py",
]
SOURCE = {
    "STORYFORGE_LLM_PROVIDER": "openai",
    "STORYFORGE_LLM_BASE_URL": "https://llm.example/v1",
    "STORYFORGE_LLM_API_KEY": "sk-test-secret-123456",
    "STORYFORGE_LLM_MODEL": "deepseek-v4",
}
USAGE = {"prompt_tokens": 120, "completion_tokens": 40, "token_usage": 160, "token_usage_source": "provider",
         "cost_cny_estimated": 0.001, "cost_breakdown": {"total_cny": 0.001}, "latency_ms": 321.9}
ANCHORED = "改得紧凑些\n<<<ANCHOR\n他回头。\nANCHOR>>>"


def p2_assistant_service_snapshot() -> dict:
    with isolated_fs_oracle("assistant-service-oracle-") as (api, run):
        from urllib import error as urlerror

        from app.common.exceptions import DomainError
        from app.common.generation_sources import GenerationSourceCapture, text_sha256
        from app.common.llm_client import LLMConfigError, LLMError
        from app.common.llm_config_file import LlmConfigError as LlmConfigFileError
        from app.common.llm_control import LLMRunInterrupted
        from app.common.llm_env import missing_llm_env as real_missing
        from app.domains.assistant import provider_health
        from app.domains.assistant import service as svc
        from app.domains.assistant.schemas import (
            AssistantContinueRequest,
            AssistantDraftRequest,
            AssistantReviseRequest,
        )
        from app.platform.ai_sdk.contracts import TokenUsage

        files = {
            **CHAPTERS,
            ".storyforge/canon/canon.json": _dumps(CANON),
            ".storyforge/canon/hooks.json": _dumps(HOOKS),
            ".storyforge/agent-instructions.md": "少用「仿佛」。",
            "人物/林舟.md": "林舟会游泳。\n",
            "正文/第004章.md": "他回头。\n\n雨夜里他推开门。\n",
        }
        p = Project(run, "book", files)
        root = str(p.root)

        class PinnedCapture(GenerationSourceCapture):
            def __init__(self, *args, **kwargs):
                super().__init__(*args, **kwargs)
                if self.project_identity_sha256 is not None:
                    self.project_identity_sha256 = text_sha256(os.path.normcase(SYNTHETIC_ROOT))

        svc.GenerationSourceCapture = PinnedCapture

        state = {}

        def fresh_store():
            state["log"] = []
            state["sessions"] = {1: SimpleNamespace(id=1, project_path=root), 2: SimpleNamespace(id=2, project_path=None),
                                 3: SimpleNamespace(id=3, project_path=r"D:\other-book")}
            state["tool_calls"] = {}
            state["next_session"] = 10
            state["next_tool"] = 100

        def lookup(session_id):
            found = state["sessions"].get(session_id)
            if found is None:
                raise svc.AssistantSessionNotFoundError(f"Assistant 会话不存在：{session_id}。")
            return found

        def create_session(_db, payload):
            session_id = state["next_session"]
            state["next_session"] += 1
            state["log"].append({"op": "create_session", "title": payload.title, "task_type": payload.task_type,
                                 "project_path": payload.project_path,
                                 "messages": [message.model_dump() for message in payload.messages]})
            state["sessions"][session_id] = SimpleNamespace(id=session_id, project_path=payload.project_path)
            return state["sessions"][session_id]

        def get_session(_db, session_id):
            state["log"].append({"op": "get_session", "id": session_id})
            return lookup(session_id)

        def append_message(_db, session_id, payload):
            lookup(session_id)
            state["log"].append({"op": "append_message", "session_id": session_id, **payload.model_dump()})

        def create_tool_call(_db, session_id, payload):
            lookup(session_id)
            data = payload.model_dump(exclude_unset=True)
            tool_id = state["next_tool"]
            state["next_tool"] += 1
            state["log"].append({"op": "create_tool_call", "session_id": session_id, **data})
            state["tool_calls"][tool_id] = SimpleNamespace(id=tool_id, input_summary=data.get("input_summary", {}))
            return state["tool_calls"][tool_id]

        def update_tool_call(_db, tool_id, payload):
            data = payload.model_dump(exclude_unset=True)
            state["log"].append({"op": "update_tool_call", "id": tool_id, **data})
            tool = state["tool_calls"][tool_id]
            if "input_summary" in data:
                tool.input_summary = data["input_summary"]
            return tool

        svc.create_assistant_session = create_session
        svc.get_assistant_session = get_session
        svc.append_assistant_message = append_message
        svc.create_assistant_tool_call = create_tool_call
        svc.update_assistant_tool_call = update_tool_call

        def failure(spec):
            usage = TokenUsage.from_legacy(spec["usage"]) if spec.get("usage") else None
            if spec["raise"] == "LLMError":
                return LLMError(spec["message"], usage=usage)
            if spec["raise"] == "LLMRunInterrupted":
                return LLMRunInterrupted(spec["message"], usage=usage)
            return LLMConfigError(spec["message"])

        def use_llm(script, source=SOURCE):
            replies = list(script)
            svc.resolved_llm_env = lambda: source
            svc.missing_llm_env = lambda: real_missing(source)

            def take():
                reply = replies.pop(0)
                if isinstance(reply, dict) and "raise" in reply:
                    raise failure(reply)
                return reply

            def call(_source, *, system_prompt, user_prompt):
                state["log"].append({"op": "call", "system": system_prompt, "user": user_prompt})
                return take()

            def call_streamed(_source, *, system_prompt, user_prompt):
                state["log"].append({"op": "call_streamed", "system": system_prompt, "user": user_prompt})
                return take()

            def stream(_source, payload):
                state["log"].append({"op": "stream", "payload": payload})
                for frame in take():
                    if "raise" in frame:
                        raise failure(frame)
                    yield frame

            svc._call_llm = call
            svc._call_llm_streamed = call_streamed
            svc.stream_chat_completions = stream

        def outcome(run_fn):
            try:
                return {"result": run_fn()}
            except (DomainError, LLMRunInterrupted, LLMConfigError) as exc:
                return {"error": {"type": type(exc).__name__, "message": str(exc),
                                  "status": getattr(exc, "status_code", None)}}

        def scenario(kind, request, script, source=SOURCE):
            fresh_store()
            use_llm(script, source)
            payload = {key: (value.replace("$ROOT", root) if isinstance(value, str) else value)
                       for key, value in request.items()}
            if kind == "revise":
                got = outcome(lambda: svc.revise_file_content(None, AssistantReviseRequest(**payload)).model_dump())
            elif kind == "draft":
                got = outcome(lambda: svc.draft_file_content(None, AssistantDraftRequest(**payload)).model_dump())
            elif kind == "chat":
                got = outcome(lambda: svc.chat_reply(None, **payload))
            else:
                frames = []

                def run_stream():
                    for raw in svc.stream_continue_prose(None, AssistantContinueRequest(**payload)):
                        event, data = raw.split("\n", 1)
                        frames.append({"event": event.removeprefix("event: "),
                                       "data": json.loads(data.removeprefix("data: ").rstrip("\n"))})
                    return None
                got = outcome(run_stream)
                got["frames"] = frames
            return {**got, "log": state["log"]}

        base = {"file_path": "正文/第004章.md", "content": "他回头。\n\n雨夜里他推开门。\n", "project_root": "$ROOT"}
        done = {"content": "他回头。\n\n雨夜里他推开了门。\n", **USAGE}
        stream_ok = [{"type": "delta", "text": "雨夜里他推开门。"}, {"type": "delta", "text": "林舟站在檐下，"},
                     {"type": "delta", "text": "没有说话。半句"}, {"type": "done", **USAGE, "reasoning_leak_stripped": True}]
        cases = [
            ("revise", "revise-new-session", {**base, "instruction": ANCHORED}, [done]),
            ("revise", "revise-existing-session", {**base, "instruction": "改", "assistant_session_id": 1, "project_name": "末世"}, [done]),
            ("revise", "revise-missing-session", {**base, "instruction": "改", "assistant_session_id": 99}, [done]),
            ("revise", "revise-other-project", {**base, "instruction": "改", "assistant_session_id": 3}, [done]),
            ("revise", "revise-unbound-session", {**base, "instruction": "改", "assistant_session_id": 2}, [done]),
            ("revise", "revise-projectless", {"file_path": "a.md", "content": "他回头。", "instruction": "改",
                                              "assistant_session_id": 2}, [{"content": "她回头。", "latency_ms": 0}]),
            ("revise", "revise-llm-error", {**base, "instruction": "改"},
             [{"raise": "LLMError", "message": "上游 502：" + "长" * 4100,
               "usage": {"prompt_tokens": 10, "token_usage": 10, "token_usage_source": "provider"}}]),
            ("revise", "revise-interrupted", {**base, "instruction": "改"},
             [{"raise": "LLMRunInterrupted", "message": "stopped"}]),
            ("revise", "revise-config-error", {**base, "instruction": "改"},
             [{"raise": "LLMConfigError", "message": "STORYFORGE_LLM_AUTH_HEADER 只支持 api-key 或 bearer。"}]),
            ("revise", "revise-bad-keep", {**base, "instruction": "保留「不存在的句子」逐字不变"}, [done]),
            ("revise", "revise-polish-pass", {**base, "instruction": "润色", "quality_gate": "polish"},
             [{"content": "他回头。\n\n雨夜里他推开门！\n", "reasoning_leak_stripped": True}]),
            ("revise", "revise-polish-reject", {**base, "instruction": "润色", "quality_gate": "polish"},
             [{"content": "他回头。\n\n雨夜里他推开门。" * 4 + "\n"}]),
            ("revise", "revise-policy-reject", {**base, "content": "「留着」他说。", "instruction": "保留「留着」逐字不变"},
             [{"content": "「改了」他说。"}]),
            ("revise", "revise-bundle-no-root", {"file_path": "正文/第004章.md", "content": "他回头。", "instruction": "改",
                                                 "context_bundle": {"project_root": "D:\\x", "current_file": "x.md", "files": [
                                                     {"path": "人物/林舟.md", "relative_path": "人物/林舟.md", "kind": "character",
                                                      "title": "林舟", "excerpt": "林舟会游泳。"}]}}, [done]),
            ("revise", "revise-missing-env", {**base, "instruction": "改"}, [done],
             {**SOURCE, "STORYFORGE_LLM_MODEL": "", "STORYFORGE_LLM_API_KEY": None}),
            ("revise", "revise-rootless-bound-session", {"file_path": "a.md", "content": "他回头。", "instruction": "改",
                                                         "assistant_session_id": 1}, [done]),
            ("revise", "revise-long-path", {"file_path": "正文/" + "长" * 170 + ".md", "content": "𠀀他回头。" * 3,
                                            "instruction": "  " + "改" * 520 + "  "}, [{"content": "𠀀她回头。" * 3}]),
            ("revise", "revise-polish-advisory", {**base, "content": "他回头。\n\n雨夜里他推开门，林舟站在檐下没有说话，灯还亮着。\n",
                                                  "instruction": "润色", "quality_gate": "polish"},
             [{"content": "他回头。\n\n雨夜里他不禁推开门，林舟站在檐下没有说话，灯还亮着。\n"}]),
            ("continue", "continue-long-suffix", {**base, "content": "上文。\n" + "后" * 3100, "cursor_line": 1,
                                                  "instruction": ""}, [stream_ok]),
            ("continue", "continue-ok", {**base, "cursor_line": 3, "instruction": "写得紧张些", "target_chars": 120}, [stream_ok]),
            ("continue", "continue-defaults", {**base, "cursor_line": 0}, [stream_ok]),
            ("continue", "continue-new-chapter", {"file_path": "正文/第005章.md", "content": "", "project_root": "$ROOT",
                                                  "assistant_session_id": 1}, [stream_ok]),
            ("continue", "continue-empty", {**base, "cursor_line": 3},
             [[{"type": "delta", "text": "雨夜里他推开门。"}, {"type": "done", **USAGE}]]),
            ("continue", "continue-llm-error", {**base, "cursor_line": 3},
             [[{"type": "delta", "text": "林舟"}, {"raise": "LLMError", "message": "流读取中断"}]]),
            ("continue", "continue-interrupted", {**base, "cursor_line": 3},
             [[{"type": "delta", "text": "林舟"}, {"raise": "LLMRunInterrupted", "message": "paused"}]]),
            ("continue", "continue-no-done", {**base, "cursor_line": 3}, [[{"type": "delta", "text": "林舟"}]]),
            ("continue", "continue-missing-env", {**base}, [[]], {**SOURCE, "STORYFORGE_LLM_PROVIDER": " "}),
            ("continue", "continue-other-project", {**base, "assistant_session_id": 3}, [stream_ok]),
            ("continue", "continue-bundle", {**base, "cursor_line": 1, "context_bundle": {
                "project_root": "$ROOT", "current_file": "正文/第004章.md", "files": [
                    {"path": "人物/林舟.md", "relative_path": "人物/林舟.md", "kind": "character", "title": "林舟",
                     "excerpt": "旧摘录"}]}}, [stream_ok]),
            ("continue", "continue-projectless", {"file_path": "a.md", "content": "上文。", "cursor_line": 1}, [stream_ok]),
            ("draft", "draft-ok", {"file_path": "正文/第005章.md", "instruction": "写第五章", "project_root": "$ROOT",
                                   "project_name": "末世"}, [done]),
            ("draft", "draft-existing-session", {"file_path": "正文/第005章.md", "instruction": "写", "project_root": "$ROOT",
                                                 "assistant_session_id": 1}, [{"content": "初稿。", "reasoning_leak_stripped": True}]),
            # 模型整段写成半角：出稿前统一成全角，工具记录记下改了几处。
            ("draft", "draft-half-width", {"file_path": "正文/第006章.md", "instruction": "写", "project_root": "$ROOT"},
             [{"content": '他说,走吧."站住!"他等了很久...'}]),
            ("draft", "draft-llm-error", {"file_path": "正文/第005章.md", "instruction": "写", "project_root": "$ROOT"},
             [{"raise": "LLMError", "message": "超时"}]),
            ("draft", "draft-interrupted", {"file_path": "正文/第005章.md", "instruction": "写"},
             [{"raise": "LLMRunInterrupted", "message": "stopped"}]),
            ("chat", "chat-ok", {"user_message": "林舟会游泳吗", "context_block": "### 人物/林舟.md\n林舟会游泳。",
                                 "assistant_session_id": 1}, [{"content": "  会的。\n", **USAGE}]),
            ("chat", "chat-no-context", {"user_message": "长" * 600, "context_block": "", "assistant_session_id": 2},
             [{"content": "需要先看大纲。"}]),
            ("chat", "chat-missing-session", {"user_message": "x", "context_block": "", "assistant_session_id": 99}, [{}]),
            ("chat", "chat-llm-error", {"user_message": "x", "context_block": "", "assistant_session_id": 1},
             [{"raise": "LLMError", "message": "429 too many"}]),
            ("chat", "chat-interrupted", {"user_message": "x", "context_block": "", "assistant_session_id": 1},
             [{"raise": "LLMRunInterrupted", "message": "deadline"}]),
        ]
        calls = []
        for case in cases:
            kind, name, request, script = case[:4]
            source = case[4] if len(case) > 4 else SOURCE
            p.call(kind, {"name": name, "request": request, "script": script, "source": source},
                   lambda kind=kind, request=request, script=script, source=source: scenario(kind, request, script, source))
            calls.append(name)

        # ---- provider health ----
        clock = {"now": 100.0}

        def tick():
            clock["now"] += 0.0125
            return clock["now"]

        provider_health.time.monotonic = tick

        def probe(source, reply, raise_config=False):
            clock["now"] = 100.0

            def resolve():
                if raise_config:
                    raise LlmConfigFileError("配置文件损坏")
                return source

            def fetch(_source, *, timeout):
                state["probe_timeout"] = timeout
                if isinstance(reply, dict) and "raise" in reply:
                    kind = reply["raise"]
                    if kind == "http":
                        raise urlerror.HTTPError("https://llm.example/v1/models", reply["code"], "x", {}, None)
                    if kind == "json":
                        raise json.JSONDecodeError("bad", "x", 0)
                    if kind == "url":
                        raise urlerror.URLError("refused")
                    if kind == "config":
                        raise LLMConfigError("bad auth header")
                    raise ValueError("bad url")
                return reply

            state["probe_timeout"] = None
            result = provider_health.probe_provider_health(
                resolve_source=resolve, missing_env=lambda src: real_missing(src), fetch_models=fetch).model_dump()
            return {"result": result, "timeout": state["probe_timeout"]}

        models = {"data": [{"id": "deepseek-v4"}, {"id": "sk-test-secret-123456-mini"}, {"id": "sk-test-secret-123456"}]}
        health_cases = [
            ("ok", SOURCE, models),
            ("ok-userinfo", {**SOURCE, "STORYFORGE_LLM_BASE_URL": "https://user:pw@llm.example:8443/v1/?q=1#f",
                             "STORYFORGE_LLM_TIMEOUT_SECONDS": "5"}, models),
            ("ok-partial", {**SOURCE, "STORYFORGE_LLM_TIMEOUT_SECONDS": "abc"},
             {"data": [{"id": f"m{i}"} for i in range(205)]}),
            ("ok-gemini", {**SOURCE, "STORYFORGE_LLM_PROVIDER": "gemini", "STORYFORGE_LLM_TIMEOUT_SECONDS": "-1"},
             {"models": [{"name": "models/gemini-2.5"}]}),
            ("unauthorized", SOURCE, {"raise": "http", "code": 401}),
            ("forbidden", SOURCE, {"raise": "http", "code": 403}),
            ("server-error", SOURCE, {"raise": "http", "code": 503}),
            ("bad-json", SOURCE, {"raise": "json"}),
            ("bad-shape", SOURCE, {"data": "x"}),
            ("unreachable", {**SOURCE, "STORYFORGE_LLM_TIMEOUT_SECONDS": "30"}, {"raise": "url"}),
            ("config", SOURCE, {"raise": "config"}),
            ("value", SOURCE, {"raise": "value"}),
            ("ftp-url", {**SOURCE, "STORYFORGE_LLM_BASE_URL": "ftp://llm.example/v1"}, models),
            ("no-host", {**SOURCE, "STORYFORGE_LLM_BASE_URL": "https:///v1"}, models),
            ("bad-ipv6", {**SOURCE, "STORYFORGE_LLM_BASE_URL": "https://[::1/v1"}, models),
            ("secret-in-model", {**SOURCE, "STORYFORGE_LLM_MODEL": "m-sk-test-secret-123456"}, models),
            ("missing", {**SOURCE, "STORYFORGE_LLM_API_KEY": ""}, models),
        ]
        health = []
        for name, source, reply in health_cases:
            health.append({"name": name, "source": source, "reply": reply,
                           "output_json": json.dumps(probe(source, reply), ensure_ascii=False)})
        health.append({"name": "config-file", "source": SOURCE, "reply": models,
                       "output_json": json.dumps(probe(SOURCE, models, raise_config=True), ensure_ascii=False)})

        return {
            "format_version": 1,
            "suite": "p2-assistant-service",
            "platform": "windows" if os.name == "nt" else "posix",
            "synthetic_root": SYNTHETIC_ROOT,
            "sources": {path: hashlib.sha256((api / path).read_bytes()).hexdigest() for path in SOURCES},
            "projects": [p.record("book")],
            "health": stable(health, p.root),
        }
