"""SDK tool-calling runtime oracle: scripted provider / tools / interruptions through the real ToolCallingRuntime.

Every scenario is plain JSON (stored as `spec_json` so the TS replay keeps 2 and 2.0 apart). Steps share one
checkpoint store, tracer and usage sink; each step builds a fresh runtime, like the live resume path. External
results (deferred tools) and policy approvals have no StoryForge caller, so no scenario reaches them.
"""

from __future__ import annotations

import hashlib
import json
import os

from golden_fs import isolated_fs_oracle

SOURCES = [
    "app/platform/ai_sdk/runtime/loop.py",
    "app/platform/ai_sdk/runtime/models.py",
    "app/platform/ai_sdk/runtime/state.py",
    "app/platform/ai_sdk/runtime/budget.py",
    "app/platform/ai_sdk/runtime/feedback.py",
    "app/platform/ai_sdk/runtime/ports.py",
    "app/platform/ai_sdk/tools/models.py",
    "app/platform/ai_sdk/tools/registry.py",
    "app/platform/ai_sdk/tools/validation.py",
]

OBJ = {"type": "object", "properties": {"key": {"type": "string"}}, "required": ["key"]}
LOOKUP = {"name": "lookup", "description": "Lookup", "input_schema": OBJ, "retry_safe": True, "idempotent": True}
WRITE = {"name": "write", "description": "Write", "input_schema": {"type": "object"}}
FLAKY = {"name": "flaky", "description": "Flaky", "input_schema": {"type": "object"}, "retry_safe": True,
         "idempotent": True}
TYPED = {"name": "typed", "description": "Typed output", "input_schema": {"type": "object"},
         "output_schema": {"type": "object", "properties": {"n": {"type": "integer"}}, "required": ["n"]},
         "retry_safe": True, "idempotent": True}
USER = [{"role": "user", "content": "lookup"}]


def call(call_id, name, args="{}"):
    return [call_id, name, args]


def reply(content="", calls=(), usage=None, finish="stop", **extra):
    return {"content": content, "tool_calls": list(calls), "usage": usage, "finish_reason": finish, **extra}


def ok(output, artifacts=()):
    return {"success": output, "artifacts": list(artifacts)}


def fail(code, message, retryable=False):
    return {"failure": [code, message, retryable]}


def step(responses=(), handlers=None, interrupt=(), resume=None, command=None, limits=None, messages=USER,
         run_id="run-1", model="m", context="ctx", select=None):
    return {"messages": messages, "run_id": run_id, "model": model, "context": context, "limits": limits or {},
            "responses": list(responses), "handlers": handlers or {}, "interrupt": list(interrupt),
            "resume": resume, "command": command, "select": select}


def scenario(name, tools, steps, **options):
    return {"id": name, "tools": tools, "steps": steps, **options}


def cp(messages, phase="model_completed", **fields):
    base = {"run_id": "run-1", "model": "m", "phase": phase, "messages": messages, "round_count": 1,
            "tool_attempts": 0, "tool_output_chars": 0, "total_tokens": 0, "total_cost": None,
            "usage_available": False, "cost_available": False, "pending": None, "completed_tool_call_ids": [],
            "artifacts": [], "exhausted": False, "sequence": 3, "interruption_reason": None,
            "continuation_omitted": False, "external_operation_id": None}
    base.update(fields)
    return {"checkpoint": base}


def msg(role, content=None, calls=(), tool_call_id=None, name=None):
    return {"role": role, "content": content,
            "tool_calls": [{"id": i, "name": n, "arguments_json": a, "type": "function"} for i, n, a in calls],
            "tool_call_id": tool_call_id, "name": name}


def pending(call_id, name, arguments=None, attempt=0):
    return {"call_id": call_id, "name": name, "arguments": arguments or {}, "attempt": attempt}


ASK = msg("user", "lookup")
BATCH = msg("assistant", None, [("c1", "lookup", '{"key":"x"}'), ("c2", "lookup", '{"key":"y"}')])
U6 = [4, 2, 6, "provider_usage"]


