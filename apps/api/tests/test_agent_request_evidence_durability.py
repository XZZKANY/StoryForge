from __future__ import annotations

import json

import pytest
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import NullPool

from app.common import llm_client
from app.common.llm_control import LLMRunInterrupted
from app.common.llm_observation import model_operation, observe_provider
from app.db.base import Base
from app.domains.agent_runs import service
from app.domains.agent_runs.errors import AgentOrchestrationError
from app.domains.agent_runs.models import AgentArtifact, AgentRun
from app.domains.agent_runs.request_evidence import (
    REQUEST_EVIDENCE_KIND,
    agent_request_evidence_scope,
    rebuild_normalized_request,
)
from app.platform.ai_sdk import (
    ChatMessage,
    ChatRequest,
    ChatResponse,
    MessageRole,
    StreamEvent,
    StreamEventKind,
    TokenUsage,
)

SOURCE = {"STORYFORGE_LLM_PROVIDER": "openai", "STORYFORGE_LLM_MODEL": "fixture-model",
          "STORYFORGE_LLM_BASE_URL": "https://fixture.invalid/v1", "STORYFORGE_LLM_API_KEY": "test-opaque-key"}


@pytest.fixture()
def evidence_engine(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'requests.sqlite'}", poolclass=NullPool,
                           connect_args={"check_same_thread": False})
    with engine.begin() as connection:
        connection.exec_driver_sql("PRAGMA journal_mode=WAL")
        Base.metadata.create_all(connection)
    yield engine
    engine.dispose()


def create_run(session):
    run = AgentRun(public_id="durable-evidence", session_id="durable-evidence", goal="synthetic review",
                   scope={}, budget={}, root_plan=[])
    session.add(run)
    session.commit()
    return run


def stored(engine):
    with Session(engine) as reader:
        return [dict(row.payload) for row in reader.scalars(select(AgentArtifact).where(
            AgentArtifact.kind == REQUEST_EVIDENCE_KIND).order_by(AgentArtifact.id))]


class Provider:
    def __init__(self):
        self.calls = 0

    def complete(self, request):
        self.calls += 1
        return ChatResponse("result", finish_reason="stop", usage=TokenUsage(20, 3, 23, source="provider_usage"))


def test_request_evidence_is_visible_to_an_independent_connection_before_real_dispatch(
    evidence_engine, monkeypatch,
):
    sent = []

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self):
            return json.dumps({"choices": [{"message": {"role": "assistant", "content": "done"},
                                           "finish_reason": "stop"}]}).encode()

    def urlopen(request, *, timeout):
        prepared = stored(evidence_engine)
        assert len(prepared) == 1
        assert prepared[0]["status"] == "prepared"
        sent.append(json.loads(request.data))
        return Response()

    monkeypatch.setattr(llm_client.request, "urlopen", urlopen)
    with Session(evidence_engine) as session:
        run = create_run(session)
        with agent_request_evidence_scope(session, run):
            llm_client.build_llm_provider(SOURCE).complete(ChatRequest(
                "fixture-model", (ChatMessage(MessageRole.USER, "keep the ending"),)))
    payload = stored(evidence_engine)[0]
    assert payload["status"] == "response_completed"
    rebuilt = rebuild_normalized_request(payload)
    assert [message.to_openai() for message in rebuilt.messages] == sent[0]["messages"]


@pytest.mark.parametrize("stage", ["prepared", "response_completed"])
@pytest.mark.parametrize("fault", ["sql", "commit"])
def test_failed_evidence_commit_does_not_dispatch_or_leak_uncommitted_success(
    evidence_engine, monkeypatch, stage, fault,
):
    provider = Provider()
    with Session(evidence_engine) as session:
        run = create_run(session)
        fired = False

        def fail_if_target():
            nonlocal fired
            candidates = list(session.new) + list(session.dirty)
            if not fired and any(isinstance(row, AgentArtifact) and row.kind == REQUEST_EVIDENCE_KIND
                                 and row.payload.get("status") == stage for row in candidates):
                fired = True
                raise RuntimeError("synthetic database failure test-opaque-key")

        def sql_failure(conn, cursor, statement, parameters, context, executemany):
            if "agent_artifacts" in statement and statement.lstrip().upper().startswith(("INSERT", "UPDATE")):
                fail_if_target()

        original_commit = session.commit

        def failing_commit():
            fail_if_target()
            original_commit()

        if fault == "sql":
            event.listen(evidence_engine, "before_cursor_execute", sql_failure)
        else:
            monkeypatch.setattr(session, "commit", failing_commit)
        try:
            with agent_request_evidence_scope(session, run), pytest.raises(AgentOrchestrationError) as caught:
                observe_provider(provider, SOURCE).complete(ChatRequest("fixture-model", ()))
            assert "test-opaque-key" not in str(caught.value)
            assert fired
            assert provider.calls == (0 if stage == "prepared" else 1)
            session.commit()  # rollback must also protect a later successful transaction
        finally:
            if fault == "sql":
                event.remove(evidence_engine, "before_cursor_execute", sql_failure)
    records = stored(evidence_engine)
    assert [item["status"] for item in records] == ([] if stage == "prepared" else ["prepared"])


