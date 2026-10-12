"""Recorded-transport oracle for the LLM client: the real Python client runs against a scripted fake
`urlopen` (HTTP errors with Retry-After, connect failures, timeouts, resets, SSE bodies that break
mid-stream) on a virtual clock. Requests, waits, progress, frames and results are recorded."""

from __future__ import annotations

import base64
import hashlib
import json
import os

from golden_fs import isolated_fs_oracle
from golden_llm_harness import RANDOM, STEP, run_recorded, sse

SOURCES = [
    "app/common/llm_client.py",
    "app/common/llm_control.py",
    "app/platform/ai_sdk/contracts.py",
    "app/platform/ai_sdk/providers/openai_compatible.py",
    "app/platform/ai_sdk/providers/openai_stream.py",
    "app/platform/ai_sdk/stream_usage.py",
]
KEY = "sk-client-secret-0123456789"
BASE = {"STORYFORGE_LLM_MODEL": "gpt-test", "STORYFORGE_LLM_API_KEY": KEY, "STORYFORGE_LLM_PROVIDER": "openai",
        "STORYFORGE_LLM_BASE_URL": "https://relay.example.com/v1//", "STORYFORGE_LLM_RETRY_BASE_DELAY_SECONDS": "0.5",
        "STORYFORGE_LLM_RETRY_JITTER_SECONDS": "0.25"}
PRICED = {**BASE, "STORYFORGE_LLM_INPUT_CNY_PER_M_TOKENS": "2", "STORYFORGE_LLM_OUTPUT_CNY_PER_M_TOKENS": "8"}
DEFAULTS = {key: value for key, value in BASE.items() if "RETRY" not in key}


def completion(content, *, finish="stop", usage=None, tool_calls=None, extra=None):
    message = {"role": "assistant", "content": content}
    if tool_calls is not None:
        message["tool_calls"] = tool_calls
    body = {"id": "resp-1", "choices": [{"index": 0, "message": message, "finish_reason": finish}], **(extra or {})}
    if usage is not None:
        body["usage"] = usage
    return {"status": 200, "body": json.dumps(body, ensure_ascii=False)}


def delta(text, finish=None, **extra):
    return {"id": "chunk-1", "choices": [{"index": 0, "delta": {"content": text}, "finish_reason": finish}], **extra}


USAGE = {"prompt_tokens": 1200, "completion_tokens": 300, "total_tokens": 1500, "prompt_cache_hit_tokens": 200}
TOOL_CALLS = [{"id": "call-1", "type": "function", "function": {"name": "fs.read", "arguments": {"path": "正文/1.md"}}}]
TOOLS = [{"type": "function", "function": {"name": "fs.read", "description": "读", "parameters": {"type": "object"},
                                           "strict": True}, "x-extra": 1}]
TOOLS_MIXED = TOOLS + [{"type": "function", "function": {"name": "g", "parameters": {}}},
                       {"type": "function", "function": {"name": "h", "description": "", "parameters": {}}}]