def scenarios():
    s = []
    s.append(scenario("text-only", [], [step([reply("answer", usage=U6)])], usage_sink={"cost_per_1k": None}))
    s.append(scenario("tool-round-trip", [LOOKUP], [step([
        reply("", [call("c1", "lookup", '{"key":"x"}')]),
        reply("final", usage=[10, 5, 15, "provider_usage"])],
        handlers={"lookup": [ok({"value": "x"}, [["lookup", {"key": "x"}, None]])]}, limits={"max_rounds": 3})],
        usage_sink={"cost_per_1k": 0.5}))
    s.append(scenario("nested-arguments", [{"name": "nested", "description": "Nested", "input_schema": {
        "type": "object", "properties": {"items": {"type": "array", "items": {"type": "object", "properties": {
            "n": {"type": "number"}}}}}}}], [step([
        reply("", [call("c1", "nested", '{"items":[{"n":1},{"n":2.5}],"extra":[[1,[2]],{"k":null}]}')]),
        reply("done")], handlers={"nested": [ok({"echo": [1, 2.5, "中文", None, True], "f": 2.0})]})]))
    s.append(scenario("argument-failures", [LOOKUP, {"name": "strict", "description": "Strict", "input_schema": {
        "type": "object", "additionalProperties": False, "properties": {
            "mode": {"enum": ["a", 1, True]}, "size": {"type": ["integer", "null"], "minimum": 1, "maximum": 3},
            "tags": {"type": "array", "items": {"type": "string", "minLength": 2, "maxLength": 3}},
            "ratio": {"type": "number", "minimum": 0.5}, "flag": {"type": "boolean"}, "obj": {"type": "object"},
            "nil": {"type": "null"}, "any": {"type": "mystery"}}}}], [step([
        reply("", [call("c1", "lookup", "not json"), call("c2", "lookup", "[1,2]"), call("c3", "lookup", '{"key":3}'),
                   call("c4", "lookup", ""), call("c5", "strict",
                   '{"mode":"b","size":4,"tags":["x","abcd","ok",5],"ratio":0.25,"flag":1,"obj":[],"nil":0,'
                   '"any":1,"zzz":1}'),
                   call("c6", "strict", '{"mode":1.0,"size":2.0,"tags":["😀😀"],"ratio":1,"flag":false,"obj":{},'
                   '"nil":null}'),
                   call("c7", "strict", '{"mode":true,"size":null,"tags":["𠀀𠀀𠀀"]}'), call("c8", "strict", '{"mode":2}'),
                   call("c9", "missing")]),
        reply("ok")], handlers={"strict": [ok({})]})]))
    s.append(scenario("unicode-key-arguments", [LOOKUP], [step([
        reply("", [call("c1", "lookup", '{"key":"中文\\u0000😀"}')]), reply("done")],
        handlers={"lookup": [ok({"v": "中文\u0000😀 "})]})]))
    s.append(scenario("retry-then-success", [FLAKY], [step([reply("", [call("c1", "flaky")]), reply("done")],
        handlers={"flaky": [fail("busy", "try later", True), ok({"ok": True})]})]))
    s.append(scenario("retry-exhausted", [FLAKY], [step([reply("", [call("c1", "flaky")]), reply("done")],
        handlers={"flaky": [fail("busy", "1", True), fail("busy", "2", True)]})]))
    s.append(scenario("retry-three-attempts", [FLAKY], [step([reply("", [call("c1", "flaky")]), reply("done")],
        handlers={"flaky": [fail("busy", "1", True), fail("busy", "2", True), ok({"third": 3})]})],
        policy={"max_tool_attempts": 3}))
    s.append(scenario("no-retry-not-idempotent", [{**FLAKY, "idempotent": False}], [step([
        reply("", [call("c1", "flaky")]), reply("done")], handlers={"flaky": [fail("busy", "x", True)]})]))
    s.append(scenario("handler-raises", [WRITE], [step([reply("", [call("c1", "write")]), reply("done")],
        handlers={"write": [{"raise": "boom"}]})]))
    s.append(scenario("invalid-output", [TYPED], [step([reply("", [call("c1", "typed"), call("c2", "typed"), call("c3", "typed")]),
        reply("done")], handlers={"typed": [ok({"n": 1.5}), ok({"n": "x"}), ok({"n": 2})]})]))
    s.append(scenario("policy-deny", [LOOKUP, WRITE], [step([
        reply("", [call("c1", "write"), call("c2", "lookup", '{"key":"k"}')]), reply("done")],
        handlers={"lookup": [ok({"v": 1})]})], policy={"deny": {"write": "read only"}}))
    s.append(scenario("policy-deny-default-reason", [WRITE], [step([reply("", [call("c1", "write")]),
        reply("done")])], policy={"deny": {"write": None}}))
    s.append(scenario("tool-not-selected", [LOOKUP, WRITE], [step([
        reply("", [call("c1", "write"), call("c2", "lookup", '{"key":"k"}')]), reply("", [call("c3", "write")]),
        reply("done")], handlers={"lookup": [ok({"v": 1})], "write": [ok({"w": 1})]},
        select=[["lookup"], ["lookup", "write"]])]))
    s.append(scenario("duplicate-call-ids", [LOOKUP], [step([
        reply("", [call("c1", "lookup", '{"key":"a"}'), call("c1", "lookup", '{"key":"b"}')]), reply("done")],
        handlers={"lookup": [ok({"v": "a"})]})]))
    s.append(scenario("call-budget", [LOOKUP], [step([
        reply("", [call("c1", "lookup", '{"key":"a"}'), call("c2", "lookup", '{"key":"b"}')]), reply("done")],
        handlers={"lookup": [ok({"v": 1})]}, limits={"max_tool_calls": 1})]))
    s.append(scenario("output-budget", [LOOKUP], [step([
        reply("", [call("c1", "lookup", '{"key":"a"}'), call("c2", "lookup", '{"key":"b"}')]), reply("done")],
        handlers={"lookup": [ok({"v": "𠀀" * 30}), ok({"v": "y" * 10})]},
        limits={"max_tool_output_chars": 60, "final_message": "收尾"})]))
    s.append(scenario("output-budget-exact", [LOOKUP], [step([
        reply("", [call("c1", "lookup", '{"key":"a"}')]), reply("done")], handlers={"lookup": [ok({"v": "abc"})]},
        limits={"max_tool_output_chars": 32})]))
    s.append(scenario("token-budget", [LOOKUP], [step([
        reply("", [call("c1", "lookup", '{"key":"a"}')], usage=[50, 50, 100, "provider_usage"]),
        reply("wrapped", usage=[1, 1, 2, "provider_usage"])], limits={"max_tokens": 100})]))
    s.append(scenario("token-budget-unavailable-usage", [LOOKUP], [step([
        reply("", [call("c1", "lookup", '{"key":"a"}')], usage=[50, 50, 100, "unavailable"]),
        reply("plain")], handlers={"lookup": [ok({"v": 1})]}, limits={"max_tokens": 100})]))
    s.append(scenario("cost-budget", [LOOKUP], [step([
        reply("", [call("c1", "lookup", '{"key":"a"}')], usage=[500, 500, 1000, "provider_usage"]),
        reply("", [call("c2", "lookup", '{"key":"b"}')], usage=[500, 500, 1000, "provider_usage"]), reply("over")],
        handlers={"lookup": [ok({"v": 1})]},
        limits={"max_cost": 0.75})], usage_sink={"cost_per_1k": 0.375}))
    s.append(scenario("final-round-withdraws", [LOOKUP], [step([
        reply("", [call("c1", "lookup", '{"key":"a"}')]), reply("last words")],
        handlers={"lookup": [ok({"v": 1})]}, limits={"max_rounds": 2})]))
    s.append(scenario("final-message-not-duplicated", [LOOKUP], [step([reply("only")],
        messages=USER + [{"role": "system", "content": "收尾"}], limits={"max_rounds": 1, "final_message": "收尾"})]))
    s.append(scenario("tool-after-withdrawal", [LOOKUP], [step([reply("", [call("c1", "lookup", '{"key":"a"}')])],
        limits={"max_rounds": 1})]))
    s.append(scenario("truncated", [LOOKUP], [step([reply("partial", [call("c1", "lookup", '{"key":"a"}')],
        usage=[3, 4, 7, "provider_usage"], finish="length")])]))
    s.append(scenario("content-filter", [], [step([reply("", usage=[3, 0, 3, "provider_usage"],
        finish="content_filter")])]))
    s.append(scenario("provider-error", [], [step([{"provider_error": {
        "category": "rate_limit", "message": "Slow down.", "usage": [5, 0, 5, "provider_usage"]}}])],
        usage_sink={"cost_per_1k": 1.0}))
    s.append(scenario("provider-error-no-usage", [], [step([{"provider_error": {
        "category": "timeout", "message": "Timed out.", "usage": None}}])]))
    s.append(scenario("generic-exception", [], [step([{"raise": "socket gone", "usage": [7, 1, 8, "provider_usage"]}])]))
    s.append(scenario("generic-exception-plain", [], [step([{"raise": "plain", "usage": None}])]))
    s.append(scenario("continuation-preserved", [LOOKUP], [step([
        reply("", [call("c1", "lookup", '{"key":"a"}')], continuation={"provider": "anthropic", "state": {
            "blocks": [{"type": "thinking", "signature": "sig"}]}}), reply("done")],
        handlers={"lookup": [ok({"v": 1})]})]))
    s.append(scenario("metadata-messages", [], [step([reply("ok")], messages=[
        {"role": "system", "content": "sys", "cache_control": {"type": "ephemeral"}},
        {"role": "user", "content": None, "name": "author"},
        {"role": "assistant", "content": "prev", "tool_calls": [{"id": "old", "type": "function", "function": {
            "name": "lookup", "arguments": "{}"}}]},
        {"role": "tool", "content": "{}", "tool_call_id": "old"}])]))
    # Interruption boundaries (sticky reasons, like the live control owner).
    for boundary in ["before_round:1", "before_model_dispatch", "after_model", "before_tool_dispatch",
                     "after_tool_policy", "before_tool_attempt", "after_tool"]:
        s.append(scenario(f"interrupt-{boundary}", [LOOKUP], [step([
            reply("", [call("c1", "lookup", '{"key":"a"}')]), reply("done")],
            handlers={"lookup": [ok({"v": 1})]}, interrupt=[{"on": "boundary", "match": boundary,
                                                               "reason": "paused"}])]))
    s.append(scenario("interrupt-second-before-tool-dispatch", [LOOKUP], [step([
        reply("", [call("c1", "lookup", '{"key":"a"}')]), reply("done")], handlers={"lookup": [ok({"v": 1})]},
        interrupt=[{"on": "boundary", "match": "before_tool_dispatch", "nth": 2, "reason": "stopped"}])]))
    s.append(scenario("interrupt-model-error", [], [step([{"provider_error": {
        "category": "connection", "message": "Lost.", "usage": None}}],
        interrupt=[{"on": "boundary", "match": "model_error", "reason": "stopped"}])]))
    s.append(scenario("interrupt-generic-model-error", [], [step([{"raise": "gone", "usage": U6}],
        interrupt=[{"on": "boundary", "match": "model_error", "reason": "paused"}])], usage_sink={"cost_per_1k": 2.0}))
    s.append(scenario("interrupt-tool-error", [WRITE], [step([reply("", [call("c1", "write")]), reply("x")],
        handlers={"write": [{"raise": "cancelled"}]},
        interrupt=[{"on": "boundary", "match": "tool_error", "reason": "stopped"}])]))
    s.append(scenario("interrupt-retry-attempt", [FLAKY], [step([reply("", [call("c1", "flaky")]), reply("x")],
        handlers={"flaky": [fail("busy", "1", True)]},
        interrupt=[{"on": "boundary", "match": "before_tool_attempt", "nth": 2, "reason": "paused"}])]))
    s.append(scenario("interrupt-retry-dispatch", [FLAKY], [step([reply("", [call("c1", "flaky")]), reply("x")],
        handlers={"flaky": [fail("busy", "1", True)]},
        interrupt=[{"on": "boundary", "match": "before_tool_dispatch", "nth": 3, "reason": "paused"}])]))
    s.append(scenario("interrupt-after-failed-tool", [FLAKY], [step([reply("", [call("c1", "flaky")]), reply("x")],
        handlers={"flaky": [fail("busy", "1", True)]},
        interrupt=[{"on": "boundary", "match": "after_tool", "reason": "paused"}])]))
    s.append(scenario("interrupt-after-reject", [LOOKUP], [step([reply("", [call("c1", "lookup", "bad")]),
        reply("x")], interrupt=[{"on": "boundary", "match": "after_tool", "reason": "stopped"}])]))
    s.append(scenario("interrupt-on-event", [LOOKUP], [step([reply("", [call("c1", "lookup", '{"key":"a"}')]),
        reply("x")], handlers={"lookup": [ok({"v": 1})]},
        interrupt=[{"on": "event", "match": "tool_started", "reason": "stopped"}])]))
    s.append(scenario("interrupt-on-model-started", [], [step([reply("x")],
        interrupt=[{"on": "event", "match": "model_started", "reason": "stopped"}])]))
    s.append(scenario("interrupt-on-save", [LOOKUP], [step([reply("", [call("c1", "lookup", '{"key":"a"}')]),
        reply("x")], handlers={"lookup": [ok({"v": 1})]},
        interrupt=[{"on": "save", "match": "model_completed", "reason": "paused"}])]))
    s.append(scenario("interrupt-on-select", [LOOKUP], [step([reply("x")],
        interrupt=[{"on": "select", "nth": 1, "reason": "stopped"}])]))
    # Pause -> resume / stop cycles through the shared checkpoint store.
    s.append(scenario("pause-resume-before-model", [LOOKUP], [
        step([], interrupt=[{"on": "boundary", "match": "before_model_dispatch", "reason": "paused"}]),
        step([reply("", [call("c1", "lookup", '{"key":"a"}')]), reply("resumed")],
             handlers={"lookup": [ok({"v": 1})]}, resume="store", command="continue")]))
    s.append(scenario("pause-without-command", [LOOKUP], [
        step([], interrupt=[{"on": "boundary", "match": "before_round:1", "reason": "paused"}]),
        step([], resume="store")]))
    s.append(scenario("stopped-cannot-resume", [LOOKUP], [
        step([], interrupt=[{"on": "boundary", "match": "before_round:1", "reason": "stopped"}]),
        step([], resume="store", command="continue")]))
    s.append(scenario("pause-after-model-resumes-calls", [LOOKUP], [
        step([reply("", [call("c1", "lookup", '{"key":"a"}'), call("c2", "lookup", '{"key":"b"}')])],
             handlers={"lookup": [ok({"v": "a"})]},
             interrupt=[{"on": "boundary", "match": "before_tool_dispatch", "nth": 3, "reason": "paused"}]),
        step([reply("both done")], handlers={"lookup": [ok({"v": "b"})]}, resume="store", command="continue")]))
    s.append(scenario("pause-mid-tool-resumes-idempotent", [LOOKUP], [
        step([reply("", [call("c1", "lookup", '{"key":"a"}')])], handlers={"lookup": [{"raise": "cut"}]},
             interrupt=[{"on": "boundary", "match": "tool_error", "reason": "paused"}]),
        step([reply("after")], handlers={"lookup": [ok({"v": "again"})]}, resume="store", command="continue")]))
    s.append(scenario("pause-mid-tool-not-idempotent", [WRITE], [
        step([reply("", [call("c1", "write")])], handlers={"write": [{"raise": "cut"}]},
             interrupt=[{"on": "boundary", "match": "tool_error", "reason": "paused"}]),
        step([], resume="store", command="continue")]))
    s.append(scenario("pause-mid-tool-not-selected", [LOOKUP], [
        step([reply("", [call("c1", "lookup", '{"key":"a"}')])], handlers={"lookup": [{"raise": "cut"}]},
             interrupt=[{"on": "boundary", "match": "tool_error", "reason": "paused"}]),
        step([], resume="store", command="continue", select=[[]])]))
    s.append(scenario("pause-mid-tool-policy-refuses", [LOOKUP], [
        step([reply("", [call("c1", "lookup", '{"key":"a"}')])], handlers={"lookup": [{"raise": "cut"}]},
             interrupt=[{"on": "boundary", "match": "tool_error", "reason": "paused"}]),
        step([], resume="store", command="continue")], policy={"can_resume": False}))
    s.append(scenario("pause-after-policy-reprepares", [LOOKUP], [
        step([reply("", [call("c1", "lookup", '{"key":"a"}')])],
             interrupt=[{"on": "boundary", "match": "after_tool_policy", "reason": "paused"}]),
        step([reply("fine")], handlers={"lookup": [ok({"v": 1})]}, resume="store", command="continue")]))
    s.append(scenario("roundtrip-continuation-omitted", [LOOKUP], [
        step([reply("", [call("c1", "lookup", '{"key":"a"}')], continuation={"provider": "gemini", "state": {
            "signature": "s"}})], handlers={"lookup": [ok({"v": 1})]},
             interrupt=[{"on": "boundary", "match": "after_tool", "reason": "paused"}]),
        step([], resume="store_roundtrip", command="continue")]))
    s.append(scenario("roundtrip-plain-resume", [LOOKUP], [
        step([reply("", [call("c1", "lookup", '{"key":"a"}')])], handlers={"lookup": [ok({"v": 1})]},
             interrupt=[{"on": "boundary", "match": "after_tool", "reason": "paused"}]),
        step([reply("back")], resume="store_roundtrip", command="continue")], usage_sink={"cost_per_1k": 0.1}))
    s.append(scenario("resume-identity-mismatch", [LOOKUP], [
        step([], interrupt=[{"on": "boundary", "match": "before_round:1", "reason": "paused"}]),
        step([], resume="store", command="continue", run_id="run-2")]))
    s.append(scenario("resume-model-mismatch", [LOOKUP], [
        step([], interrupt=[{"on": "boundary", "match": "before_round:1", "reason": "paused"}]),
        step([], resume="store", command="continue", model="other")]))
    # Crafted checkpoints for the remaining recovery branches.
    s.append(scenario("resume-failed-phase", [LOOKUP], [step([], resume=cp([ASK], phase="failed"),
                                                              command="continue")]))
    s.append(scenario("resume-older-unknown", [LOOKUP], [step([], resume=cp([
        ASK, msg("assistant", None, [("old", "lookup", '{"key":"o"}')]), msg("user", "again"), BATCH],
        round_count=2), command="continue")]))
    s.append(scenario("resume-round-zero-active", [LOOKUP], [step([], resume=cp([ASK, BATCH], round_count=0),
                                                                   command="continue")]))
    s.append(scenario("resume-pending-outside-batch", [LOOKUP], [step([], resume=cp(
        [ASK, BATCH], pending=pending("zz", "lookup", {"key": "z"})), command="continue")]))
    s.append(scenario("resume-pending-unregistered", [LOOKUP], [step([], resume=cp(
        [ASK, msg("assistant", None, [("c1", "gone", "{}")])], pending=pending("c1", "gone")), command="continue")]))
    s.append(scenario("resume-model-completed-batch", [LOOKUP], [step([reply("all done")],
        handlers={"lookup": [ok({"v": "x"}), ok({"v": "y"})]}, resume=cp([ASK, BATCH]), command="continue")]))
    s.append(scenario("resume-partially-completed", [LOOKUP], [step([reply("rest done")],
        handlers={"lookup": [ok({"v": "y"})]}, resume=cp([ASK, BATCH, msg("tool", "{}", tool_call_id="c1")],
                                                       completed_tool_call_ids=["c1"], phase="after_tool"),
        command="continue")]))
    s.append(scenario("resume-tool-started-budget", [LOOKUP], [step([reply("fine")], resume=cp(
        [ASK, msg("assistant", None, [("c1", "lookup", '{"key":"x"}')])], phase="tool_started",
        pending=pending("c1", "lookup", {"key": "x"}, attempt=1), tool_attempts=1), command="continue",
        limits={"max_tool_calls": 1})]))
    s.append(scenario("resume-tool-started-output-budget", [LOOKUP], [step([reply("fine")], resume=cp(
        [ASK, msg("assistant", None, [("c1", "lookup", '{"key":"x"}')])], phase="tool_started",
        pending=pending("c1", "lookup", {"key": "x"}, attempt=1), tool_attempts=1, tool_output_chars=50),
        command="continue", limits={"max_tool_output_chars": 50})]))
    s.append(scenario("resume-completed-answer", [LOOKUP], [step([], resume=cp(
        [ASK, msg("assistant", "already")], phase="completed"), command="continue")]))
    s.append(scenario("resume-round-limit", [LOOKUP], [step([], resume=cp(
        [ASK, msg("assistant", None, [("c1", "lookup", '{"key":"x"}')]), msg("tool", "{}", tool_call_id="c1")],
        round_count=8, phase="after_tool", completed_tool_call_ids=["c1"]), command="continue")]))
    s.append(scenario("resume-artifacts-and-cost", [LOOKUP], [step([reply("ok", usage=U6)], resume=cp(
        [ASK], phase="before_model", round_count=0, total_tokens=10, total_cost=0.25, usage_available=True,
        cost_available=True, artifacts=[{"kind": "k", "payload": {"a": [1, {"b": 2}]}, "reference": "r"}]),
        command="continue")], usage_sink={"cost_per_1k": 0.5}))
    s.append(scenario("resume-tokens-without-usage", [LOOKUP], [step([reply("", [call("c1", "lookup", '{"key":"a"}')]),
        reply("done")], handlers={"lookup": [ok({"v": 1})]}, resume=cp([ASK], phase="before_model", round_count=0,
                                                                      total_tokens=100), command="continue",
        limits={"max_tokens": 100})]))
    s.append(scenario("resume-round-zero-answer", [LOOKUP], [step([reply("fresh")], resume=cp(
        [ASK, msg("assistant", "draft")], phase="before_model", round_count=0), command="continue")]))
    # Infrastructure failures.
    s.append(scenario("tracer-critical-failure", [], [step([reply("x")])], tracer={"fail": "runtime_started"}))
    s.append(scenario("tracer-diagnostic-failure", [], [step([reply("x")])], tracer={"fail": "model_started"}))
    s.append(scenario("tracer-diagnostic-strict", [], [step([reply("x")])], tracer={"fail": "model_started"},
                      best_effort=False))
    s.append(scenario("tracer-checkpoint-failure", [LOOKUP], [step([reply("", [call("c1", "lookup", '{"key":"a"}')]),
        reply("x")], handlers={"lookup": [ok({"v": 1})]})], tracer={"fail": "checkpoint_saved"}))
    s.append(scenario("tracer-tool-failed-failure", [LOOKUP], [step([reply("", [call("c1", "lookup", "bad")]),
        reply("x")])], tracer={"fail": "tool_failed"}))
    s.append(scenario("store-failure-first", [LOOKUP], [step([reply("", [call("c1", "lookup", '{"key":"a"}')]),
        reply("x")], handlers={"lookup": [ok({"v": 1})]})], store={"fail_nth": 1}))
    s.append(scenario("store-failure-after-trace", [LOOKUP], [step([reply("", [call("c1", "lookup", '{"key":"a"}')]),
        reply("x")], handlers={"lookup": [ok({"v": 1})]})], store={"fail_nth": 2}))
    s.append(scenario("store-failure-in-failure", [], [step([reply("", finish="length")])], store={"fail_nth": 1}))
    s.append(scenario("usage-sink-failure", [], [step([reply("x", usage=U6)])], usage_sink={"fail": True}))
    return s


