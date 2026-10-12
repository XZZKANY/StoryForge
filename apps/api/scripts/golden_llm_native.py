"""Recorded-transport oracle for the native Anthropic Messages and Gemini generateContent protocols:
payload translation, response / SSE parsing, error mapping and continuation state, via the real client."""

from __future__ import annotations

import hashlib
import json
import os

from golden_fs import isolated_fs_oracle
from golden_llm_harness import RANDOM, STEP, run_recorded, sse

SOURCES = [
    "app/common/llm_client.py",
    "app/platform/ai_sdk/providers/anthropic.py",
    "app/platform/ai_sdk/providers/gemini.py",
]
KEY = "native-secret-key-0123456789"
ANTHROPIC = {"STORYFORGE_LLM_PROVIDER": " Claude ", "STORYFORGE_LLM_BASE_URL": "https://api.anthropic.example/v1/",
             "STORYFORGE_LLM_MODEL": "claude-test", "STORYFORGE_LLM_API_KEY": KEY}
GEMINI = {"STORYFORGE_LLM_PROVIDER": "google", "STORYFORGE_LLM_BASE_URL": "https://gemini.example/v1beta//",
          "STORYFORGE_LLM_MODEL": "gemini 2.5:专业~x(预览)!*'", "STORYFORGE_LLM_API_KEY": KEY}
TOOLS = [{"type": "function", "function": {"name": "fs.read", "description": "读文件", "parameters": {"type": "object"}}},
         {"type": "function", "function": {"name": "fs.list", "parameters": {"type": "object"}}}]
ROUNDTRIP = [
    {"role": "system", "content": "系统一"}, {"role": "system", "content": "  系统二  "},
    {"role": "user", "content": "读第一章"},
    {"role": "assistant", "content": "好的", "tool_calls": [
        {"id": "tu_1", "type": "function", "function": {"name": "fs.read", "arguments": "{\"path\": \"正文/1.md\"}"}}]},
    {"role": "tool", "tool_call_id": "tu_1", "content": "{\"text\": \"第一章\"}"},
    {"role": "user", "content": "继续"},
]


def ok(body):
    return {"status": 200, "body": json.dumps(body, ensure_ascii=False)}


