from __future__ import annotations

import io
import json
from dataclasses import replace

import pytest
import test_llm_run_control as transport_fixture
from sqlalchemy import select
from test_agent_network_cancellation import execute, model_response, setup_run

from app.common import llm_client
from app.domains.agent_runs import loop_runtime, service
from app.domains.agent_runs.models import AgentArtifact
from app.domains.assistant import service as assistant_service
from app.domains.assistant.models import AssistantToolCall


def configured_source(family, pricing):
    source = transport_fixture.source(family)
    if pricing != "missing":
        source["STORYFORGE_LLM_INPUT_CNY_PER_M_TOKENS"] = {
            "paid": "2", "free": "0", "partial": "2", "invalid": "wrong",
            "nonfinite": "nan", "negative": "-1",
        }[pricing]
    if pricing not in {"missing", "partial"}:
        source["STORYFORGE_LLM_OUTPUT_CNY_PER_M_TOKENS"] = "0" if pricing == "free" else "4"
    return source


def assert_charge(summary, pricing, *, prompt_tokens=10, completion_tokens=2):
    if pricing in {"paid", "free"}:
        expected = (prompt_tokens * 2 + completion_tokens * 4) / 1_000_000 if pricing == "paid" else 0
        assert summary["cost_cny_estimated"] == pytest.approx(expected)
        assert summary["cost_breakdown"]["total_cny"] == pytest.approx(expected)
    else:
        assert summary["cost_cny_estimated"] is None
        assert summary["cost_breakdown"] == {}


@pytest.mark.parametrize("family", transport_fixture.FAMILIES)
@pytest.mark.parametrize("pricing", ["missing", "partial", "invalid", "nonfinite", "negative", "free", "paid"])
@pytest.mark.parametrize("project", [False, True])
def test_public_completed_chat_does_not_invent_free_price(
    session, session_factory, tmp_path, monkeypatch, family, pricing, project,
):
    setup_run(monkeypatch, tmp_path, session_factory)
    source = configured_source(family, pricing)
    monkeypatch.setattr(assistant_service, "resolved_llm_env", lambda: source)
    requests = []

    def urlopen(request, **kwargs):
        requests.append(request)
        return io.BytesIO(json.dumps(transport_fixture.completion(family)).encode())

    monkeypatch.setattr(llm_client.request, "urlopen", urlopen)
    result = execute(session, tmp_path, project=project)
    assert result["agent_result"]["summary"] == "result"
    assert len(requests) == 1
    aggregate = session.scalars(select(AssistantToolCall)).one()
    assert aggregate.status == "completed"
    assert aggregate.output_summary["token_usage"] == 12
    assert aggregate.output_summary["token_usage_source"] == "provider_usage"
    assert_charge(aggregate.output_summary, pricing)
    if project:
        checkpoint = session.scalars(
            select(AgentArtifact).where(AgentArtifact.kind == "runtime_checkpoint").order_by(AgentArtifact.id.desc())
        ).first().payload["checkpoint"]
        assert checkpoint["cost_available"] is (pricing in {"paid", "free"})
        assert checkpoint["total_cost"] == aggregate.output_summary["cost_cny_estimated"]


@pytest.mark.parametrize("family", ["anthropic", "gemini"])
@pytest.mark.parametrize("project", [False, True])
@pytest.mark.parametrize("pricing", ["free", "paid"])
def test_missing_usage_cannot_establish_cost_even_when_prices_are_configured(
    session, session_factory, tmp_path, monkeypatch, family, project, pricing,
):
    setup_run(monkeypatch, tmp_path, session_factory)
    source = configured_source(family, pricing)
    monkeypatch.setattr(assistant_service, "resolved_llm_env", lambda: source)
    data = transport_fixture.completion(family)
    data.pop("usage" if family == "anthropic" else "usageMetadata")
    monkeypatch.setattr(llm_client.request, "urlopen", lambda *a, **kw: io.BytesIO(json.dumps(data).encode()))
    execute(session, tmp_path, project=project)
    summary = session.scalars(select(AssistantToolCall)).one().output_summary
    assert summary["token_usage_source"] == "unavailable"
    assert summary["cost_cny_estimated"] is None
    assert summary["cost_breakdown"] == {}


@pytest.mark.parametrize("family", transport_fixture.FAMILIES)
@pytest.mark.parametrize("pricing", ["missing", "free", "paid"])
@pytest.mark.parametrize("entry", ["complete", "messages", "stream"])
def test_legacy_success_projections_preserve_cost_availability(monkeypatch, family, pricing, entry):
    source = configured_source(family, pricing)
    monkeypatch.setattr(
        llm_client.request, "urlopen",
        lambda *a, **kw: transport_fixture.response_for(family, streaming=entry == "stream"),
    )
    if entry == "messages":
        result = llm_client.call_llm_messages(source, messages=[{"role": "user", "content": "go"}])
    else:
        caller = llm_client.call_llm_streamed if entry == "stream" else llm_client.call_llm
        result = caller(source, system_prompt="system", user_prompt="go")
    assert result["token_usage_source"] != "unavailable"
    assert_charge(result, pricing, prompt_tokens=result["prompt_tokens"], completion_tokens=result["completion_tokens"])