def validation_cases():
    schema = {"type": "object", "additionalProperties": False, "required": ["a", "b"], "properties": {
        "a": {"type": "string", "minLength": 1, "maxLength": 2},
        "b": {"type": ["integer", "string"], "enum": [1, "x", 2.0]},
        "c": {"type": "array", "items": {"type": "object", "properties": {"d": {"type": "number", "maximum": 1}}}},
        "e": {"type": "boolean"}, "f": {"enum": [None, False, [1], {"k": 1}]}}}
    values = ['{}', '{"a":"","b":1}', '{"a":"abc","b":"x"}', '{"a":"ok","b":2}', '{"a":"ok","b":true}',
              '{"a":"ok","b":1.0}', '{"a":"ok","b":"y"}', '{"a":1,"b":3,"z":1}', '{"a":"😀😀","b":1,"c":[{"d":2},'
              '{"d":1.0},3,{"x":1}]}', '{"a":"ok","b":1,"e":0}', '{"a":"ok","b":1,"f":0}', '{"a":"ok","b":1,"f":[1.0]}',
              '{"a":"ok","b":1,"f":{"k":true}}', '{"a":"ok","b":1,"f":null}', '[]', '"s"', '1', 'null',
              '{"a":"𠀀𠀀𠀀","b":1}']
    cases = [{"value_json": value, "schema": schema} for value in values]
    cases += [{"value_json": v, "schema": sch} for v, sch in [
        ('1', {"type": "number", "minimum": 2}), ('1.5', {"type": "integer"}), ('2', {"type": "number", "maximum": 1.5}),
        ('true', {"type": "integer"}), ('true', {"type": "number"}), ('[1,"a"]', {"type": "array",
                                                                                   "items": {"type": "integer"}}),
        ('{"a":{"b":{"c":1}}}', {"properties": {"a": {"properties": {"b": {"properties": {"c": {"type": "string"}}}}}}}),
        ('"abc"', {"type": "unknown"}), ('"abc"', {"enum": "abc"}), ('"x"', {"enum": ["x"], "type": "integer"}),
        ('null', {"type": ["null", "string"]}), ('{"k":1}', {"type": "object", "required": "k"}),
        ('{"k":1}', {"type": "object", "properties": [], "additionalProperties": False}),
        ('[[1]]', {"items": {"items": {"type": "string"}}}), ('0', {"minimum": 0, "maximum": 0}),
        ('-0.0', {"type": "number", "minimum": 0}), ('1e2', {"type": "integer"}),
        ('"😀"', {"type": "string", "minLength": 2}), ('"😀😀"', {"type": "string", "maxLength": 3})]]
    return cases