TOOL_DELTAS = [
    {"id": "r-9", "choices": [{"delta": {"tool_calls": [{"index": 0, "id": "call-", "function": {"name": "fs.", "arguments": "{\"pa"}}]}}]},
    {"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "1", "function": {"name": "read", "arguments": "th\":\"a\"}"}}]}}]},
    {"choices": [{"delta": {"content": "我先读 sk-"}}]},
    {"choices": [{"delta": {"content": "abcdefgh 文件。"}, "finish_reason": "tool_calls"}]},
    {"choices": [], "usage": {"prompt_tokens": 50, "completion_tokens": 9}},
]
SCENARIOS = [
    ("call_llm", "ok-priced", PRICED, {"system": "系统", "user": "用户"}, [completion("  正文  ", usage=USAGE)]),
    ("call_llm", "retry-503-then-ok", BASE, {"system": "s", "user": "u"},
     [{"status": 503, "body": "busy"}, completion("好")]),
    ("call_llm", "retry-after", BASE, {"system": "s", "user": "u"},
     [{"status": 429, "headers": {"Retry-After": "2"}, "body": "slow"}, completion("好")]),
    ("call_llm", "retry-after-huge", BASE, {"system": "s", "user": "u"},
     [{"status": 429, "headers": {"retry-after": "9000"}, "body": ""}, completion("好")]),
    ("call_llm", "http-400-redacted", BASE, {"system": "s", "user": "u"},
     [{"status": 400, "body": f"bad key {KEY} " + "长" * 2100}]),
    ("call_llm", "http-503-exhausted", BASE, {"system": "s", "user": "u"}, [{"status": 503, "body": "x"}] * 3),
    ("call_llm", "unreadable-error-body", BASE, {"system": "s", "user": "u"}, [{"status": 401, "body_unreadable": True}]),
    ("call_llm", "connect-errors", BASE, {"system": "s", "user": "u"},
     [{"raise": "URLError", "reason": "getaddrinfo failed"}, {"raise": "TimeoutError", "reason": "timed out"},
      {"raise": "URLError", "reason": f"refused {KEY}"}]),
    ("call_llm", "timeout-then-ok", BASE, {"system": "s", "user": "u"},
     [{"raise": "TimeoutError", "reason": "timed out"}, completion("好")]),
    ("call_llm", "read-errors", BASE, {"system": "s", "user": "u"},
     [{"status": 200, "body": "<html>gateway</html>"}, {"raise": "RemoteDisconnected"},
      {"status": 200, "body_b64": base64.b64encode(b"\xff\xfe").decode()}]),
    ("call_llm", "read-timeout", {**BASE, "STORYFORGE_LLM_RETRY_MAX_ATTEMPTS": "1", "STORYFORGE_LLM_TIMEOUT_SECONDS": "30"},
     {"system": "s", "user": "u"}, [{"status": 200, "body": "{}", "read_raise": "TimeoutError"}]),
    ("call_llm", "incomplete-read", {**BASE, "STORYFORGE_LLM_RETRY_MAX_ATTEMPTS": "2"}, {"system": "s", "user": "u"},
     [{"status": 200, "body": "{}", "read_raise": "IncompleteRead"}, {"raise": "ConnectionResetError"}]),
    ("call_llm", "think-stripped", BASE, {"system": "s", "user": "u"}, [completion("<think>想</think>  正文")]),
    ("call_llm", "think-only", BASE, {"system": "s", "user": "u"}, [completion("<think>只有思考</think>")]),
    ("call_llm", "empty", BASE, {"system": "s", "user": "u"}, [completion("   ")]),
    ("call_llm", "truncated", PRICED, {"system": "s", "user": "u"}, [completion("半截", finish="length", usage=USAGE)]),
    ("call_llm", "missing-choices", BASE, {"system": "s", "user": "u"},
     [{"status": 200, "body": json.dumps({"usage": USAGE})}]),
    ("call_llm", "tools", {**BASE, "STORYFORGE_LLM_REASONING_EFFORT": "low", "STORYFORGE_LLM_MAX_COMPLETION_TOKENS": "99"},
     {"system": "s", "user": "u", "tools": TOOLS_MIXED, "tool_choice": "auto"},
     [completion("要读文件", tool_calls=TOOL_CALLS, finish="tool_calls")]),
    ("call_llm", "default-retry-settings", DEFAULTS, {"system": "s", "user": "u"},
     [{"status": 503, "body": "busy"}, completion("好")]),
    ("call_llm_streamed", "done-after-length", BASE, {"system": "s", "user": "u"},
     [{"status": 200, "body": sse(delta("半截", "length"))}]),
    ("call_llm_streamed", "usage-then-reset", PRICED, {"system": "s", "user": "u"},
     [{"status": 200, "body": sse({"choices": [], "usage": USAGE}, delta("一二"), delta("三")), "fail_after_lines": 4,
       "fail_with": "ConnectionResetError"}]),
    ("provider_stream", "tool-stream-incomplete", BASE, {"messages": [{"role": "user", "content": "u"}], "tools": TOOLS},
     [{"status": 200, "body": sse(TOOL_DELTAS[0], TOOL_DELTAS[1],
                                  {"choices": [{"delta": {}, "finish_reason": "function_call"}]}, done=False)}]),
    ("provider_complete", "configured-max-tokens", {**BASE, "STORYFORGE_LLM_MAX_COMPLETION_TOKENS": "77"},
     {"messages": [{"role": "user", "content": "u"}]}, [completion("好")]),
    ("provider_complete", "explicit-zero-max-tokens", {**BASE, "STORYFORGE_LLM_MAX_COMPLETION_TOKENS": "77"},
     {"messages": [{"role": "user", "content": "u"}], "max_tokens": 0}, [completion("好")]),
    ("call_llm", "no-retry-config", {**BASE, "STORYFORGE_LLM_RETRY_MAX_ATTEMPTS": "0"}, {"system": "s", "user": "u"},
     [{"status": 500, "body": "x"}]),
    ("call_llm", "missing-key", {**BASE, "STORYFORGE_LLM_API_KEY": ""}, {"system": "s", "user": "u"}, []),
    ("call_llm_messages", "tool-only", BASE,
     {"messages": [{"role": "system", "content": "s"}, {"role": "user", "content": "u", "extra": [1]},
                   {"role": "assistant", "content": None, "tool_calls": TOOL_CALLS},
                   {"role": "tool", "tool_call_id": 7, "content": "结果", "name": "fs.read"}],
      "tools": TOOLS, "timeout_seconds": 12.5, "max_attempts": 1},
     [completion("", tool_calls=TOOL_CALLS, finish="tool_calls")]),
    ("call_llm_messages", "neither", BASE, {"messages": [{"role": "user", "content": "u"}]}, [completion("")]),
    ("call_llm_messages", "bad-role", BASE, {"messages": [{"role": "robot", "content": "u"}]}, []),
    ("call_llm_streamed", "stream-ok", PRICED, {"system": "系统", "user": "写"},
     [{"status": 200, "body": sse(delta("你"), delta("好", "stop"), {"choices": [], "usage": USAGE})}]),
    ("call_llm_streamed", "stream-options-rejected", BASE, {"system": "  ", "user": "写"},
     [{"status": 400, "body": "unknown field stream_options"}, {"status": 200, "body": sse(delta("好", "stop"), done=False)}]),
    ("call_llm_streamed", "stream-heartbeats", BASE, {"system": "s", "user": "u"},
     [{"status": 200, "body": ": ping\n\ndata: {bad json\n\nevent: x\ndata: 5\n\n" + sse(delta("字"), done=True)}]),
    ("call_llm_streamed", "stream-no-terminal", BASE, {"system": "s", "user": "u"},
     [{"status": 200, "body": sse(delta("从柜台下面摸出一"), done=False)}]),
    ("call_llm_streamed", "stream-empty", BASE, {"system": "s", "user": "u"},
     [{"status": 200, "body": sse(delta(""), delta("  "))}]),
    ("call_llm_streamed", "stream-think", BASE, {"system": "s", "user": "u"},
     [{"status": 200, "body": sse(delta("<thi"), delta("nk>想</think>  正"), delta("文"))}]),
    ("call_llm_streamed", "stream-reset-midway", BASE, {"system": "s", "user": "u"},
     [{"status": 200, "body": sse(delta("一二三"), delta("四五")), "fail_after_lines": 4,
       "fail_with": "ConnectionResetError"}]),
    ("call_llm_streamed", "stream-timeout-midway", BASE, {"system": "s", "user": "u"},
     [{"status": 200, "body": sse(delta("一二三")), "fail_after_lines": 2, "fail_with": "TimeoutError"}]),
    ("call_llm_streamed", "stream-connect-retry", BASE, {"system": "s", "user": "u"},
     [{"status": 503, "headers": {"Retry-After": "1.5"}, "body": "x"}, {"raise": "RemoteDisconnected"},
      {"status": 200, "body": sse(delta("好"))}]),
    ("call_llm_streamed", "stream-connect-fail", BASE, {"system": "s", "user": "u"},
     [{"raise": "URLError", "reason": f"proxy {KEY}"}] * 3),
    ("call_llm_streamed", "stream-http-401", BASE, {"system": "s", "user": "u"},
     [{"status": 401, "body": f"invalid {KEY} Bearer {KEY}"}]),
    ("call_llm_streamed", "stream-truncated", PRICED, {"system": "s", "user": "u"},
     [{"status": 200, "body": sse(delta("半截", "length"), {"choices": [], "usage": USAGE}, done=False)}]),
    ("call_llm_streamed", "stream-reset-at-connect", {**BASE, "STORYFORGE_LLM_RETRY_MAX_ATTEMPTS": "1"},
     {"system": "s", "user": "u"}, [{"raise": "RemoteDisconnected"}]),
    ("call_llm_streamed", "stream-bytes-crlf", BASE, {"system": "s", "user": "u"},
     [{"status": 200, "body": "data: " + json.dumps(delta("甲", "stop"), ensure_ascii=False) + "\r\n\r\n"}]),
    ("provider_stream", "tool-stream", BASE,
     {"messages": [{"role": "user", "content": "读第一章"}], "tools": TOOLS, "tool_choice": "auto"},
     [{"status": 200, "body": sse(*TOOL_DELTAS, done=False)}]),
    ("provider_stream", "tool-stream-truncated", BASE, {"messages": [{"role": "user", "content": "u"}], "tools": TOOLS},
     [{"status": 200, "body": sse(TOOL_DELTAS[0], {"choices": [{"delta": {}, "finish_reason": "length"}]}, done=False)}]),
    ("provider_stream", "tool-stream-invalid", BASE, {"messages": [{"role": "user", "content": "u"}], "tools": TOOLS},
     [{"status": 200, "body": sse({"choices": [{"delta": {"tool_calls": [{"index": 200}]}}]})}]),
    ("provider_stream", "tool-stream-bad-args", BASE, {"messages": [{"role": "user", "content": "u"}], "tools": TOOLS},
     [{"status": 200, "body": sse({"choices": [{"delta": {"tool_calls": [
         {"index": 0, "id": "c", "function": {"name": "f", "arguments": "[1]"}}]}, "finish_reason": "tool_calls"}]})}]),
    ("provider_stream", "plain-stream-configured", {**BASE, "STORYFORGE_LLM_MAX_COMPLETION_TOKENS": "64"},
     {"messages": [{"role": "user", "content": "u"}]}, [{"status": 200, "body": sse(delta("好", "stop"))}]),
    ("provider_complete", "configured-complete", {**BASE, "STORYFORGE_LLM_TEMPERATURE": "1"},
     {"messages": [{"role": "user", "content": "u"}]}, [completion("好", usage={"total_tokens": 40})]),
    ("fetch_models", "models-ok", BASE, {"timeout": 5.0}, [{"status": 200, "body": json.dumps({"data": [{"id": "m"}]})}]),
    ("fetch_models", "models-401", BASE, {"timeout": 5.0}, [{"status": 401, "body": "no"}]),
    ("fetch_models", "models-bad-url", {**BASE, "STORYFORGE_LLM_BASE_URL": "ftp://x"}, {"timeout": 5.0}, []),
]
CONTROL_SCENARIOS = [
    ("call_llm", "control-deadline", BASE, {"system": "s", "user": "u"},
     [{"status": 503, "body": "x"}, {"status": 503, "body": "x"}], {"deadline": 1.0, "stop_at": None}),
    ("call_llm_streamed", "control-stop-midstream", BASE, {"system": "s", "user": "u"},
     [{"status": 200, "body": sse(delta("一"), delta("二"), delta("三"))}], {"deadline": None, "stop_at": 3}),
    ("call_llm", "control-progress", BASE, {"system": "s", "user": "u"},
     [{"status": 500, "body": "x"}, completion("好")], {"deadline": 100.0, "stop_at": None}),
    ("call_llm_streamed", "control-stream-options", BASE, {"system": "s", "user": "u"},
     [{"status": 400, "body": "no stream_options"}, {"status": 200, "body": sse(delta("好", "stop"))}],
     {"deadline": 100.0, "stop_at": None}),
    ("provider_stream", "control-stop-events", BASE, {"messages": [{"role": "user", "content": "u"}]},
     [{"status": 200, "body": sse(delta("一"), delta("二"), delta("三"), delta("四", "stop"))}],
     {"deadline": None, "stop_at": 6}),
]
RETAIN_CASES = [
    (None, {"input_tokens": 5, "output_tokens": 2, "total_tokens": 7, "source": "provider_usage"}),
    ({"source": "unavailable"}, {"input_tokens": 5, "output_tokens": 2, "total_tokens": 7, "source": "provider_usage"}),
    ({"input_tokens": 1, "total_tokens": 1, "source": "estimated_split"},
     {"input_tokens": 5, "output_tokens": 2, "total_tokens": 7, "source": "provider_usage"}),
    (None, {"source": "unavailable"}), (None, None),
]


def p2_llm_client_snapshot() -> dict:
    with isolated_fs_oracle("llm-client-oracle-") as (api, run):
        from app.common.version import APP_VERSION
        from app.platform.ai_sdk import contracts
        from app.platform.ai_sdk.stream_usage import retain_error_usage

        def retain_case(existing, new):
            exc = RuntimeError("x")
            if existing is not None:
                exc.usage = contracts.TokenUsage(**existing)
            retain_error_usage(exc, None if new is None else contracts.TokenUsage(**new))
            usage = getattr(exc, "usage", None)
            return {"existing": existing, "new": new, "result": usage.to_legacy() if usage is not None else None}

        records = run_recorded(SCENARIOS, CONTROL_SCENARIOS)
        return {
            "format_version": 1,
            "suite": "p2-llm-client",
            "app_version": APP_VERSION,
            "step_seconds": STEP,
            "random": RANDOM,
            "platform": "windows" if os.name == "nt" else "posix",
            "sources": {path: hashlib.sha256((api / path).read_bytes()).hexdigest() for path in SOURCES},
            "scenarios": records,
            "retain": [retain_case(existing, new) for existing, new in RETAIN_CASES],
        }
