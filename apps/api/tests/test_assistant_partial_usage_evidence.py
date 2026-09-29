from __future__ import annotations

import io
import json

import pytest
import test_llm_run_control as fixture
import test_llm_stream_usage_retention as stream_fixture
from sqlalchemy import select

from app.common import llm_client
from app.common.llm_control import LLMRunControl, LLMRunInterrupted, llm_run_control
from app.domains.assistant import service
from app.domains.assistant.models import AssistantMessage, AssistantToolCall
from app.domains.assistant.schemas import (
    AssistantContinueRequest,
    AssistantDraftRequest,
    AssistantReviseRequest,
    AssistantSessionCreate,
)


def invoke(path, session):
    if path == "draft":
        return service.draft_file_content(session, AssistantDraftRequest(file_path="chapter.md", instruction="写开场"))
    if path == "revise":
        return service.revise_file_content(
            session, AssistantReviseRequest(file_path="chapter.md", content="原稿", instruction="修订")
        )
    request = AssistantContinueRequest(file_path="chapter.md", content="原稿", cursor_line=1)
    return (
        list(service.stream_continue_prose(session, request))
        if path == "stream"
        else service.draft_continuation(session, request)
    )


@pytest.mark.parametrize("family", fixture.FAMILIES)
@pytest.mark.parametrize("path", ["draft", "revise", "continue", "stream"])
@pytest.mark.parametrize("failure", ["read", "length", "cancel"])
def test_partial_usage_is_durable_in_failed_or_interrupted_assistant_tool_call(
    session, monkeypatch, family, path, failure
):
    monkeypatch.setattr(service, "resolved_llm_env", lambda: fixture.source(family))
    monkeypatch.setattr(service, "missing_book_generation_env", lambda: [])
    stopped = False
    calls = []

    class Response(io.BytesIO):
        def __next__(self):
            nonlocal stopped
            line = super().__next__()
            if failure == "cancel":
                stopped = True
            if line == b"broken\n":
                raise ConnectionResetError("fixture-only")
            return line

    body = (
        (
            fixture.sse_frame(stream_fixture.usage_frame(family))
            + fixture.sse_frame(fixture.first_stream_frame(family))
            + b"broken\n"
        )
        if failure == "read"
        else stream_fixture.raw_bytes(family, "length")
    )
    response = Response(body)

    def urlopen(*args, **kwargs):
        calls.append(1)
        return response

    monkeypatch.setattr(llm_client.request, "urlopen", urlopen)
    with llm_run_control(LLMRunControl(lambda _: "stopped" if stopped else None)):
        if path == "stream" and failure != "cancel":
            events = invoke(path, session)
            assert any("event: error" in event for event in events)
            assert not any("event: done" in event for event in events)
        else:
            with pytest.raises(LLMRunInterrupted if failure == "cancel" else service.AssistantReviseError):
                invoke(path, session)
    session.expire_all()
    record = session.scalars(select(AssistantToolCall)).one()
    assert record.status == ("paused" if failure == "cancel" else "failed")
    assert record.output_summary["token_usage"] == 12
    assert record.output_summary["prompt_tokens"] == 10
    assert record.output_summary["completion_tokens"] == 2
    assert record.output_summary["token_usage_source"] == "provider_usage"
    assert not list(session.scalars(select(AssistantMessage).where(AssistantMessage.role == "assistant")))
    assert fixture.SECRET not in json.dumps(record.output_summary)
    assert "prefix" not in json.dumps(record.output_summary)
    assert response.closed
    assert len(calls) == 1


def test_unknown_failed_usage_does_not_become_zero_provider_evidence(session, monkeypatch):
    monkeypatch.setattr(service, "resolved_llm_env", lambda: fixture.source("openai-compatible"))
    monkeypatch.setattr(service, "missing_book_generation_env", lambda: [])

    def fail(*args, **kwargs):
        raise llm_client.LLMError("fixture-only")

    monkeypatch.setattr(service, "_call_llm_streamed", fail)
    with pytest.raises(service.AssistantReviseError):
        invoke("draft", session)
    record = session.scalars(select(AssistantToolCall)).one()
    assert record.status == "failed"
    assert "token_usage" not in record.output_summary
    assert "token_usage_source" not in record.output_summary


@pytest.mark.parametrize("family", fixture.FAMILIES)
def test_chat_length_retains_usage_in_failed_tool_call_and_typed_error(session, monkeypatch, family):
    monkeypatch.setattr(service, "resolved_llm_env", lambda: fixture.source(family))
    monkeypatch.setattr(service, "missing_book_generation_env", lambda: [])
    data = fixture.completion(family)
    if family == "anthropic":
        data["stop_reason"] = "max_tokens"
    elif family == "gemini":
        data["candidates"][0]["finishReason"] = "MAX_TOKENS"
    else:
        data["choices"][0]["finish_reason"] = "length"
    monkeypatch.setattr(llm_client.request, "urlopen", lambda *a, **kw: io.BytesIO(json.dumps(data).encode()))
    conversation = service.create_assistant_session(session, AssistantSessionCreate(title="fixture", task_type="chat"))
    with pytest.raises(service.AssistantReviseError) as caught:
        service.chat_reply(session, user_message="fixture", context_block="", assistant_session_id=conversation.id)
    stream_fixture.assert_usage(caught.value)
    session.expire_all()
    record = session.scalars(select(AssistantToolCall)).one()
    assert record.status == "failed"
    assert record.output_summary["token_usage"] == 12
    assert record.output_summary["token_usage_source"] == "provider_usage"
    assert not list(session.scalars(select(AssistantMessage).where(AssistantMessage.role == "assistant")))
