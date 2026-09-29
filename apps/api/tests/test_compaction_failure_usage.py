from __future__ import annotations

import io
import json
from urllib.error import HTTPError

import pytest
import test_llm_run_control as transport_fixture
from compaction_test_support import SummaryProvider, seed_history
from sqlalchemy import select

from app.common import llm_client
from app.common.llm_control import LLMRunControl, LLMRunInterrupted, llm_run_control
from app.common.llm_observation import observe_provider
from app.domains.agent_runs import compaction_job
from app.domains.agent_runs.models import AgentArtifact
from app.domains.agent_runs.request_evidence import agent_request_evidence_scope
from app.domains.assistant import service as assistant_service
from app.domains.assistant.models import AssistantMessage, AssistantToolCall
from app.platform.ai_sdk import ProviderError, TokenUsage
from app.platform.ai_sdk.errors import ProviderErrorCategory, ProviderErrorDetails


def records(session):
    session.expire_all()
    call = session.scalars(select(AssistantToolCall).where(AssistantToolCall.tool_name == "conversation.compact")).one()
    evidence = session.scalars(select(AgentArtifact).where(AgentArtifact.kind == "model_request_evidence")).one()
    assert session.scalar(select(AgentArtifact).where(AgentArtifact.kind == "system_compaction")) is None
    return call, evidence.payload


def configure(monkeypatch, family="openai-compatible"):
    source = transport_fixture.source(family)
    monkeypatch.setattr(assistant_service, "resolved_llm_env", lambda: source)
    return source


@pytest.mark.parametrize("kind", ["provider", "legacy", "stopped", "deadline_exceeded"])
@pytest.mark.parametrize("known", [True, False])
def test_compaction_failure_retains_exception_usage_without_publishing_or_hiding_control(
    session, monkeypatch, kind, known
):
    conversation, run = seed_history(session)
    source = configure(monkeypatch)
    usage = TokenUsage(10, 2, 12, source="provider_usage") if known else None
    if kind == "provider":
        error = ProviderError(ProviderErrorDetails(ProviderErrorCategory.RESPONSE, "private-failure-body"), usage=usage)
    elif kind == "legacy":
        error = llm_client.LLMError("private-failure-body", usage=usage)
    else:
        error = LLMRunInterrupted(kind, usage=usage)

    class Provider:
        calls = 0

        def complete(self, request):
            self.calls += 1
            raise error

    provider = Provider()
    monkeypatch.setattr(compaction_job, "build_llm_provider", lambda _: observe_provider(provider, source))
    with agent_request_evidence_scope(session, run):
        if isinstance(error, LLMRunInterrupted):
            with pytest.raises(LLMRunInterrupted) as caught:
                compaction_job.prepare_conversation_compaction(session, conversation.id)
            assert caught.value is error
        else:
            result = compaction_job.prepare_conversation_compaction(session, conversation.id)
            assert result["status"] == "failed"
    call, evidence = records(session)
    assert call.status == ("paused" if isinstance(error, LLMRunInterrupted) else "failed")
    assert call.output_summary["checkpoint_publication"] == "not_published"
    if known:
        assert call.output_summary["token_usage"] == evidence["usage"]["token_usage"] == 12
        assert call.output_summary["token_usage_source"] == "provider_usage"
    else:
        assert "token_usage" not in call.output_summary
        assert "token_usage_source" not in call.output_summary
        assert evidence["usage"]["token_usage_source"] == "unavailable"
    assert "private-failure-body" not in json.dumps(call.output_summary)
    assert transport_fixture.SECRET not in json.dumps(evidence)
    assert len(session.scalars(select(AssistantMessage)).all()) == 16
    assert provider.calls == 1


@pytest.mark.parametrize("reason", ["length", "content_filter"])
def test_rejected_completed_response_keeps_single_usage_record(session, monkeypatch, reason):
    conversation, run = seed_history(session)
    source = configure(monkeypatch)
    provider = SummaryProvider(finish_reason=reason)
    monkeypatch.setattr(compaction_job, "build_llm_provider", lambda _: observe_provider(provider, source))
    with agent_request_evidence_scope(session, run):
        result = compaction_job.prepare_conversation_compaction(session, conversation.id)
    assert result["status"] == "failed"
    call, evidence = records(session)
    assert call.status == "failed"
    assert call.output_summary["prompt_tokens"] == evidence["usage"]["prompt_tokens"] == 100
    assert call.output_summary["finish_reason"] == reason


