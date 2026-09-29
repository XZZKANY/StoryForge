from __future__ import annotations

import io
import json
from urllib import error

import pytest

from app.common import llm_client
from app.common.llm_control import (
    LLMRunControl,
    LLMRunInterrupted,
    has_run_control,
    llm_run_control,
    request_timeout,
    wait_for_retry,
)
from app.platform.ai_sdk.contracts import ChatMessage, ChatRequest, MessageRole, StreamEventKind
from app.platform.ai_sdk.errors import ProviderError

FAMILIES = ("openai-compatible", "anthropic", "gemini")
SECRET = "fixture-only-secret-726"


class Clock:
    def __init__(self) -> None:
        self.now = 10.0
        self.waits: list[float] = []

    def __call__(self) -> float:
        return self.now

    def wait(self, seconds: float) -> None:
        self.waits.append(seconds)
        self.now += seconds


def source(family: str) -> dict[str, str]:
    return {
        "STORYFORGE_LLM_PROVIDER": family,
        "STORYFORGE_LLM_BASE_URL": "https://fixture.invalid/v1",
        "STORYFORGE_LLM_MODEL": "fixture-model",
        "STORYFORGE_LLM_API_KEY": SECRET,
        "STORYFORGE_LLM_TIMEOUT_SECONDS": "90",
        "STORYFORGE_LLM_RETRY_MAX_ATTEMPTS": "3",
        "STORYFORGE_LLM_RETRY_BASE_DELAY_SECONDS": "0.5",
        "STORYFORGE_LLM_RETRY_JITTER_SECONDS": "0",
    }


def chat_request() -> ChatRequest:
    return ChatRequest(
        model="fixture-model",
        messages=(ChatMessage(role=MessageRole.USER, content="private fixture prose"),),
    )


def completion(family: str) -> dict[str, object]:
    if family == "anthropic":
        return {
            "content": [{"type": "text", "text": "result"}],
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 10, "output_tokens": 2},
        }
    if family == "gemini":
        return {
            "candidates": [{"content": {"parts": [{"text": "result"}]}, "finishReason": "STOP"}],
            "usageMetadata": {"promptTokenCount": 10, "candidatesTokenCount": 2, "totalTokenCount": 12},
        }
    return {
        "choices": [{"message": {"role": "assistant", "content": "result"}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 2, "total_tokens": 12},
    }


def first_stream_frame(family: str) -> dict[str, object]:
    if family == "anthropic":
        return {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "prefix"}}
    if family == "gemini":
        return {"candidates": [{"content": {"parts": [{"text": "prefix"}]}}]}
    return {"choices": [{"delta": {"content": "prefix"}}]}


def sse_frame(payload: dict[str, object]) -> bytes:
    return ("data: " + json.dumps(payload) + "\n").encode()


def response_for(family: str, streaming: bool = False) -> io.BytesIO:
    if not streaming:
        return io.BytesIO(json.dumps(completion(family)).encode())
    body = sse_frame(first_stream_frame(family))
    if family == "anthropic":
        body += sse_frame({"type": "message_delta", "delta": {"stop_reason": "end_turn"}, "usage": {"output_tokens": 2}})
        body += sse_frame({"type": "message_stop"})
    elif family == "gemini":
        body += sse_frame({"candidates": [{"content": {"parts": []}, "finishReason": "STOP"}], "usageMetadata": {"totalTokenCount": 12}})
    else:
        body += sse_frame({"choices": [{"delta": {}, "finish_reason": "stop"}], "usage": {"total_tokens": 12}})
        body += b"data: [DONE]\n"
    return io.BytesIO(body)


def provider(family: str, streaming: bool = False, **kwargs):
    payload = {"model": "fixture-model", "messages": [], "stream": True} if streaming else None
    return llm_client.build_llm_provider(source(family), stream_payload=payload, **kwargs)


def invoke(family: str, streaming: bool = False, **kwargs):
    configured = provider(family, streaming, **kwargs)
    return list(configured.stream(chat_request())) if streaming else configured.complete(chat_request())


