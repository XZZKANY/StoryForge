from __future__ import annotations

import json

import pytest
from sqlalchemy import select

from app.common import llm_client
from app.domains.agent_runs import service
from app.domains.agent_runs.models import AgentArtifact, AgentRunEvent
from app.domains.assistant import service as assistant_service
from app.platform.ai_sdk import ChatMessage, ChatRequest, MessageRole, ProviderContinuation


class Response:
    def __init__(self, data):
        self.data = data
    def __enter__(self):
        return self
    def __exit__(self, *args):
        return False
    def read(self):
        return json.dumps(self.data).encode()


def configured(monkeypatch):
    source = {
        "STORYFORGE_LLM_MODEL": "actual-model", "STORYFORGE_LLM_PROVIDER": "openai",
        "STORYFORGE_LLM_BASE_URL": "https://fixture.invalid/v1",
        "STORYFORGE_LLM_API_KEY": "opaque-configured-credential",
        "STORYFORGE_LLM_TEMPERATURE": "0.3", "STORYFORGE_LLM_MAX_COMPLETION_TOKENS": "700",
    }
    monkeypatch.setattr(assistant_service, "missing_llm_env", lambda: [])
    monkeypatch.setattr(assistant_service, "resolved_llm_env", lambda: source)
    return source


def run_message(session, tmp_path, text="检查人物对白", *, run_id="request-evidence", project=True):
    message = {"type": "user_message", "run_id": run_id, "user_message": text,
               "intent": "chat.explain", "permission_profile": "ask",
               "args": {"project_path": str(tmp_path), "context_bundle": {"files": []}} if project else {}}
    start = service.start_agent_user_message_run(session, agent_session_id="evidence-session", message=message)
    return service.execute_agent_user_message_run(session, run=start.run,
                                                  agent_session_id="evidence-session", message=message)


