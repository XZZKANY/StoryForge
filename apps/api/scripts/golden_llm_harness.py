"""Shared recorded-transport harness for the LLM client oracles: a scripted fake `urlopen` on a virtual clock.

Each scenario is `(kind, name, source, args, replies[, control])`. Replies script the transport: an HTTP status with
headers/body (or an unreadable body), a raised transport error, or a 2xx body that fails after N lines or on read.
"""

from __future__ import annotations

import base64
import email.message
import http.client
import io
import json
from types import SimpleNamespace
from urllib import error

STEP = 0.25
RANDOM = 0.375


def sse(*chunks, done=True, tail=""):
    lines = [f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n" for chunk in chunks]
    if done:
        lines.append("data: [DONE]\n\n")
    return "".join(lines) + tail


class FakeBody(io.BytesIO):
    def __init__(self, raw: bytes, fail_after: int | None, fail_with: str | None, read_raise: str | None):
        super().__init__(raw)
        self.fail_after, self.fail_with, self.read_raise, self.lines_read = fail_after, fail_with, read_raise, 0

    def read(self, *args):
        if self.read_raise:
            raise make_error(self.read_raise, "timed out")
        return super().read(*args)

    def __iter__(self):
        return self

    def __next__(self):
        if self.read_raise:
            raise make_error(self.read_raise, "timed out")
        if self.fail_after is not None and self.lines_read >= self.fail_after:
            raise make_error(self.fail_with, "timed out")
        line = self.readline()
        if not line:
            raise StopIteration
        self.lines_read += 1
        return line

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
        return False


class UnreadableBody(io.BytesIO):
    def read(self, *args):
        raise OSError("socket closed")


def make_error(name: str, reason: str):
    if name == "URLError":
        return error.URLError(reason)
    if name == "TimeoutError":
        return TimeoutError(reason)
    if name == "IncompleteRead":
        return http.client.IncompleteRead(b"")
    if name == "RemoteDisconnected":
        return http.client.RemoteDisconnected("Remote end closed connection without response")
    return ConnectionResetError(10054, "reset")


def run_recorded(scenarios, control_scenarios=()):
    """Run scenarios through the real Python client; must be called inside isolated_fs_oracle."""
    from app.common import llm_client as lc
    from app.common import llm_control
    from app.common.llm_client import LLMConfigError, LLMError
    from app.common.llm_control import LLMRunControl, LLMRunInterrupted, llm_run_control
    from app.platform.ai_sdk import contracts
    from app.platform.ai_sdk._immutability import thaw
    from app.platform.ai_sdk.errors import ProviderError
    from app.platform.ai_sdk.providers import anthropic, gemini, openai_compatible

    clock = {"now": 100.0}
    monotonic = SimpleNamespace(monotonic=lambda: clock["now"])
    for module in (lc, openai_compatible, anthropic, gemini):
        module.time = monotonic
    lc.random = lambda: RANDOM
    state = {"requests": [], "waits": [], "replies": [], "events": []}

    def fake_wait(delay):
        if delay > 0:
            state["waits"].append(delay)
            clock["now"] += delay

    lc.wait_for_retry = lambda delay: llm_control.wait_for_retry(delay) if llm_control.has_run_control() else fake_wait(delay)

    def fake_urlopen(req, timeout=None):
        clock["now"] += STEP
        body = req.data.decode("utf-8") if req.data is not None else None
        state["requests"].append({"url": req.full_url, "method": req.get_method(), "timeout": timeout,
                                  "headers": {key.lower(): value for key, value in req.header_items()},
                                  "body": body})
        reply = state["replies"].pop(0)
        if "raise" in reply:
            raise make_error(reply["raise"], reply.get("reason", ""))
        raw = base64.b64decode(reply["body_b64"]) if "body_b64" in reply else reply.get("body", "").encode()
        if reply["status"] >= 400:
            headers = email.message.Message()
            for key, value in reply.get("headers", {}).items():
                headers[key] = value
            fp = UnreadableBody(b"") if reply.get("body_unreadable") else io.BytesIO(raw)
            raise error.HTTPError(req.full_url, reply["status"], "error", headers, fp)
        return FakeBody(raw, reply.get("fail_after_lines"), reply.get("fail_with"), reply.get("read_raise"))

    lc.request.urlopen = fake_urlopen

    def legacy_usage(exc):
        usage = getattr(exc, "usage", None)
        return usage.to_legacy() if isinstance(usage, contracts.TokenUsage) else None

    def response_record(response):
        record = {"content": response.content, "finish_reason": response.finish_reason,
                  "tool_calls": [call.to_openai() for call in response.tool_calls],
                  "response_id": response.response_id, "metadata": dict(response.metadata)}
        if response.continuation is not None:
            record["continuation"] = {"provider": response.continuation.provider,
                                      "state": thaw(response.continuation.state)}
        return record

    def event_record(event):
        record = {"kind": event.kind.value}
        if event.text is not None:
            record["text"] = event.text
        if event.tool_call is not None:
            record["tool_call"] = event.tool_call.to_openai()
        if event.usage is not None:
            record["usage"] = event.usage.to_legacy()
        if event.response is not None:
            record["response"] = response_record(event.response)
        return record

    def chat_request(args):
        messages = contracts.messages_from_openai(args["messages"])
        if args.get("continuation") is not None:
            index, continuation = args["continuation"]
            message = messages[index]
            messages = (*messages[:index],
                        contracts.ChatMessage(role=message.role, content=message.content, tool_calls=message.tool_calls,
                                              tool_call_id=message.tool_call_id, name=message.name,
                                              metadata=message.metadata,
                                              continuation=contracts.ProviderContinuation(**continuation)),
                        *messages[index + 1:])
        return contracts.ChatRequest(model=args.get("model", ""), messages=messages,
                                     tools=contracts.tools_from_openai(args.get("tools")),
                                     temperature=args.get("temperature"), max_tokens=args.get("max_tokens"),
                                     tool_choice=args.get("tool_choice"), reasoning_effort=args.get("reasoning_effort"))

    def execute(kind, source, args):
        if kind == "call_llm":
            return lc.call_llm(source, system_prompt=args["system"], user_prompt=args["user"],
                               tools=args.get("tools"), tool_choice=args.get("tool_choice"))
        if kind == "call_llm_messages":
            return lc.call_llm_messages(source, messages=args["messages"], tools=args.get("tools"),
                                        tool_choice=args.get("tool_choice"), timeout_seconds=args.get("timeout_seconds"),
                                        max_attempts=args.get("max_attempts"))
        if kind == "call_llm_streamed":
            return lc.call_llm_streamed(source, system_prompt=args["system"], user_prompt=args["user"])
        if kind == "provider_stream":
            request = lc._sdk_chat_request(source, messages=args["messages"], tools=args.get("tools"),
                                           tool_choice=args.get("tool_choice"))
            for event in lc.build_llm_provider(source).stream(request):
                state["events"].append(event_record(event))
            return state["events"]
        if kind == "provider_complete":
            request = contracts.ChatRequest(model="", messages=contracts.messages_from_openai(args["messages"]),
                                            max_tokens=args.get("max_tokens"))
            response = lc.build_llm_provider(source).complete(request)
            return {"content": response.content, "usage": response.usage.to_legacy(),
                    "finish_reason": response.finish_reason, "metadata": dict(response.metadata)}
        if kind == "native_complete":
            response = lc.build_llm_provider(source).complete(chat_request(args))
            return {**response_record(response), "usage": response.usage.to_legacy()}
        if kind == "native_stream":
            for event in lc.build_llm_provider(source).stream(chat_request(args)):
                state["events"].append(event_record(event))
            return state["events"]
        return lc.fetch_provider_models(source, timeout=args["timeout"])

    def run_scenario(kind, name, source, args, replies, control=None):
        clock["now"] = 100.0
        state["requests"], state["waits"], state["replies"], state["events"] = [], [], list(replies), []
        progress, checks = [], {"n": 0}
        record = {"kind": kind, "name": name, "source": source, "args": args, "replies": replies, "control": control}
        try:
            if control is None:
                result = execute(kind, source, args)
            else:
                def check(boundary):
                    checks["n"] += 1 if boundary == "before_stream_read" else 0
                    return "stopped" if control["stop_at"] is not None and checks["n"] >= control["stop_at"] else None

                def control_wait(seconds):
                    state["waits"].append(seconds)
                    clock["now"] += seconds

                run_control = LLMRunControl(check, deadline=None if control["deadline"] is None else 100.0 + control["deadline"],
                                            on_progress=progress.append, clock=lambda: clock["now"], wait=control_wait)
                with llm_run_control(run_control):
                    result = execute(kind, source, args)
            record["result"] = json.loads(json.dumps(result, ensure_ascii=False, default=str))
        except (LLMError, LLMConfigError, LLMRunInterrupted, ValueError, error.HTTPError) as exc:
            record["error"] = {"type": type(exc).__name__,
                               "message": str(exc) if not isinstance(exc, error.HTTPError) else f"HTTP {exc.code}",
                               "usage": legacy_usage(exc),
                               "reason": getattr(exc, "reason", None) if isinstance(exc, LLMRunInterrupted) else None,
                               "usage_summary": lc.error_usage_summary(exc, source=source)
                               if isinstance(exc, LLMError) else None}
        except ProviderError as exc:
            details = exc.details
            record["error"] = {"type": "ProviderError", "message": str(exc), "usage": legacy_usage(exc),
                               "details": {"category": details.category.value, "retryable": details.retryable,
                                           "status_code": details.status_code, "provider_code": details.provider_code,
                                           "request_id": details.request_id}}
        record["requests"], record["waits"], record["progress"] = state["requests"], state["waits"], progress
        if kind in ("provider_stream", "native_stream"):
            record["events"] = state["events"]
        record["clock"] = clock["now"]
        record["unused_replies"] = len(state["replies"])
        return record

    records = [run_scenario(*scenario) for scenario in scenarios]
    records += [run_scenario(*scenario) for scenario in control_scenarios]
    return records
