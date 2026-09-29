from __future__ import annotations

import io
import json

import pytest
import test_llm_run_control as provider_fixture
from sqlalchemy import select
from test_agent_network_cancellation import execute, setup_run

from app.common import llm_client
from app.domains.agent_runs import service
from app.domains.agent_runs.models import AgentArtifact
from app.domains.assistant import service as assistant_service
from app.domains.assistant.models import AssistantToolCall


@pytest.mark.parametrize("family", ["anthropic", "gemini"])
@pytest.mark.parametrize("pricing", ["configured", "missing", "invalid", "nonfinite", "negative", "free"])
@pytest.mark.parametrize("cancelled", [False, True])
def test_live_provider_error_usage_does_not_become_runtime_infrastructure_failure(
    session,
    session_factory,
    tmp_path,
    monkeypatch,
    family,
    pricing,
    cancelled,
):
    setup_run(monkeypatch, tmp_path, session_factory)
    source = provider_fixture.source(family)
    if pricing != "missing":
        rate = {"configured": "2", "invalid": "invalid", "nonfinite": "nan", "negative": "-1", "free": "0"}[pricing]
        source.update(
            STORYFORGE_LLM_INPUT_CNY_PER_M_TOKENS=rate,
            STORYFORGE_LLM_OUTPUT_CNY_PER_M_TOKENS="0" if pricing == "free" else "4",
        )
    monkeypatch.setattr(assistant_service, "resolved_llm_env", lambda: source)
    data = provider_fixture.completion(family)
    if family == "anthropic":
        data["stop_reason"] = "refusal"
    else:
        data["candidates"][0]["finishReason"] = "SAFETY"

    class Response(io.BytesIO):
        def read(self):
            body = super().read()
            if cancelled:
                with session_factory() as controller:
                    service.handle_agent_control_message(
                        controller, public_id="network-control", session_id="network-session", control_type="stop_run"
                    )
            return body

    response = Response(json.dumps(data).encode())
    calls = []

    def urlopen(*args, **kwargs):
        calls.append(1)
        return response

    monkeypatch.setattr(llm_client.request, "urlopen", urlopen)
    result = execute(session, tmp_path)
    if cancelled:
        assert result["runtime_interruption"]["status"] == "stopped"
    else:
        assert result["agent_result"]["execution_outcome"]["code"] == "provider_content_filter"
        assert result["agent_result"]["execution_outcome"]["status"] == "failed"
    assert result["proposed_patch"] is None
    session.expire_all()
    aggregate = session.scalars(
        select(AssistantToolCall).where(AssistantToolCall.tool_name == "assistant.chat_loop")
    ).one()
    evidence = session.scalars(select(AgentArtifact).where(AgentArtifact.kind == "model_request_evidence")).one()
    assert aggregate.status == "failed"
    assert aggregate.output_summary["token_usage"] == evidence.payload["usage"]["token_usage"] == 12
    assert aggregate.output_summary["token_usage_source"] == "provider_usage"
    if pricing in {"configured", "free"}:
        expected = 0.000028 if pricing == "configured" else 0
        assert aggregate.output_summary["cost_cny_estimated"] == pytest.approx(expected)
        assert aggregate.output_summary["cost_breakdown"]["total_cny"] == pytest.approx(expected)
    else:
        assert aggregate.output_summary["cost_cny_estimated"] is None
        assert not aggregate.output_summary["cost_breakdown"]
    assert calls == [1]
    assert response.closed