def test_commit_ack_loss_keeps_the_actual_result_without_a_second_provider_call(evidence_engine, monkeypatch):
    provider = Provider()
    with Session(evidence_engine) as session:
        run = create_run(session)
        original_commit = session.commit

        def lose_completion_ack():
            completing = any(isinstance(row, AgentArtifact) and row.payload.get("status") == "response_completed"
                             for row in session.dirty)
            original_commit()
            if completing:
                raise RuntimeError("synthetic completion ack loss")

        monkeypatch.setattr(session, "commit", lose_completion_ack)
        with agent_request_evidence_scope(session, run), pytest.raises(AgentOrchestrationError):
            observe_provider(provider, SOURCE).complete(ChatRequest("fixture-model", ()))
    assert provider.calls == 1
    assert stored(evidence_engine)[0]["status"] == "response_completed"
    assert stored(evidence_engine)[0]["usage"]["token_usage"] == 23


@pytest.mark.parametrize("reason", ["paused", "stopped", "deadline_exceeded"])
def test_stream_cancellation_retains_known_usage_and_interruption_status(session, reason):
    class InterruptedProvider:
        def stream(self, request):
            yield StreamEvent(StreamEventKind.USAGE, usage=TokenUsage(20, 3, 23, source="provider_usage"))
            raise LLMRunInterrupted(reason)

    run = create_run(session)
    with agent_request_evidence_scope(session, run), pytest.raises(LLMRunInterrupted):
        list(observe_provider(InterruptedProvider(), SOURCE).stream(ChatRequest("fixture-model", ())))
    payload = session.scalar(select(AgentArtifact).where(AgentArtifact.kind == REQUEST_EVIDENCE_KIND)).payload
    assert payload["status"] == "interrupted"
    assert payload["error_code"] == reason
    assert payload["usage"]["token_usage"] == 23


def test_safe_operation_metadata_is_reconstructible_but_unknown_native_metadata_is_not(session):
    run = create_run(session)
    with agent_request_evidence_scope(session, run):
        observe_provider(Provider(), SOURCE).complete(ChatRequest(
            "fixture-model", (), metadata={"operation": "conversation.compact", "prompt_version": "v2"}))
        observe_provider(Provider(), SOURCE).complete(ChatRequest(
            "fixture-model", (), metadata={"operation": "conversation.compact", "native_state": "never-store-this"}))
    payloads = [row.payload for row in session.scalars(select(AgentArtifact).order_by(AgentArtifact.id))]
    rebuilt = rebuild_normalized_request(payloads[0])
    assert dict(rebuilt.metadata) == {"operation": "conversation.compact", "prompt_version": "v2"}
    assert "never-store-this" not in json.dumps(payloads[1])
    with pytest.raises(ValueError, match="omitted"):
        rebuild_normalized_request(payloads[1])


@pytest.mark.parametrize("oversized", ["request", "provenance"])
def test_oversized_evidence_fails_before_dispatch_without_truncation(session, oversized):
    provider = Provider()
    run = create_run(session)
    content = "甲" * 700_000
    request = ChatRequest("fixture-model", (ChatMessage(MessageRole.USER, content),)) if oversized == "request" else ChatRequest("fixture-model", ())
    provenance = {"evidence": content} if oversized == "provenance" else {}
    with (
        agent_request_evidence_scope(session, run), model_operation("test", provenance=provenance),
        pytest.raises(AgentOrchestrationError, match="预算"),
    ):
        observe_provider(provider, SOURCE).complete(request)
    assert provider.calls == 0
    assert session.scalar(select(AgentArtifact)) is None


def test_nested_requests_keep_distinct_attempts_and_restore_parent_progress(session):
    from app.common.llm_observation import observe_http_progress

    run = create_run(session)

    class ParentProvider:
        def complete(self, request):
            with model_operation("child", provenance={"source": "synthetic-context"}):
                observe_provider(Provider(), SOURCE).complete(ChatRequest("child-model", ()))
            observe_http_progress({"phase": "request_started", "request_number": 1})
            return ChatResponse("parent", finish_reason="stop")

    with agent_request_evidence_scope(session, run), model_operation("parent"):
        observe_provider(ParentProvider(), SOURCE).complete(ChatRequest("parent-model", ()))
    payloads = [row.payload for row in session.scalars(select(AgentArtifact).order_by(AgentArtifact.id))]
    assert [item["step"] for item in payloads] == ["parent", "child"]
    assert len({item["attempt_id"] for item in payloads}) == 2
    assert payloads[0]["transport_progress"] == [{"phase": "request_started", "request_number": 1}]
    assert payloads[1]["transport_progress"] == []
    assert not service.list_agent_artifacts(session, run.public_id)
    assert not service.list_agent_checkpoints(session, run.public_id)