@pytest.mark.parametrize("cache_rate,expected_input", [(None, 0.00002), ("0", 0), ("nan", 0.00002)])
def test_explicit_free_cache_price_is_not_a_missing_price(monkeypatch, cache_rate, expected_input):
    source = configured_source("openai-compatible", "paid")
    if cache_rate is not None:
        source["STORYFORGE_LLM_CACHE_HIT_INPUT_CNY_PER_M_TOKENS"] = cache_rate
    data = transport_fixture.completion("openai-compatible")
    data["usage"]["prompt_tokens_details"] = {"cached_tokens": 10}
    monkeypatch.setattr(llm_client.request, "urlopen", lambda *a, **kw: io.BytesIO(json.dumps(data).encode()))
    result = llm_client.call_llm(source, system_prompt="system", user_prompt="go")
    assert result["cost_breakdown"]["cache_hit_tokens"] == 10
    assert result["cost_breakdown"]["input_cny"] == pytest.approx(expected_input)
    assert result["cost_cny_estimated"] == pytest.approx(expected_input + 0.000008)
    assert result["cost_breakdown"]["cache_hit_input_cny_per_m_tokens"] == (0 if cache_rate == "0" else None)


@pytest.mark.parametrize("pricing,max_cost,blocked", [
    ("missing", 0, False), ("free", 0, True), ("free", 0.000001, False), ("paid", 0.000001, True),
])
def test_public_live_sdk_budget_only_consumes_established_charges(
    session, session_factory, tmp_path, monkeypatch, pricing, max_cost, blocked,
):
    setup_run(monkeypatch, tmp_path, session_factory)
    source = configured_source("openai-compatible", pricing)
    monkeypatch.setattr(assistant_service, "resolved_llm_env", lambda: source)
    requests, runtime_results = [], []
    original_run = loop_runtime.ToolCallingRuntime.run

    def run_with_budget(self, *args, **kwargs):
        kwargs["limits"] = replace(kwargs["limits"], max_cost=max_cost)
        result = original_run(self, *args, **kwargs)
        runtime_results.append(result)
        return result

    def urlopen(request, **kwargs):
        requests.append(json.loads(request.data))
        tool = {"name": "fs_list", "arguments": "{}"} if len(requests) == 1 else None
        return io.BytesIO(json.dumps(model_response(tool)).encode())

    monkeypatch.setattr(loop_runtime.ToolCallingRuntime, "run", run_with_budget)
    monkeypatch.setattr(llm_client.request, "urlopen", urlopen)
    execute(session, tmp_path)
    runtime = runtime_results[0]
    assert runtime.cost_available is (pricing != "missing")
    assert runtime.exhausted is blocked
    assert len(requests) == 2
    assert bool(requests[1].get("tools")) is not blocked
    if pricing == "missing":
        assert runtime.total_cost is None
    traces = list(session.scalars(select(AssistantToolCall).where(AssistantToolCall.tool_name == "fs.list")))
    assert runtime.tool_attempts == (0 if blocked else 1)
    assert len(traces) == 1
    assert traces[0].status == ("failed" if blocked else "completed")
    aggregate = session.scalars(select(AssistantToolCall).where(AssistantToolCall.tool_name == "assistant.chat_loop")).one()
    assert_charge(aggregate.output_summary, pricing, prompt_tokens=40, completion_tokens=14)


@pytest.mark.parametrize("pricing", ["missing", "free", "paid"])
@pytest.mark.parametrize("finish_reason", ["stop", "length", "cancel"])
def test_live_nested_revision_stream_keeps_its_own_charge_availability(
    session, session_factory, tmp_path, monkeypatch, pricing, finish_reason,
):
    setup_run(monkeypatch, tmp_path, session_factory)
    source = configured_source("openai-compatible", pricing)
    monkeypatch.setattr(assistant_service, "resolved_llm_env", lambda: source)
    requests = []

    class Response(io.BytesIO):
        def __next__(self):
            line = super().__next__()
            if finish_reason == "cancel" and b'"usage"' in line:
                with session_factory() as controller:
                    service.handle_agent_control_message(
                        controller, public_id="network-control", session_id="network-session", control_type="stop_run",
                    )
            return line

    def urlopen(request, **kwargs):
        payload = json.loads(request.data)
        requests.append(payload)
        if payload.get("stream"):
            body = transport_fixture.sse_frame({"choices": [{"delta": {"content": "必须保留的原文。"}}]})
            body += transport_fixture.sse_frame({
                "choices": [{"delta": {}, "finish_reason": "stop" if finish_reason == "cancel" else finish_reason}],
                "usage": {"prompt_tokens": 10, "completion_tokens": 2, "total_tokens": 12},
            })
            return Response(body + b"data: [DONE]\n")
        tool = {"name": "file_revise", "arguments": json.dumps({"path": "chapter.md", "instruction": "修改标点"})}
        return io.BytesIO(json.dumps(model_response(tool if len(requests) == 1 else None)).encode())

    monkeypatch.setattr(llm_client.request, "urlopen", urlopen)
    result = execute(session, tmp_path)
    assert len(requests) == (2 if finish_reason == "cancel" else 3)
    assert requests[1]["stream"] is True
    nested = session.scalars(select(AssistantToolCall).where(AssistantToolCall.tool_name == "assistant.revise")).one()
    assert nested.status == {"stop": "completed", "length": "failed", "cancel": "paused"}[finish_reason]
    if finish_reason != "stop":
        assert result["proposed_patch"] is None
    if finish_reason == "cancel":
        assert result["runtime_interruption"]["status"] == "stopped"
    assert nested.output_summary["token_usage"] == 12
    assert_charge(nested.output_summary, pricing)
    aggregate = session.scalars(select(AssistantToolCall).where(AssistantToolCall.tool_name == "assistant.chat_loop")).one()
    rounds = 1 if finish_reason == "cancel" else 2
    assert aggregate.output_summary["token_usage"] == rounds * 27
    assert_charge(aggregate.output_summary, pricing, prompt_tokens=rounds * 20, completion_tokens=rounds * 7)