ANTHROPIC_MESSAGE = {
    "id": "msg_1", "type": "message", "stop_reason": "end_turn",
    "content": [{"type": "thinking", "thinking": "想一想", "signature": "sig-1"}, {"type": "text", "text": "正"},
                {"type": "text", "text": "文"}, {"type": "tool_use", "id": "tu_9", "name": "fs.read", "input": {"path": "a"}},
                {"type": "tool_use", "id": "tu_10", "name": "fs.list", "input": "bad"}, 7],
    "usage": {"input_tokens": 120, "output_tokens": 30, "cache_read_input_tokens": 40},
}
ANTHROPIC_STREAM = sse(
    {"type": "message_start", "message": {"id": "msg_s", "usage": {"input_tokens": 12, "output_tokens": 1,
                                                                    "cache_read_input_tokens": 7}}},
    {"type": "ping"},
    {"type": "content_block_start", "index": 0, "content_block": {"type": "thinking", "thinking": ""}},
    {"type": "content_block_delta", "index": 0, "delta": {"type": "thinking_delta", "thinking": "想"}},
    {"type": "content_block_delta", "index": 0, "delta": {"type": "signature_delta", "signature": "sig"}},
    {"type": "content_block_stop", "index": 0},
    {"type": "content_block_start", "index": 1, "content_block": {"type": "text", "text": ""}},
    {"type": "content_block_delta", "index": 1, "delta": {"type": "text_delta", "text": "你好"}},
    {"type": "content_block_stop", "index": 1},
    {"type": "content_block_start", "index": 2,
     "content_block": {"type": "tool_use", "id": "tu_2", "name": "fs.read", "input": {}}},
    {"type": "content_block_delta", "index": 2, "delta": {"type": "input_json_delta", "partial_json": "{\"path\":"}},
    {"type": "content_block_delta", "index": 2, "delta": {"type": "input_json_delta", "partial_json": "\"a\"}"}},
    {"type": "content_block_stop", "index": 2},
    {"type": "content_block_start", "index": 3,
     "content_block": {"type": "tool_use", "id": "tu_3", "name": "fs.list", "input": {"dir": "正文"}}},
    {"type": "content_block_stop", "index": 3},
    {"type": "content_block_start", "index": 4,
     "content_block": {"type": "tool_use", "id": "tu_4", "name": "fs.list", "input": {}}},
    {"type": "content_block_stop", "index": 4},
    {"type": "message_delta", "delta": {"stop_reason": "tool_use"}, "usage": {"output_tokens": 20}},
    {"type": "message_delta", "delta": {}, "usage": {"output_tokens": 21}},
    {"type": "message_stop"},
    done=False,
)
GEMINI_RESPONSE = {
    "responseId": "r1",
    "candidates": [{"finishReason": "STOP", "content": {"parts": [
        {"text": "想", "thought": True}, {"text": "正文"}, 3,
        {"functionCall": {"name": "fs.read", "args": {"path": "a"}}, "thoughtSignature": "sig-g"},
        {"functionCall": {"id": "fc-2", "name": "fs.list", "args": "bad"}}]}}],
    "usageMetadata": {"promptTokenCount": 90, "candidatesTokenCount": 11, "totalTokenCount": 120,
                      "cachedContentTokenCount": 5, "thoughtsTokenCount": 19},
}
GEMINI_STREAM = sse(
    {"responseId": "rs", "candidates": [{"content": {"parts": [{"text": "想", "thought": True}]}}]},
    {"candidates": [{"content": {"parts": [{"text": "你"}, {"text": "好"}]}}],
     "usageMetadata": {"promptTokenCount": 9, "candidatesTokenCount": 2}},
    {"candidates": [{"content": {"parts": [{"functionCall": {"name": "fs.read", "args": {"p": 1}},
                                            "thoughtSignature": "sg"}]}, "finishReason": "STOP"}],
     "usageMetadata": {"totalTokenCount": 30}},
    done=False, tail="data: [DONE]\n\n",
)
SCENARIOS = [
    ("call_llm", "anthropic-ok", {**ANTHROPIC, "STORYFORGE_LLM_TEMPERATURE": "0.3"}, {"system": "系统", "user": "用户"},
     [ok(ANTHROPIC_MESSAGE)]),
    ("call_llm", "anthropic-tools-choice", ANTHROPIC, {"system": "s", "user": "u", "tools": TOOLS, "tool_choice": "required"},
     [ok({"content": [{"type": "text", "text": "x"}], "stop_reason": "tool_use"})]),
    ("call_llm", "anthropic-refusal", ANTHROPIC, {"system": "s", "user": "u"},
     [ok({"content": [], "stop_reason": "refusal", "usage": {"input_tokens": 5, "output_tokens": 0}})]),
    ("call_llm", "anthropic-error-body", ANTHROPIC, {"system": "s", "user": "u"},
     [ok({"type": "error", "error": {"type": "overloaded_error"}, "request_id": "req-1"})]),
    ("call_llm", "anthropic-missing-content", ANTHROPIC, {"system": "s", "user": "u"}, [ok({"stop_reason": "end_turn"})]),
    ("call_llm", "anthropic-529-then-401", ANTHROPIC, {"system": "s", "user": "u"},
     [{"status": 529, "headers": {"retry-after": "3"}, "body": "overloaded"},
      {"status": 401, "body": f"invalid x-api-key {KEY}"}]),
    ("call_llm", "anthropic-connect-fail", {**ANTHROPIC, "STORYFORGE_LLM_RETRY_MAX_ATTEMPTS": "2"},
     {"system": "s", "user": "u"}, [{"raise": "URLError", "reason": "dns"}, {"raise": "TimeoutError", "reason": "timed out"}]),
    ("call_llm", "anthropic-bad-json", {**ANTHROPIC, "STORYFORGE_LLM_RETRY_MAX_ATTEMPTS": "1"},
     {"system": "s", "user": "u"}, [{"status": 200, "body": "not json"}]),
    ("call_llm_messages", "anthropic-roundtrip", {**ANTHROPIC, "STORYFORGE_LLM_REASONING_EFFORT": "low",
                                                 "STORYFORGE_LLM_TEMPERATURE": "1", "STORYFORGE_LLM_MAX_COMPLETION_TOKENS": "2048"},
     {"messages": ROUNDTRIP, "tools": TOOLS, "tool_choice": {"type": "function", "function": {"name": "fs.read"}}},
     [ok({"content": [{"type": "tool_use", "id": "tu_5", "name": "fs.read", "input": {}}], "stop_reason": "tool_use"})]),
    ("call_llm_messages", "anthropic-thinking-temperature", {**ANTHROPIC, "STORYFORGE_LLM_REASONING_EFFORT": "high",
                                                            "STORYFORGE_LLM_MAX_COMPLETION_TOKENS": "9000"},
     {"messages": ROUNDTRIP}, []),
    ("call_llm_messages", "anthropic-thinking-budget", {**ANTHROPIC, "STORYFORGE_LLM_REASONING_EFFORT": "medium",
                                                       "STORYFORGE_LLM_TEMPERATURE": "1"}, {"messages": ROUNDTRIP}, []),
    ("call_llm_messages", "anthropic-bad-effort", {**ANTHROPIC, "STORYFORGE_LLM_REASONING_EFFORT": "max"},
     {"messages": ROUNDTRIP}, []),
    ("call_llm_messages", "anthropic-bad-tool-args", ANTHROPIC,
     {"messages": [{"role": "assistant", "content": None, "tool_calls": [
         {"id": "t", "function": {"name": "it's \"x\"", "arguments": "[1]"}}]}]}, []),
    ("call_llm_streamed", "anthropic-streamed", ANTHROPIC, {"system": "s", "user": "u"},
     [{"status": 200, "body": "event: message_start\n" + ANTHROPIC_STREAM}]),
    ("native_stream", "anthropic-stream-events", ANTHROPIC, {"model": "claude-test", "messages": ROUNDTRIP, "tools": TOOLS,
                                                             "max_tokens": 64, "tool_choice": "none"},
     [{"status": 200, "body": ANTHROPIC_STREAM}]),
    ("native_stream", "anthropic-stream-no-stop", ANTHROPIC, {"model": "m", "messages": [{"role": "user", "content": "u"}]},
     [{"status": 200, "body": sse({"type": "message_start", "message": {"id": "x"}}, done=False)}]),
    ("native_stream", "anthropic-stream-refusal", ANTHROPIC, {"model": "m", "messages": [{"role": "user", "content": "u"}]},
     [{"status": 200, "body": sse({"type": "message_delta", "delta": {"stop_reason": "refusal"}},
                                  {"type": "message_stop"}, done=False)}]),
    ("native_stream", "anthropic-stream-error-frame", ANTHROPIC, {"model": "m", "messages": [{"role": "user", "content": "u"}]},
     [{"status": 200, "body": sse({"type": "error", "error": {"type": "rate_limit_error"}}, done=False)}]),
    ("native_stream", "anthropic-stream-bad-json", ANTHROPIC, {"model": "m", "messages": [{"role": "user", "content": "u"}]},
     [{"status": 200, "body": "data: {oops\n\n"}]),
    ("native_stream", "anthropic-stream-reset", ANTHROPIC, {"model": "m", "messages": [{"role": "user", "content": "u"}]},
     [{"status": 200, "body": ANTHROPIC_STREAM, "fail_after_lines": 5, "fail_with": "ConnectionResetError"}]),
    ("native_stream", "anthropic-stream-connect", {**ANTHROPIC, "STORYFORGE_LLM_RETRY_MAX_ATTEMPTS": "2"},
     {"model": "m", "messages": [{"role": "user", "content": "u"}]},
     [{"status": 503, "body": "x"}, {"raise": "RemoteDisconnected"}]),
    ("native_stream", "anthropic-stream-http", ANTHROPIC, {"model": "m", "messages": [{"role": "user", "content": "u"}]},
     [{"status": 400, "body": "bad"}]),
    ("native_complete", "anthropic-continuation-replay", ANTHROPIC,
     {"model": "m", "messages": [{"role": "user", "content": "u"}, {"role": "assistant", "content": "a"}],
      "continuation": [1, {"provider": "anthropic", "state": {"thinking_blocks": [{"type": "thinking", "thinking": "旧"}]}}]},
     [ok({"content": [{"type": "redacted_thinking", "data": "zz"}], "stop_reason": "max_tokens"})]),
    ("native_complete", "anthropic-end-turn", ANTHROPIC, {"model": "m", "messages": [{"role": "user", "content": "u"}]},
     [ok({"content": [{"type": "text", "text": "好"}], "stop_reason": "end_turn",
          "usage": {"input_tokens": -5, "output_tokens": 3}})]),
    ("native_complete", "anthropic-unknown-stop", ANTHROPIC, {"model": "m", "messages": [{"role": "user", "content": "u"}]},
     [ok({"content": [], "stop_reason": "Pause_Turn"})]),
    ("native_complete", "anthropic-error-category", ANTHROPIC, {"model": "m", "messages": [{"role": "user", "content": "u"}]},
     [ok({"type": "error", "error": {"type": "overloaded_error"}})]),
    ("call_llm", "anthropic-long-error-body", ANTHROPIC, {"system": "s", "user": "u"}, [{"status": 400, "body": "坏" * 2100}]),
    ("call_llm_messages", "anthropic-repr-single-quote", ANTHROPIC,
     {"messages": [{"role": "assistant", "content": None, "tool_calls": [
         {"id": "t", "function": {"name": "it's", "arguments": "[1]"}}]}]}, []),
    ("native_stream", "anthropic-stream-connect-names", {**ANTHROPIC, "STORYFORGE_LLM_RETRY_MAX_ATTEMPTS": "2"},
     {"model": "m", "messages": [{"role": "user", "content": "u"}]},
     [{"raise": "URLError", "reason": "dns"}, {"raise": "TimeoutError", "reason": "timed out"}]),
    ("call_llm", "gemini-max-tokens", GEMINI, {"system": "s", "user": "u"},
     [ok({"candidates": [{"finishReason": "MAX_TOKENS", "content": {"parts": [{"text": "半"}]}}]})]),
    ("call_llm", "gemini-ok", GEMINI, {"system": "系统", "user": "用户"}, [ok(GEMINI_RESPONSE)]),
    ("call_llm", "gemini-safety", GEMINI, {"system": "s", "user": "u"},
     [ok({"candidates": [{"finishReason": "safety"}], "usageMetadata": {"promptTokenCount": 3}})]),
    ("call_llm", "gemini-malformed-call", GEMINI, {"system": "s", "user": "u"},
     [ok({"candidates": [{"finishReason": "MALFORMED_FUNCTION_CALL"}]})]),
    ("call_llm", "gemini-error-body", GEMINI, {"system": "s", "user": "u"},
     [ok({"error": {"code": 429, "status": "RESOURCE_EXHAUSTED"}})]),
    ("call_llm", "gemini-missing-candidates", GEMINI, {"system": "s", "user": "u"}, [ok({"candidates": []})]),
    ("call_llm_messages", "gemini-roundtrip", {**GEMINI, "STORYFORGE_LLM_REASONING_EFFORT": "high",
                                              "STORYFORGE_LLM_MAX_COMPLETION_TOKENS": "512"},
     {"messages": ROUNDTRIP, "tools": TOOLS, "tool_choice": "auto"},
     [ok({"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": "好"}]}}]})]),
    ("call_llm_messages", "gemini-tool-choice-function", GEMINI,
     {"messages": [{"role": "user", "content": "u"}], "tools": TOOLS,
      "tool_choice": {"type": "function", "function": {"name": "fs.list"}}},
     [ok({"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": "好"}]}}]})]),
    ("call_llm_messages", "gemini-tool-result-not-object", GEMINI,
     {"messages": [{"role": "assistant", "content": None, "tool_calls": [
         {"id": "c1", "function": {"name": "fs.read", "arguments": "{}"}}]},
                   {"role": "tool", "tool_call_id": "c1", "content": "纯文本"}]}, []),
    ("call_llm_messages", "gemini-tool-result-unnamed", GEMINI,
     {"messages": [{"role": "tool", "tool_call_id": "zz", "content": "{}"}]}, []),
    ("call_llm_messages", "gemini-bad-effort", {**GEMINI, "STORYFORGE_LLM_REASONING_EFFORT": "ultra"},
     {"messages": [{"role": "user", "content": "u"}]}, []),
    ("call_llm_streamed", "gemini-streamed", GEMINI, {"system": "s", "user": "u"}, [{"status": 200, "body": GEMINI_STREAM}]),
    ("native_stream", "gemini-stream-events", GEMINI, {"model": "gemini-x", "messages": ROUNDTRIP},
     [{"status": 200, "body": GEMINI_STREAM}]),
    ("native_stream", "gemini-stream-no-finish", GEMINI, {"model": "g", "messages": [{"role": "user", "content": "u"}]},
     [{"status": 200, "body": sse({"candidates": [{"content": {"parts": [{"text": "半"}]}}]}, done=False)}]),
    ("native_stream", "gemini-stream-safety", GEMINI, {"model": "g", "messages": [{"role": "user", "content": "u"}]},
     [{"status": 200, "body": sse({"candidates": [{"content": {"parts": [{"text": "半"}]}, "finishReason": "RECITATION"}]},
                                  done=False)}]),
    ("native_stream", "gemini-stream-error", GEMINI, {"model": "g", "messages": [{"role": "user", "content": "u"}]},
     [{"status": 200, "body": sse({"error": {"status": "UNAVAILABLE", "code": 503}}, done=False)}]),
    ("native_complete", "gemini-continuation-replay", GEMINI,
     {"model": "g/x", "messages": [{"role": "user", "content": "u"}, {"role": "assistant", "content": None, "tool_calls": [
         {"id": "c7", "function": {"name": "fs.read", "arguments": "{\"p\": 1}"}}]}, {"role": "tool", "tool_call_id": "c7",
                                                                                     "content": "{\"ok\": true}"}],
      "continuation": [1, {"provider": "gemini", "state": {"function_call_signatures": {"c7": "sig-7", "c8": 5}}}]},
     [ok({"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": "只想", "thought": True}]}}]})]),
]


def p2_llm_native_snapshot() -> dict:
    with isolated_fs_oracle("llm-native-oracle-") as (api, run):
        from app.common.version import APP_VERSION

        return {
            "format_version": 1,
            "suite": "p2-llm-native",
            "app_version": APP_VERSION,
            "step_seconds": STEP,
            "random": RANDOM,
            "platform": "windows" if os.name == "nt" else "posix",
            "sources": {path: hashlib.sha256((api / path).read_bytes()).hexdigest() for path in SOURCES},
            "scenarios": run_recorded(SCENARIOS),
        }