@pytest.mark.parametrize("streaming", [False, True])
@pytest.mark.parametrize("provider_end", ["success", "failure", "interruption"])
@pytest.mark.parametrize("ack_lost", [False, True])
def test_finish_storage_failure_preserves_usage_and_never_resettles_attempt(
    evidence_engine, monkeypatch, streaming, provider_end, ack_lost,
):
    from app.platform.ai_sdk.errors import ProviderError, ProviderErrorCategory, ProviderErrorDetails

    usage = TokenUsage(20, 3, 23, source="provider_usage")

    class FaultProvider:
        calls = 0

        def complete(self, request):
            self.calls += 1
            if provider_end == "failure":
                raise ProviderError(ProviderErrorDetails(ProviderErrorCategory.CONNECTION, "fixture"), usage=usage)
            if provider_end == "interruption":
                raise LLMRunInterrupted("paused", usage=usage)
            return ChatResponse("complete", finish_reason="stop", usage=usage)

        def stream(self, request):
            yield StreamEvent(StreamEventKind.USAGE, usage=usage)
            yield StreamEvent(StreamEventKind.COMPLETED, response=self.complete(request))

    provider = FaultProvider()
    attempts = []
    with Session(evidence_engine) as session:
        run = create_run(session)
        original_commit = session.commit

        def fail_finish():
            finishing = [row for row in session.dirty if isinstance(row, AgentArtifact)
                         and row.kind == REQUEST_EVIDENCE_KIND and row.payload["status"] != "prepared"]
            if finishing:
                attempts.append(finishing[0].payload["status"])
                if len(attempts) == 1:
                    if ack_lost:
                        original_commit()
                    raise RuntimeError("synthetic storage error test-opaque-key")
            original_commit()

        monkeypatch.setattr(session, "commit", fail_finish)
        with agent_request_evidence_scope(session, run), pytest.raises(AgentOrchestrationError) as caught:
            observed = observe_provider(provider, SOURCE)
            request = ChatRequest("fixture-model", ())
            if streaming:
                list(observed.stream(request))
            else:
                observed.complete(request)
        assert getattr(caught.value, "usage", None) == usage
        assert "test-opaque-key" not in str(caught.value)
        session.commit()
    expected = {"success": "response_completed", "failure": "request_failed", "interruption": "interrupted"}[provider_end]
    assert provider.calls == 1
    assert attempts == [expected], "storage failure must not be reinterpreted as a second provider failure"
    assert stored(evidence_engine)[0]["status"] == (expected if ack_lost else "prepared")


@pytest.mark.parametrize("container", ["tuple", "mapping", "mixed"])
def test_provenance_native_state_is_removed_through_all_supported_json_containers(session, container):
    from collections import UserDict
    from types import MappingProxyType

    native = {"continuation": {"signature": "native-private-fixture"}, "source_id": "source-7"}
    nested = {"tuple": (native,), "mapping": UserDict(native),
              "mixed": (MappingProxyType({"children": [UserDict(native)]}),)}[container]
    run = create_run(session)
    with agent_request_evidence_scope(session, run), model_operation("test", provenance={"nested": nested}):
        observe_provider(Provider(), SOURCE).complete(ChatRequest("fixture-model", ()))
    payload = session.scalar(select(AgentArtifact).where(AgentArtifact.kind == REQUEST_EVIDENCE_KIND)).payload
    encoded = json.dumps(payload["context_provenance"])
    assert "native-private-fixture" not in encoded
    assert "native_state_not_persisted" in encoded
    assert "source-7" in encoded


@pytest.mark.parametrize("ack_lost", [False, True])
def test_live_request_evidence_failure_keeps_business_usage_without_delivering_response(
    session, tmp_path, monkeypatch, ack_lost,
):
    import test_agent_request_evidence as live

    from app.domains.assistant.models import AssistantToolCall

    live.configured(monkeypatch)
    calls = []

    def urlopen(*args, **kwargs):
        calls.append(1)
        return live.Response(live.success())

    monkeypatch.setattr(llm_client.request, "urlopen", urlopen)
    original_commit = session.commit
    fired = False

    def fail_response_evidence():
        nonlocal fired
        if not fired and any(isinstance(row, AgentArtifact) and row.kind == REQUEST_EVIDENCE_KIND
                             and row.payload["status"] == "response_completed" for row in session.dirty):
            fired = True
            if ack_lost:
                original_commit()
            raise RuntimeError("synthetic settlement failure")
        original_commit()

    monkeypatch.setattr(session, "commit", fail_response_evidence)
    result = live.run_message(session, tmp_path)
    assert fired and calls == [1]
    assert result["agent_result"]["execution_outcome"]["status"] == "failed"
    assert result["agent_result"]["execution_outcome"]["code"] == "request_evidence_failed"
    assert result["proposed_patch"] is None
    aggregate = session.scalars(select(AssistantToolCall).where(
        AssistantToolCall.tool_name == "assistant.chat_loop")).one()
    assert aggregate.status == "failed"
    assert aggregate.output_summary["token_usage"] == 38
    assert aggregate.output_summary["token_usage_source"] == "provider_usage"
    payload = session.scalar(select(AgentArtifact).where(AgentArtifact.kind == REQUEST_EVIDENCE_KIND)).payload
    assert payload["status"] == ("response_completed" if ack_lost else "prepared")