@pytest.mark.parametrize("family", ["anthropic", "gemini"])
@pytest.mark.parametrize("pricing", ["missing", "free", "paid"])
@pytest.mark.parametrize("known_usage", [False, True])
def test_public_fallback_failure_preserves_determinable_charge(
    session, session_factory, tmp_path, monkeypatch, family, pricing, known_usage,
):
    setup_run(monkeypatch, tmp_path, session_factory)
    source = configured_source(family, pricing)
    monkeypatch.setattr(assistant_service, "resolved_llm_env", lambda: source)
    data = transport_fixture.completion(family)
    if family == "anthropic":
        data["stop_reason"] = "refusal"
    else:
        data["candidates"][0]["finishReason"] = "SAFETY"
    if not known_usage:
        data.pop("usage" if family == "anthropic" else "usageMetadata")
    requests = []

    def urlopen(request, **kwargs):
        requests.append(request)
        return io.BytesIO(json.dumps(data).encode())

    monkeypatch.setattr(llm_client.request, "urlopen", urlopen)
    result = execute(session, tmp_path, project=False)
    assert result["agent_result"]["execution_outcome"]["status"] == "failed"
    assert len(requests) == 1
    evidence = session.scalars(select(AssistantToolCall)).one()
    assert evidence.tool_name == "assistant.chat"
    assert evidence.status == "failed"
    if known_usage:
        assert evidence.output_summary["token_usage"] == 12
    else:
        assert "token_usage" not in evidence.output_summary
    assert_charge(evidence.output_summary, pricing if known_usage else "missing")


@pytest.mark.parametrize("unknown_round", [1, 2])
@pytest.mark.parametrize("terminal_failure", [False, True])
@pytest.mark.parametrize("pricing", ["paid", "free"])
def test_mixed_rounds_preserve_known_subtotal_not_claim_complete_cost(
    session, session_factory, tmp_path, monkeypatch, unknown_round, terminal_failure, pricing,
):
    setup_run(monkeypatch, tmp_path, session_factory)
    source = configured_source("anthropic", pricing)
    monkeypatch.setattr(assistant_service, "resolved_llm_env", lambda: source)
    requests, runtime_results = [], []
    original_run = loop_runtime.ToolCallingRuntime.run

    def capture_runtime(self, *args, **kwargs):
        result = original_run(self, *args, **kwargs)
        runtime_results.append(result)
        return result

    def urlopen(request, **kwargs):
        requests.append(request)
        data = transport_fixture.completion("anthropic")
        if len(requests) == 1:
            data["content"] = [{"type": "tool_use", "id": "call-1", "name": "fs_list", "input": {}}]
            data["stop_reason"] = "tool_use"
        elif terminal_failure:
            data["stop_reason"] = "refusal"
        if len(requests) == unknown_round:
            data.pop("usage")
        return io.BytesIO(json.dumps(data).encode())

    monkeypatch.setattr(loop_runtime.ToolCallingRuntime, "run", capture_runtime)
    monkeypatch.setattr(llm_client.request, "urlopen", urlopen)
    execute(session, tmp_path)
    assert len(requests) == 2
    aggregate = session.scalars(select(AssistantToolCall).where(AssistantToolCall.tool_name == "assistant.chat_loop")).one()
    assert aggregate.status == ("failed" if terminal_failure else "completed")
    assert aggregate.output_summary["token_usage"] == 12
    assert_charge(aggregate.output_summary, pricing)
    runtime = runtime_results[0]
    # cost_available means at least one established charge, not that all attempts were priced.
    assert runtime.cost_available is True
    assert runtime.total_cost == aggregate.output_summary["cost_cny_estimated"]
    attempts = list(session.scalars(
        select(AgentArtifact).where(AgentArtifact.kind == "model_request_evidence").order_by(AgentArtifact.id)
    ))
    assert len(attempts) == 2
    assert attempts[unknown_round - 1].payload["usage"]["token_usage_source"] == "unavailable"
    assert attempts[2 - unknown_round].payload["usage"]["token_usage"] == 12
