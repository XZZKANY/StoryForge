from __future__ import annotations

import io
from urllib import error

import pytest
import test_llm_run_control as fixture

from app.common import llm_client
from app.common.llm_control import LLMRunControl, LLMRunInterrupted, llm_run_control
from app.platform.ai_sdk.contracts import StreamEventKind, TokenUsage

FAMILIES = fixture.FAMILIES


def usage_frame(family: str):
    if family == "anthropic":
        return {"type": "message_start", "message": {"usage": {"input_tokens": 10, "output_tokens": 2}}}
    if family == "gemini":
        return {"usageMetadata": {"promptTokenCount": 10, "candidatesTokenCount": 2, "totalTokenCount": 12}}
    return {"choices": [], "usage": {"prompt_tokens": 10, "completion_tokens": 2, "total_tokens": 12}}


def terminal_frame(family: str, reason: str):
    if family == "anthropic":
        return fixture.sse_frame(
            {
                "type": "message_delta",
                "delta": {"stop_reason": "max_tokens" if reason == "length" else "end_turn"},
                "usage": {"output_tokens": 2},
            }
        ) + fixture.sse_frame({"type": "message_stop"})
    if family == "gemini":
        return fixture.sse_frame(
            {"candidates": [{"content": {"parts": []}, "finishReason": "MAX_TOKENS" if reason == "length" else "STOP"}]}
        )
    return fixture.sse_frame({"choices": [{"delta": {}, "finish_reason": reason}]}) + b"data: [DONE]\n"


def raw_bytes(family: str, reason: str = "stop"):
    return (
        fixture.sse_frame(usage_frame(family))
        + fixture.sse_frame(fixture.first_stream_frame(family))
        + terminal_frame(family, reason)
    )


def iterator(family: str, legacy: bool):
    if not legacy:
        return fixture.provider(family, True).stream(fixture.chat_request())
    return llm_client.stream_chat_completions(
        fixture.source(family), {"model": "fixture-model", "messages": [], "stream": True}
    )


def assert_usage(exc):
    usage = getattr(exc, "usage", None)
    assert isinstance(usage, TokenUsage)
    assert usage.source == "provider_usage"
    assert (usage.input_tokens, usage.output_tokens, usage.total_tokens) == (10, 2, 12)
    assert fixture.SECRET not in repr(usage)
    assert "prefix" not in repr(usage)


@pytest.mark.parametrize("family", FAMILIES)
@pytest.mark.parametrize("legacy", [False, True])
@pytest.mark.parametrize("failure", ["cancel", "read"])
def test_received_partial_usage_survives_stream_failure(monkeypatch, family, legacy, failure):
    stopped = False
    calls = []

    class Response(io.BytesIO):
        def __next__(self):
            line = super().__next__()
            if line == b"broken\n":
                raise ConnectionResetError("fixture-only")
            return line

    response = Response(
        raw_bytes(family)
        if failure == "cancel"
        else fixture.sse_frame(usage_frame(family))
        + fixture.sse_frame(fixture.first_stream_frame(family))
        + b"broken\n"
    )

    def urlopen(*args, **kwargs):
        calls.append(1)
        return response

    monkeypatch.setattr(llm_client.request, "urlopen", urlopen)
    received = []
    with (
        llm_run_control(LLMRunControl(lambda _: "stopped" if stopped else None)),
        pytest.raises(LLMRunInterrupted if failure == "cancel" else llm_client.LLMError) as caught,
    ):
        for event in iterator(family, legacy):
            received.append(event)
            text = event.get("text") if legacy else event.text
            if text and failure == "cancel":
                stopped = True
    assert_usage(caught.value)
    assert len(calls) == 1
    assert response.closed
    assert not any(
        event.get("type") == "done" if legacy else event.kind is StreamEventKind.COMPLETED for event in received
    )


@pytest.mark.parametrize("family", FAMILIES)
def test_length_cannot_become_a_finished_manuscript_but_retains_usage(monkeypatch, family):
    response = io.BytesIO(raw_bytes(family, "length"))
    monkeypatch.setattr(llm_client.request, "urlopen", lambda *args, **kwargs: response)
    with pytest.raises(llm_client.LLMError) as caught:
        llm_client.call_llm_streamed(fixture.source(family), system_prompt="system", user_prompt="prompt")
    assert_usage(caught.value)
    assert response.closed


@pytest.mark.parametrize("family", FAMILIES)
def test_typed_stream_preserves_length_finish_reason_and_usage(monkeypatch, family):
    monkeypatch.setattr(llm_client.request, "urlopen", lambda *args, **kwargs: io.BytesIO(raw_bytes(family, "length")))
    events = list(iterator(family, False))
    final = events[-1]
    assert final.kind is StreamEventKind.COMPLETED
    assert final.finish_reason == "length"
    assert final.usage.total_tokens == 12


@pytest.mark.parametrize("family", FAMILIES)
def test_usage_returning_during_cancelled_read_is_retained_without_delivering_text(monkeypatch, family):
    stopped = False

    class Response(io.BytesIO):
        def __next__(self):
            nonlocal stopped
            line = super().__next__()
            stopped = True
            return line

    first = usage_frame(family)
    if family == "gemini":
        first.update(fixture.first_stream_frame(family))
    elif family == "openai-compatible":
        first["choices"] = [{"delta": {"content": "must-not-deliver"}}]
    response = Response(fixture.sse_frame(first))
    monkeypatch.setattr(llm_client.request, "urlopen", lambda *args, **kwargs: response)
    with (
        llm_run_control(LLMRunControl(lambda _: "stopped" if stopped else None)),
        pytest.raises(LLMRunInterrupted) as caught,
    ):
        list(iterator(family, False))
    assert_usage(caught.value)
    assert response.closed