def p3_sdk_runtime_snapshot() -> dict:
    with isolated_fs_oracle("storyforge-golden-sdk-") as (api, _run):
        from app.platform.ai_sdk import (
            ChatRequest,
            ChatResponse,
            ProviderContinuation,
            ProviderError,
            ProviderErrorCategory,
            ProviderErrorDetails,
            TokenUsage,
            ToolCall,
            ToolSpec,
        )
        from app.platform.ai_sdk.contracts import messages_from_openai
        from app.platform.ai_sdk.runtime import (
            DefaultRuntimePolicy,
            InMemoryCheckpointStore,
            ResumeAction,
            ResumeCommand,
            RuntimeCheckpoint,
            RuntimeLimits,
            ToolCallingRuntime,
        )
        from app.platform.ai_sdk.runtime import loop as loop_module
        from app.platform.ai_sdk.runtime.feedback import parse_tool_arguments
        from app.platform.ai_sdk.runtime.ports import PolicyDecision, PolicyDecisionKind
        from app.platform.ai_sdk.tools import (
            RuntimeArtifact,
            RuntimeTool,
            RuntimeToolResult,
            ToolRegistry,
            validate_json_schema,
        )

        class ScriptedFailure(RuntimeError):
            def __init__(self, message, usage):
                super().__init__(message)
                self.usage = usage

        def usage(spec):
            return TokenUsage() if spec is None else TokenUsage(spec[0], spec[1], spec[2], source=spec[3])

        def message_record(message):
            row = message.to_openai()
            if message.continuation is not None:
                row["continuation"] = {"provider": message.continuation.provider,
                                       "state": json.loads(json.dumps(message.continuation.state, default=dict))}
            return row

        def checkpoint_record(checkpoint):
            row = checkpoint.to_dict()
            assert row.pop("external_operation_id") is None
            return row

        def run_scenario(spec):
            store_log, events, usage_log = [], [], []
            store_options = spec.get("store") or {}
            tracer_options = spec.get("tracer") or {}
            sink_options = spec.get("usage_sink") or {}
            policy_options = spec.get("policy") or {}
            saves = {"count": 0}
            control = {"reason": None, "counts": {}}

            def trigger(kind, value):
                for index, rule in enumerate(control["rules"]):
                    if rule["on"] != kind or ("match" in rule and rule["match"] != value):
                        continue
                    key = (kind, index)
                    control["counts"][key] = control["counts"].get(key, 0) + 1
                    if control["reason"] is None and control["counts"][key] == rule.get("nth", 1):
                        control["reason"] = rule["reason"]

            class Store(InMemoryCheckpointStore):
                def save(self, checkpoint):
                    saves["count"] += 1
                    if saves["count"] == store_options.get("fail_nth"):
                        store_log.append({"failed_save": saves["count"]})
                        raise OSError("disk full")
                    store_log.append(checkpoint_record(checkpoint))
                    super().save(checkpoint)
                    trigger("save", checkpoint.phase.value)

            class Tracer:
                def emit(self, event):
                    if event.kind == tracer_options.get("fail"):
                        events.append({"failed_emit": event.kind, "sequence": event.sequence})
                        raise RuntimeError("tracer down")
                    events.append([event.sequence, event.round_number, event.kind, json.loads(json.dumps(
                        event.payload, default=dict))])
                    trigger("event", event.kind)

            class Sink:
                def record(self, run_id, round_number, value):
                    usage_log.append([run_id, round_number, value.to_legacy()])
                    if sink_options.get("fail"):
                        raise RuntimeError("ledger down")
                    cost = sink_options.get("cost_per_1k")
                    if cost is None or value.source == "unavailable":
                        return None
                    return value.total_tokens * cost / 1000

            class Policy(DefaultRuntimePolicy):
                def decide_tool(self, tool, call_value, context):
                    step_log["policy"].append([tool.spec.name, call_value.call_id, json.loads(json.dumps(
                        call_value.arguments, default=dict)), call_value.attempt, context])
                    deny = policy_options.get("deny") or {}
                    if tool.spec.name in deny:
                        return PolicyDecision(PolicyDecisionKind.DENY, deny[tool.spec.name])
                    return super().decide_tool(tool, call_value, context)

                def can_resume_started_tool(self, tool, call_value):
                    if "can_resume" in policy_options:
                        return policy_options["can_resume"]
                    return super().can_resume_started_tool(tool, call_value)

            class Selector:
                def select(self, registry, context):
                    step_log["selects"] += 1
                    trigger("select", None)
                    choices = step_spec.get("select")
                    if choices is None:
                        return registry.all()
                    names = choices[min(step_log["selects"], len(choices)) - 1]
                    return tuple(tool for tool in registry.all() if tool.spec.name in names)

            class Provider:
                def complete(self, request: ChatRequest):
                    step_log["requests"].append({"model": request.model, "messages": [
                        message_record(m) for m in request.messages], "tools": [t.to_openai() for t in request.tools]})
                    item = responses.pop(0)
                    if "provider_error" in item:
                        error = item["provider_error"]
                        raise ProviderError(ProviderErrorDetails(ProviderErrorCategory(error["category"]),
                                                                 error["message"]),
                                            usage=None if error["usage"] is None else usage(error["usage"]))
                    if "raise" in item:
                        raise ScriptedFailure(item["raise"], None if item["usage"] is None else usage(item["usage"]))
                    continuation = item.get("continuation")
                    return ChatResponse(
                        item["content"], tool_calls=tuple(ToolCall(*c) for c in item["tool_calls"]),
                        usage=usage(item["usage"]), finish_reason=item["finish_reason"],
                        continuation=None if continuation is None else ProviderContinuation(
                            continuation["provider"], continuation["state"]))

            def handler_for(name):
                def handler(context, arguments):
                    step_log["handlers"].append([name, arguments, context])
                    item = step_spec["handlers"][name].pop(0)
                    if "raise" in item:
                        raise RuntimeError(item["raise"])
                    if "failure" in item:
                        return RuntimeToolResult.failure(*item["failure"][:2], retryable=item["failure"][2])
                    return RuntimeToolResult.success(item["success"], artifacts=tuple(
                        RuntimeArtifact(kind, payload, ref) for kind, payload, ref in item["artifacts"]))
                return handler

            tools = ToolRegistry([RuntimeTool(
                ToolSpec(t["name"], t["description"], t["input_schema"]), handler_for(t["name"]),
                output_schema=t.get("output_schema") or {}, retry_safe=t.get("retry_safe", False),
                idempotent=t.get("idempotent", False)) for t in spec["tools"]])
            store = Store()
            steps = []
            for step_spec in spec["steps"]:
                step_spec = json.loads(json.dumps(step_spec))
                step_log = {"requests": [], "handlers": [], "policy": [], "selects": 0, "interruptions": []}
                events.clear()
                store_log.clear()
                usage_log.clear()
                control.update(reason=None, counts={}, rules=step_spec["interrupt"])
                responses = step_spec["responses"]

                def interruption(run_id, boundary, checkpoint, step_log=step_log):
                    trigger("boundary", boundary)
                    step_log["interruptions"].append([run_id, boundary, checkpoint.phase.value, checkpoint.round_count,
                                                      checkpoint.sequence, checkpoint.tool_attempts,
                                                      None if checkpoint.pending is None else [
                                                          checkpoint.pending.call_id, checkpoint.pending.attempt],
                                                      control["reason"]])
                    return control["reason"]

                resume = step_spec["resume"]
                if resume == "store" or resume == "store_roundtrip":
                    resume_state = store.load(spec["steps"][0]["run_id"])
                    if resume == "store_roundtrip":
                        resume_state = RuntimeCheckpoint.from_dict(json.loads(json.dumps(resume_state.to_dict())))
                elif resume is not None:
                    resume_state = RuntimeCheckpoint.from_dict(resume["checkpoint"])
                else:
                    resume_state = None
                runtime = ToolCallingRuntime(
                    Provider(), tools, policy=Policy(max_tool_attempts=policy_options.get("max_tool_attempts", 2)),
                    selector=Selector(), tracer=Tracer(), usage_sink=Sink(), checkpoints=store,
                    interruption=interruption, diagnostic_trace_best_effort=spec.get("best_effort", True))
                row = {}
                try:
                    result = runtime.run(
                        messages_from_openai(step_spec["messages"]), model=step_spec["model"],
                        run_id=step_spec["run_id"], limits=RuntimeLimits(**step_spec["limits"]),
                        application_context=step_spec["context"], resume_state=resume_state,
                        resume_command=ResumeCommand(ResumeAction(step_spec["command"])) if step_spec["command"] else None)
                    row["result"] = {
                        "status": result.status.value, "run_id": result.run_id, "content": result.content,
                        "messages": [message_record(m) for m in result.messages],
                        "artifacts": [[a.kind, json.loads(json.dumps(a.payload, default=dict)), a.reference]
                                      for a in result.artifacts],
                        "total_tokens": result.total_tokens, "total_cost": result.total_cost,
                        "usage_available": result.usage_available, "cost_available": result.cost_available,
                        "tool_attempts": result.tool_attempts, "exhausted": result.exhausted,
                        "error_code": result.error_code, "error_message": result.error_message,
                        "checkpoint": None if result.checkpoint is None else checkpoint_record(result.checkpoint),
                        "pending_tool_call_id": result.pending_tool_call_id}
                except ScriptedFailure as error:
                    row["raised"] = str(error)
                row["unused"] = {"responses": len(responses),
                                 "handlers": {k: len(v) for k, v in sorted(step_spec["handlers"].items()) if v}}
                row.update(events=list(events), saves=list(store_log), usage=list(usage_log), **{
                    key: step_log[key] for key in ("requests", "handlers", "policy", "selects", "interruptions")})
                steps.append(row)
            return steps

        class FixedNow:
            @staticmethod
            def isoformat():
                return "2026-10-12T00:00:00+00:00"

        loop_module.datetime = type("Clock", (), {"now": staticmethod(lambda tz: FixedNow())})
        runs = [{"id": spec["id"], "spec_json": json.dumps(spec, ensure_ascii=False), "steps": run_scenario(spec)}
                for spec in scenarios()]

        validation = []
        for case in validation_cases():
            value = json.loads(case["value_json"])
            issues = validate_json_schema(value, case["schema"])
            validation.append({**case, "issues": [[list(i.path), i.code, i.message] for i in issues]})
        parse_cases = []
        lookup_tool = RuntimeTool(ToolSpec("lookup", "", OBJ), lambda c, a: None)
        for raw in ["", "{}", '{"key":"x"}', "[]", "null", "nope", '{"key":1,"x":[1]}', '"s"', "1", '{"key":"中"}']:
            parsed, failure = parse_tool_arguments(ToolCall("c", "lookup", raw), lookup_tool)
            parse_cases.append({"arguments_json": raw, "parsed": parsed, "failure": None if failure is None else [
                failure.error_code, failure.error_message]})
        limits = []
        for fields in [{"max_rounds": 0}, {"max_tool_calls": -1}, {"max_tool_output_chars": -1}, {"max_tokens": 0},
                       {"max_cost": -0.5}, {"max_rounds": 1, "max_tool_calls": 0, "max_tool_output_chars": 0,
                                            "max_tokens": 1, "max_cost": 0.0}]:
            try:
                RuntimeLimits(**fields)
                limits.append({"fields": fields, "error": None})
            except ValueError as error:
                limits.append({"fields": fields, "error": str(error)})
        return {
            "format_version": 1,
            "suite": "p3-sdk-runtime",
            "sources": {path: hashlib.sha256((api / path).read_bytes()).hexdigest() for path in SOURCES},
            "platform": "windows" if os.name == "nt" else "posix",
            "runs": runs, "validation": validation, "parse_arguments": parse_cases, "limits": limits,
        }