@pytest.mark.parametrize("family", FAMILIES)
@pytest.mark.parametrize("streaming", (False, True))
def test_provider_timeout_override_reaches_real_transport(monkeypatch, family, streaming):
    timeouts = []

    def urlopen(req, timeout):
        timeouts.append(timeout)
        return response_for(family, streaming)

    monkeypatch.setattr(llm_client.request, "urlopen", urlopen)
    invoke(family, streaming, timeout_seconds=7.0)
    assert timeouts == [7.0]


@pytest.mark.parametrize("family", FAMILIES)
def test_provider_attempt_override_reaches_real_transport(monkeypatch, family):
    calls = []

    def urlopen(req, timeout):
        calls.append(req)
        raise error.HTTPError(req.full_url, 503, "Unavailable", {}, io.BytesIO())

    monkeypatch.setattr(llm_client.request, "urlopen", urlopen)
    monkeypatch.setattr(llm_client.time, "sleep", lambda _delay: None)
    with pytest.raises(llm_client.LLMError):
        invoke(family, max_attempts=1)
    assert len(calls) == 1


@pytest.mark.parametrize("family", FAMILIES)
@pytest.mark.parametrize("streaming", (False, True))
def test_cancel_before_dispatch_never_opens_http(monkeypatch, family, streaming):
    calls = []

    def urlopen(req, timeout):
        calls.append(req)
        return response_for(family, streaming)

    monkeypatch.setattr(llm_client.request, "urlopen", urlopen)
    with (
        llm_run_control(LLMRunControl(lambda _boundary: "stopped")),
        pytest.raises(LLMRunInterrupted, match="LLM run interrupted") as caught,
    ):
        invoke(family, streaming)
    assert caught.value.reason == "stopped"
    assert not calls


@pytest.mark.parametrize("family", FAMILIES)
@pytest.mark.parametrize("streaming", (False, True))
def test_cancel_during_429_wait_never_retries(monkeypatch, family, streaming):
    clock = Clock()
    calls, progress = [], []
    stopped = False

    def wait(seconds):
        nonlocal stopped
        clock.wait(seconds)
        stopped = True

    def urlopen(req, timeout):
        calls.append(req)
        if len(calls) == 1:
            raise error.HTTPError(req.full_url, 429, "Limited", {"Retry-After": "1"}, io.BytesIO())
        return response_for(family, streaming)

    monkeypatch.setattr(llm_client.request, "urlopen", urlopen)
    monkeypatch.setattr(llm_client.time, "sleep", wait)
    control = LLMRunControl(lambda _: "stopped" if stopped else None, on_progress=progress.append, clock=clock, wait=wait)
    with llm_run_control(control), pytest.raises(LLMRunInterrupted) as caught:
        invoke(family, streaming)
    assert caught.value.reason == "stopped"
    assert len(calls) == 1
    assert max(clock.waits) <= 0.1
    assert [item["phase"] for item in progress] == ["request_started", "retry_wait"]
    assert SECRET not in json.dumps(progress)
    assert "private fixture prose" not in json.dumps(progress)


@pytest.mark.parametrize("family", FAMILIES)
def test_remaining_deadline_bounds_every_http_attempt(monkeypatch, family):
    clock = Clock()
    timeouts, progress = [], []

    def urlopen(req, timeout):
        timeouts.append(timeout)
        if len(timeouts) == 1:
            clock.now += 0.25
            raise error.HTTPError(req.full_url, 503, "Unavailable", {"Retry-After": "0"}, io.BytesIO())
        return response_for(family)

    monkeypatch.setattr(llm_client.request, "urlopen", urlopen)
    control = LLMRunControl(lambda _: None, deadline=11.0, clock=clock, wait=clock.wait, on_progress=progress.append)
    with llm_run_control(control):
        result = invoke(family, timeout_seconds=90.0)
    assert result.usage.total_tokens == 12
    assert timeouts == [1.0, 0.75]
    assert [item["phase"] for item in progress] == ["request_started", "retry_wait", "retry_started", "request_started"]