@pytest.mark.parametrize("family", FAMILIES)
def test_sequential_complete_stream_and_retry_share_one_deadline(monkeypatch, family):
    clock = fixture.Clock()
    calls = []

    def urlopen(*args, timeout, **kwargs):
        calls.append(timeout)
        clock.now += 0.25
        if len(calls) == 2:
            raise error.HTTPError("https://fixture.invalid", 503, "retry", {"Retry-After": "0"}, io.BytesIO())
        return fixture.response_for(family, streaming=len(calls) == 3)

    monkeypatch.setattr(llm_client.request, "urlopen", urlopen)
    control = LLMRunControl(lambda _: None, deadline=11.0, clock=clock, wait=clock.wait)
    with llm_run_control(control):
        fixture.invoke(family)
        list(iterator(family, False))
        fixture.invoke(family)
        with pytest.raises(LLMRunInterrupted) as caught:
            fixture.invoke(family)
    assert caught.value.reason == "deadline_exceeded"
    assert calls == pytest.approx([1.0, 0.75, 0.5, 0.25])


@pytest.mark.parametrize("family", FAMILIES)
def test_stream_without_usage_does_not_fabricate_partial_accounting(monkeypatch, family):
    class Response(io.BytesIO):
        def __next__(self):
            line = super().__next__()
            if line == b"broken\n":
                raise ConnectionResetError("fixture-only")
            return line

    monkeypatch.setattr(
        llm_client.request,
        "urlopen",
        lambda *a, **kw: Response(fixture.sse_frame(fixture.first_stream_frame(family)) + b"broken\n"),
    )
    with pytest.raises(llm_client.LLMError) as caught:
        list(iterator(family, False))
    assert getattr(caught.value, "usage", None) is None


@pytest.mark.parametrize("family", FAMILIES)
def test_missing_terminal_after_known_usage_is_failure_not_completion(monkeypatch, family):
    monkeypatch.setattr(
        llm_client.request,
        "urlopen",
        lambda *a, **kw: io.BytesIO(
            fixture.sse_frame(usage_frame(family)) + fixture.sse_frame(fixture.first_stream_frame(family))
        ),
    )
    with pytest.raises(llm_client.LLMError) as caught:
        list(iterator(family, True))
    assert_usage(caught.value)


def test_empty_later_usage_does_not_erase_openai_reported_accounting(monkeypatch):
    family = "openai-compatible"
    data = fixture.sse_frame(usage_frame(family)) + fixture.sse_frame(fixture.first_stream_frame(family))
    data += fixture.sse_frame({"choices": [], "usage": {}}) + terminal_frame(family, "stop")
    monkeypatch.setattr(llm_client.request, "urlopen", lambda *a, **kw: io.BytesIO(data))
    events = list(iterator(family, False))
    assert events[-1].response.usage.total_tokens == 12
    assert events[-1].response.usage.source == "provider_usage"


@pytest.mark.parametrize("family", FAMILIES)
def test_empty_usage_object_is_not_reported_zero_spend(monkeypatch, family):
    frame = usage_frame(family)
    if family == "anthropic":
        frame["message"]["usage"] = {}
    elif family == "gemini":
        frame["usageMetadata"] = {}
    else:
        frame["usage"] = {}

    class Response(io.BytesIO):
        def __next__(self):
            line = super().__next__()
            if line == b"broken\n":
                raise ConnectionResetError("fixture-only")
            return line

    monkeypatch.setattr(
        llm_client.request, "urlopen", lambda *a, **kw: Response(fixture.sse_frame(frame) + b"broken\n")
    )
    with pytest.raises(llm_client.LLMError) as caught:
        list(iterator(family, False))
    assert getattr(caught.value, "usage", None) is None


@pytest.mark.parametrize("family", FAMILIES)
@pytest.mark.parametrize("messages", [False, True])
def test_nonstream_legacy_completion_cannot_deliver_length_as_success(monkeypatch, family, messages):
    import json

    data = fixture.completion(family)
    if family == "anthropic":
        data["stop_reason"] = "max_tokens"
    elif family == "gemini":
        data["candidates"][0]["finishReason"] = "MAX_TOKENS"
    else:
        data["choices"][0]["finish_reason"] = "length"
    monkeypatch.setattr(llm_client.request, "urlopen", lambda *a, **kw: io.BytesIO(json.dumps(data).encode()))
    with pytest.raises(llm_client.LLMError) as caught:
        if messages:
            llm_client.call_llm_messages(fixture.source(family), messages=[{"role": "user", "content": "fixture"}])
        else:
            llm_client.call_llm(fixture.source(family), system_prompt="fixture", user_prompt="fixture")
    assert_usage(caught.value)


@pytest.mark.parametrize("family", FAMILIES)
def test_explicit_zero_usage_remains_known_provider_accounting(monkeypatch, family):
    frame = usage_frame(family)
    usage = (
        frame["message"]["usage"]
        if family == "anthropic"
        else frame["usageMetadata" if family == "gemini" else "usage"]
    )
    for key in usage:
        usage[key] = 0

    class Response(io.BytesIO):
        def __next__(self):
            line = super().__next__()
            if line == b"broken\n":
                raise ConnectionResetError("fixture-only")
            return line

    monkeypatch.setattr(
        llm_client.request, "urlopen", lambda *a, **kw: Response(fixture.sse_frame(frame) + b"broken\n")
    )
    with pytest.raises(llm_client.LLMError) as caught:
        list(iterator(family, False))
    assert caught.value.usage.source == "provider_usage"
    assert caught.value.usage.total_tokens == 0