def test_cancellation_after_completed_response_does_not_double_count(session, monkeypatch):
    conversation, run = seed_history(session)
    source = configure(monkeypatch)
    stopped = False

    class Provider(SummaryProvider):
        def complete(self, request):
            nonlocal stopped
            response = super().complete(request)
            stopped = True
            return response

    provider = Provider()
    monkeypatch.setattr(compaction_job, "build_llm_provider", lambda _: observe_provider(provider, source))
    with (
        agent_request_evidence_scope(session, run),
        llm_run_control(LLMRunControl(lambda _: "stopped" if stopped else None)),
        pytest.raises(LLMRunInterrupted),
    ):
        compaction_job.prepare_conversation_compaction(session, conversation.id)
    call, evidence = records(session)
    assert call.status == "completed"
    assert call.output_summary["prompt_tokens"] == evidence["usage"]["prompt_tokens"] == 100
    assert len(provider.requests) == 1


def test_hidden_compaction_retry_consumes_parent_remaining_deadline(session, monkeypatch):
    conversation, run = seed_history(session)
    source = configure(monkeypatch)
    clock, timeouts = [0.0], []

    def urlopen(request, *, timeout):
        timeouts.append(timeout)
        if len(timeouts) == 1:
            clock[0] = 0.6
            return io.BytesIO(json.dumps(transport_fixture.completion("openai-compatible")).encode())
        clock[0] = 0.9 if len(timeouts) == 2 else 1.0
        raise HTTPError("https://fixture.invalid", 503, "fixture", {"Retry-After": "0"}, io.BytesIO())

    monkeypatch.setattr(llm_client.request, "urlopen", urlopen)
    control = LLMRunControl(lambda _: None, deadline=1.0, clock=lambda: clock[0], wait=lambda _: None)
    with llm_run_control(control):
        llm_client.call_llm(source, system_prompt="fixture", user_prompt="fixture")
        with agent_request_evidence_scope(session, run), pytest.raises(LLMRunInterrupted) as caught:
            compaction_job.prepare_conversation_compaction(session, conversation.id)
    assert caught.value.reason == "deadline_exceeded"
    assert timeouts == pytest.approx([1.0, 0.4, 0.1])
    call, evidence = records(session)
    assert call.status == "paused"
    assert "token_usage" not in call.output_summary
    assert evidence["usage"]["token_usage_source"] == "unavailable"


@pytest.mark.parametrize("family", transport_fixture.FAMILIES)
def test_real_provider_rejected_response_accounting_reaches_compaction_and_request_evidence(
    session, monkeypatch, family
):
    conversation, run = seed_history(session)
    configure(monkeypatch, family)
    data = transport_fixture.completion(family)
    if family == "anthropic":
        data["stop_reason"] = "refusal"
    elif family == "gemini":
        data["candidates"][0]["finishReason"] = "SAFETY"
    else:
        data["choices"][0]["finish_reason"] = "content_filter"
    response = io.BytesIO(json.dumps(data).encode())
    calls = []

    def urlopen(*args, **kwargs):
        calls.append(1)
        return response

    monkeypatch.setattr(llm_client.request, "urlopen", urlopen)
    with agent_request_evidence_scope(session, run):
        result = compaction_job.prepare_conversation_compaction(session, conversation.id)
    assert result["status"] == "failed"
    call, evidence = records(session)
    assert call.status == "failed"
    assert call.output_summary["token_usage"] == evidence["usage"]["token_usage"] == 12
    assert call.output_summary["token_usage_source"] == "provider_usage"
    assert response.closed
    assert calls == [1]


@pytest.mark.parametrize("family", ["anthropic", "gemini"])
@pytest.mark.parametrize("known", [True, False])
def test_native_rejection_usage_survives_legacy_error_projection(monkeypatch, family, known):
    source = configure(monkeypatch, family)
    data = transport_fixture.completion(family)
    if family == "anthropic":
        data["stop_reason"] = "refusal"
        if not known:
            data["usage"] = {}
    else:
        data["candidates"][0]["finishReason"] = "SAFETY"
        if not known:
            data["usageMetadata"] = {}
    monkeypatch.setattr(llm_client.request, "urlopen", lambda *a, **kw: io.BytesIO(json.dumps(data).encode()))
    with pytest.raises(llm_client.LLMError) as caught:
        llm_client.call_llm(source, system_prompt="fixture", user_prompt="fixture")
    if known:
        assert caught.value.usage.total_tokens == 12
        assert caught.value.usage.source == "provider_usage"
    else:
        assert llm_client.error_usage_summary(caught.value) == {}