@pytest.mark.parametrize("family", FAMILIES)
def test_deadline_during_retry_wait_never_dispatches_again(monkeypatch, family):
    clock = Clock()
    calls = []

    def urlopen(req, timeout):
        calls.append(req)
        raise error.HTTPError(req.full_url, 429, "Limited", {"Retry-After": "2"}, io.BytesIO())

    monkeypatch.setattr(llm_client.request, "urlopen", urlopen)
    monkeypatch.setattr(llm_client.time, "sleep", clock.wait)
    control = LLMRunControl(lambda _: None, deadline=10.25, clock=clock, wait=clock.wait)
    with llm_run_control(control), pytest.raises(LLMRunInterrupted) as caught:
        invoke(family)
    assert caught.value.reason == "deadline_exceeded"
    assert len(calls) == 1
    assert sum(clock.waits) == pytest.approx(0.25)


@pytest.mark.parametrize("family", FAMILIES)
def test_successful_complete_preserves_usage_before_late_cancel(monkeypatch, family):
    stopped = False

    class Response(io.BytesIO):
        def read(self, *args):
            nonlocal stopped
            body = super().read(*args)
            stopped = True
            return body

    monkeypatch.setattr(llm_client.request, "urlopen", lambda req, timeout: Response(json.dumps(completion(family)).encode()))
    control = LLMRunControl(lambda _: "stopped" if stopped else None)
    with llm_run_control(control):
        result = invoke(family)
        assert result.usage.total_tokens == 12
        with pytest.raises(LLMRunInterrupted):
            control.check("after_model_usage")


@pytest.mark.parametrize("family", FAMILIES)
def test_partial_stream_cancel_closes_without_replay(monkeypatch, family):
    response = response_for(family, True)
    calls = []
    stopped = False

    def urlopen(req, timeout):
        calls.append(req)
        return response

    monkeypatch.setattr(llm_client.request, "urlopen", urlopen)
    control = LLMRunControl(lambda _: "stopped" if stopped else None)
    with llm_run_control(control):
        stream = provider(family, True).stream(chat_request())
        event = next(stream)
        assert event.kind == StreamEventKind.TEXT_DELTA
        assert event.text == "prefix"
        stopped = True
        with pytest.raises(LLMRunInterrupted):
            list(stream)
    assert len(calls) == 1
    assert response.closed


@pytest.mark.parametrize("family", FAMILIES)
def test_partial_stream_read_failure_is_not_retried(monkeypatch, family):
    class Response(io.BytesIO):
        def __next__(self):
            line = super().__next__()
            if line == b"broken\n":
                raise ConnectionResetError("fixture reset")
            return line

    response = Response(sse_frame(first_stream_frame(family)) + b"broken\n")
    calls = []

    def urlopen(req, timeout):
        calls.append(req)
        return response

    monkeypatch.setattr(llm_client.request, "urlopen", urlopen)
    with llm_run_control(LLMRunControl(lambda _: None)):
        stream = provider(family, True).stream(chat_request())
        assert next(stream).text == "prefix"
        with pytest.raises(llm_client.LLMError):
            list(stream)
    assert len(calls) == 1
    assert response.closed


def test_nested_scopes_restore_parent_and_do_not_leak():
    clock = Clock()
    parent = LLMRunControl(lambda _: None, deadline=11.0, clock=clock)
    assert not has_run_control()
    with llm_run_control(parent):
        assert has_run_control()
        assert request_timeout(90.0) == 1.0
        with pytest.raises(LLMRunInterrupted), llm_run_control(LLMRunControl(lambda _: "stopped")):
            request_timeout(90.0)
        assert request_timeout(90.0) == 1.0
    assert not has_run_control()
    assert request_timeout(90.0) == 90.0


def test_unscoped_wait_preserves_existing_sleep_monkeypatch(monkeypatch):
    waits = []
    monkeypatch.setattr(llm_client.time, "sleep", waits.append)
    wait_for_retry(2.0)
    wait_for_retry(0.0)
    assert waits == [2.0]