def success():
    return {"choices": [{"message": {"role": "assistant", "content": "人物对白保持一致。"},
                         "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 30, "completion_tokens": 8, "total_tokens": 38}}


@pytest.mark.parametrize("project", [True, False])
def test_actual_request_committed_before_dispatch_and_rebuildable(session, tmp_path, monkeypatch, project):
    configured(monkeypatch)
    sent = []

    def urlopen(request, *, timeout):
        records = list(session.scalars(select(AgentArtifact).where(AgentArtifact.kind == "model_request_evidence")))
        assert len(records) == 1, "actual request needs durable pre-dispatch evidence"
        assert records[0].payload["status"] == "prepared"
        sent.append(json.loads(request.data))
        return Response(success())

    monkeypatch.setattr(llm_client.request, "urlopen", urlopen)
    result = run_message(session, tmp_path, project=project)
    assert result["agent_result"]["summary"]
    records = list(session.scalars(select(AgentArtifact).where(AgentArtifact.kind == "model_request_evidence")))
    assert len(records) == 1
    payload = records[0].payload
    assert payload["status"] == "response_completed"
    assert payload["run_id"] == "request-evidence"
    assert payload["usage"]["token_usage"] == 38
    assert payload["request"]["model"] == "actual-model"
    assert payload["request"]["messages"] == sent[0]["messages"]
    assert payload["request"]["tools"] == sent[0].get("tools", [])
    assert payload["prompt_version"] and payload["tool_schema_version"]
    from app.domains.agent_runs.request_evidence import rebuild_normalized_request
    rebuilt = rebuild_normalized_request(payload)
    assert rebuilt.model == sent[0]["model"]
    assert [message.to_openai() for message in rebuilt.messages] == sent[0]["messages"]
    assert not service.list_agent_artifacts(session, "request-evidence")
    assert all("检查人物对白" not in json.dumps(event.payload, ensure_ascii=False)
               for event in session.scalars(select(AgentRunEvent).where(AgentRunEvent.event_type == "agent_artifact")))


def test_snapshot_redacts_secrets_and_omits_continuation(session, tmp_path, monkeypatch):
    from app.domains.agent_runs.request_evidence import agent_request_evidence_scope, rebuild_normalized_request
    source = configured(monkeypatch)
    run = service.start_agent_user_message_run(session, agent_session_id="secret-session", message={
        "type": "user_message", "run_id": "secret-evidence", "user_message": "检查", "args": {},
    }).run
    monkeypatch.setattr(llm_client.request, "urlopen", lambda *args, **kwargs: Response(success()))
    request = ChatRequest(model="actual-model", messages=(ChatMessage(
        MessageRole.USER, "敏感片段 opaque-configured-credential",
        continuation=ProviderContinuation("fixture", {"native_signature": "must-not-persist"}),
    ),))
    with agent_request_evidence_scope(session, run):
        llm_client.build_llm_provider(source).complete(request)
    payload = session.scalar(select(AgentArtifact).where(AgentArtifact.kind == "model_request_evidence")).payload
    encoded = json.dumps(payload)
    assert "opaque-configured-credential" not in encoded
    assert "must-not-persist" not in encoded
    assert payload["omissions"]
    with pytest.raises(ValueError, match="redacted"):
        rebuild_normalized_request(payload)


def test_reconstruction_rejects_changed_snapshot(session, tmp_path, monkeypatch):
    from app.domains.agent_runs.request_evidence import rebuild_normalized_request
    configured(monkeypatch)
    monkeypatch.setattr(llm_client.request, "urlopen", lambda *args, **kwargs: Response(success()))
    run_message(session, tmp_path)
    payload = session.scalar(select(AgentArtifact).where(AgentArtifact.kind == "model_request_evidence")).payload
    payload["request"]["messages"][0]["content"] = "changed after commitment"
    with pytest.raises(ValueError, match="digest"):
        rebuild_normalized_request(payload)


def test_completed_stream_is_settled_before_consumer_returns(session, monkeypatch):
    from app.common.llm_observation import observe_provider
    from app.domains.agent_runs.request_evidence import agent_request_evidence_scope
    from app.platform.ai_sdk import ChatResponse, StreamEvent, StreamEventKind, TokenUsage

    class Provider:
        def stream(self, request):
            yield StreamEvent(StreamEventKind.COMPLETED, response=ChatResponse(
                content="complete", finish_reason="stop", usage=TokenUsage(10, 2, 12, source="provider_usage")))

    run = service.start_agent_user_message_run(session, agent_session_id="stream-evidence", message={
        "type": "user_message", "run_id": "stream-evidence", "user_message": "检查", "args": {},
    }).run
    with agent_request_evidence_scope(session, run):
        iterator = observe_provider(Provider(), configured(monkeypatch)).stream(ChatRequest("model", ()))
        next(iterator)
        payload = session.scalar(select(AgentArtifact).where(AgentArtifact.kind == "model_request_evidence")).payload
        assert payload["status"] == "response_completed", "COMPLETED must commit before caller leaves generator"
        iterator.close()
    payload = session.scalar(select(AgentArtifact).where(AgentArtifact.kind == "model_request_evidence")).payload
    assert payload["status"] == "response_completed"
    assert payload["usage"]["token_usage"] == 12


def test_reused_provider_observes_current_scope_not_constructor_scope(session, monkeypatch):
    from app.common.llm_observation import observe_provider
    from app.domains.agent_runs.request_evidence import agent_request_evidence_scope
    from app.platform.ai_sdk import ChatResponse

    class Provider:
        def complete(self, request):
            return ChatResponse("complete", finish_reason="stop")

    runs = [service.start_agent_user_message_run(session, agent_session_id="scope", message={
        "type": "user_message", "run_id": name, "user_message": "检查", "args": {},
    }).run for name in ("scope-first", "scope-second")]
    with agent_request_evidence_scope(session, runs[0]):
        provider = observe_provider(Provider(), configured(monkeypatch))
        provider.complete(ChatRequest("model", ()))
    provider.complete(ChatRequest("model", ()))
    with agent_request_evidence_scope(session, runs[1]):
        provider.complete(ChatRequest("model", ()))
    records = list(session.scalars(select(AgentArtifact).where(AgentArtifact.kind == "model_request_evidence")))
    assert [item.run_id for item in records] == [item.id for item in runs]


def test_retry_progress_is_bound_to_actual_logical_request(session, session_factory, tmp_path, monkeypatch):
    from test_agent_network_cancellation import JsonResponse, execute, model_response, setup_run, throttle
    setup_run(monkeypatch, tmp_path, session_factory, cancel_on_wait=False)
    calls = []

    def urlopen(request, *, timeout):
        calls.append(request)
        if len(calls) == 1:
            raise throttle()
        return JsonResponse(model_response())

    monkeypatch.setattr(llm_client.request, "urlopen", urlopen)
    execute(session, tmp_path)
    payload = session.scalar(select(AgentArtifact).where(AgentArtifact.kind == "model_request_evidence")).payload
    assert len(calls) == 2
    assert [item["phase"] for item in payload["transport_progress"]] == [
        "request_started", "retry_wait", "retry_started", "request_started"]
    assert [item["request_number"] for item in payload["transport_progress"]] == [1, 1, 1, 2]


def test_short_configured_secret_and_native_provenance_do_not_enter_storage(session, monkeypatch):
    from app.common.llm_observation import model_operation, observe_provider
    from app.domains.agent_runs.request_evidence import agent_request_evidence_scope
    from app.platform.ai_sdk import ChatResponse

    class Provider:
        def complete(self, request):
            return ChatResponse("ok", finish_reason="stop")

    source = configured(monkeypatch)
    source["STORYFORGE_LLM_API_KEY"] = "cRed"
    run = service.start_agent_user_message_run(session, agent_session_id="privacy", message={
        "type": "user_message", "run_id": "privacy", "user_message": "检查", "args": {},
    }).run
    with agent_request_evidence_scope(session, run), model_operation("test", provenance={
        "snapshot_id": "public-reference", "continuation": {"native_signature": "native-state-must-not-persist"},
    }):
        observe_provider(Provider(), source).complete(ChatRequest(
            "model", (ChatMessage(MessageRole.USER, "sample cRed and ordinary prose"),)))
    payload = session.scalar(select(AgentArtifact).where(AgentArtifact.kind == "model_request_evidence")).payload
    encoded = json.dumps(payload)
    assert "cRed" not in encoded
    assert "native-state-must-not-persist" not in encoded
    assert payload["redacted"] is True
    assert payload["context_provenance"]["snapshot_id"] == "public-reference"


def test_stream_request_scope_is_reset_when_provider_raises_before_iterator(session, monkeypatch):
    from app.common.llm_observation import observe_provider
    from app.domains.agent_runs.request_evidence import agent_request_evidence_scope

    class Provider:
        def stream(self, request):
            raise RuntimeError("opaque-configured-credential")

    run = service.start_agent_user_message_run(session, agent_session_id="setup-error", message={
        "type": "user_message", "run_id": "setup-error", "user_message": "检查", "args": {},
    }).run
    with agent_request_evidence_scope(session, run), pytest.raises(RuntimeError):
        list(observe_provider(Provider(), configured(monkeypatch)).stream(ChatRequest("model", ())))
    payload = session.scalar(select(AgentArtifact).where(AgentArtifact.kind == "model_request_evidence")).payload
    assert payload["status"] == "request_failed"
    assert "opaque-configured-credential" not in json.dumps(payload)
    assert payload["usage"]["token_usage_source"] == "unavailable"


def test_live_nested_revision_records_actual_requests_sources_and_does_not_write_manuscript(
    session, tmp_path, monkeypatch,
):
    import hashlib

    from app.domains.agent_runs.request_evidence import rebuild_normalized_request

    configured(monkeypatch)
    before = "林岚推开窗，望向码头。她想知道那封信是谁送来的，却不肯开口询问。\n"
    after = "林岚推开窗。码头静悄悄的，她攥紧那封信，终究没有问出口。\n"
    path = tmp_path / "chapter.md"
    path.write_text(before, encoding="utf-8")
    control_dir = tmp_path / ".storyforge"
    control_dir.mkdir()
    (control_dir / "agent-instructions.md").write_text("保持开放式结局，不提前揭示寄信人。", encoding="utf-8")
    sent = []

    def urlopen(request, *, timeout):
        sent.append(json.loads(request.data))
        if sent[-1].get("stream"):
            import io
            frame = {"choices": [{"delta": {"content": after}, "finish_reason": "stop"}],
                     "usage": {"prompt_tokens": 30, "completion_tokens": 8, "total_tokens": 38}}
            return io.BytesIO(("data: " + json.dumps(frame) + "\n\ndata: [DONE]\n\n").encode())
        if len(sent) == 1:
            response = success()
            response["choices"][0] = {"finish_reason": "tool_calls", "message": {
                "role": "assistant", "content": "", "tool_calls": [{"id": "revise-1", "type": "function",
                "function": {"name": "file_revise", "arguments": json.dumps({
                    "path": "chapter.md", "instruction": "对白改得克制，不改结局。",
                }, ensure_ascii=False)}}],
            }}
        else:
            response = success()
            response["choices"][0]["message"]["content"] = after if len(sent) == 2 else "修订提案已生成，等待确认。"
        return Response(response)

    monkeypatch.setattr(llm_client.request, "urlopen", urlopen)
    result = run_message(session, tmp_path, "修改 chapter.md 对白，不改结局。")
    assert result["proposed_patch"]["after"] == after.rstrip(), result
    assert path.read_text(encoding="utf-8") == before
    payloads = [row.payload for row in session.scalars(select(AgentArtifact).where(
        AgentArtifact.kind == "model_request_evidence").order_by(AgentArtifact.id))]
    assert len(sent) == len(payloads) == 3
    assert [item["step"] for item in payloads] == ["agent.loop", "file.revise", "agent.loop"]
    assert len({item["attempt_id"] for item in payloads}) == 3
    for payload, outbound in zip(payloads, sent, strict=True):
        rebuilt = rebuild_normalized_request(payload)
        assert [message.to_openai() for message in rebuilt.messages] == outbound["messages"]
        assert [tool.to_openai() for tool in rebuilt.tools] == outbound.get("tools", [])
        assert payload["assistant_session_id"] == result["assistant_session_id"]
    provenance = payloads[0]["context_provenance"]
    assert provenance["source_basis"] == "compiled_context_not_current_disk_verification"
    sections = {item["section"]: item for item in provenance["sections"]}
    for section in sections.values():
        entries = [sent[0]["messages"][index] for index in section["message_indices"]]
        assert section["sha256"] == hashlib.sha256(json.dumps(
            entries, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    assert sections["author_instructions"]["message_indices"]
    assert sections["pinned_context"]["omission_reason"] == "context_builder_returned_empty"
    nested = payloads[1]["context_provenance"]
    assert nested["kind"] == "llm_context_snapshot"
    assert nested["selected_file"]["file_path"] == "chapter.md"
    assert nested["snapshot_id"].startswith("llmctx-")
    assert before.rstrip() in nested["selected_file"]["content_excerpt"]