def test_control_exception_is_not_provider_or_timeout_failure():
    interruption = LLMRunInterrupted("stopped")
    assert interruption.reason == "stopped"
    assert not isinstance(interruption, (ProviderError, llm_client.LLMError, TimeoutError))


def test_expired_deadline_is_checked_before_dispatch():
    clock = Clock()
    with (
        llm_run_control(LLMRunControl(lambda _: None, deadline=10.0, clock=clock)),
        pytest.raises(LLMRunInterrupted) as caught,
    ):
        request_timeout(90.0)
    assert caught.value.reason == "deadline_exceeded"


@pytest.mark.parametrize("family", FAMILIES)
@pytest.mark.parametrize("streaming", (False, True))
def test_terminal_socket_failure_preserves_cancel_reason(monkeypatch, family, streaming):
    stopped = False

    def urlopen(req, timeout):
        nonlocal stopped
        stopped = True
        raise TimeoutError("fixture timeout")

    monkeypatch.setattr(llm_client.request, "urlopen", urlopen)
    control = LLMRunControl(lambda _: "stopped" if stopped else None)
    with llm_run_control(control), pytest.raises(LLMRunInterrupted) as caught:
        invoke(family, streaming, max_attempts=1)
    assert caught.value.reason == "stopped"


def test_gemini_cancel_between_parts_in_one_frame_stops_before_next_yield(monkeypatch):
    payload = {"candidates": [{"content": {"parts": [{"text": "first"}, {"text": "second"}]}}]}
    response = io.BytesIO(sse_frame(payload))
    monkeypatch.setattr(llm_client.request, "urlopen", lambda req, timeout: response)
    stopped = False
    with llm_run_control(LLMRunControl(lambda _: "stopped" if stopped else None)):
        stream = provider("gemini", True).stream(chat_request())
        assert next(stream).text == "first"
        stopped = True
        with pytest.raises(LLMRunInterrupted):
            next(stream)
    assert response.closed


def test_interruption_reason_remains_latched():
    stopped = True
    control = LLMRunControl(lambda _: "stopped" if stopped else None)
    with pytest.raises(LLMRunInterrupted):
        control.check("first")
    stopped = False
    with pytest.raises(LLMRunInterrupted) as caught:
        control.check("second")
    assert caught.value.reason == "stopped"


def test_progress_observer_time_is_part_of_request_budget():
    clock = Clock()

    def observer(_event):
        clock.now += 0.25

    control = LLMRunControl(lambda _: None, deadline=11.0, clock=clock, on_progress=observer)
    with llm_run_control(control):
        assert request_timeout(90.0) == 0.75


@pytest.mark.parametrize("family", FAMILIES)
def test_cancel_observed_when_inflight_stream_read_returns(monkeypatch, family):
    stopped = False

    class Response(io.BytesIO):
        def __next__(self):
            nonlocal stopped
            # This models a read that cannot be killed: cancellation is observed
            # only after urllib has returned, before its text reaches the caller.
            line = super().__next__()
            stopped = True
            return line

    response = Response(sse_frame(first_stream_frame(family)))
    monkeypatch.setattr(llm_client.request, "urlopen", lambda req, timeout: response)
    with (
        llm_run_control(LLMRunControl(lambda _: "stopped" if stopped else None)),
        pytest.raises(LLMRunInterrupted),
    ):
        next(provider(family, True).stream(chat_request()))
    assert response.closed


@pytest.mark.parametrize("family", FAMILIES)
def test_complete_past_deadline_returns_usage_before_caller_checks(monkeypatch, family):
    clock = Clock()

    class Response(io.BytesIO):
        def read(self, *args):
            clock.now = 12.0
            return super().read(*args)

    monkeypatch.setattr(llm_client.request, "urlopen", lambda req, timeout: Response(json.dumps(completion(family)).encode()))
    control = LLMRunControl(lambda _: None, deadline=11.0, clock=clock)
    with llm_run_control(control):
        assert invoke(family).usage.total_tokens == 12
        with pytest.raises(LLMRunInterrupted) as caught:
            control.check("after_model_usage")
    assert caught.value.reason == "deadline_exceeded"
