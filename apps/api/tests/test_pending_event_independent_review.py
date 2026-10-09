"""独立验证公共投影不修改私有数据，且异常恢复元数据不能泄露正文。"""

import json
from copy import deepcopy
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from app.domains.agent_runs.event_encoders import encode_agent_run_sse_event
from app.domains.agent_runs.schemas import AgentRunEventRead


def public_versions(payload):
    now = datetime.now(UTC)
    event = SimpleNamespace(
        id=1,
        run_id=1,
        event_type="agent_artifact",
        actor="root-agent",
        message="恢复事件",
        payload=payload,
        sequence=1,
        created_at=now,
        updated_at=now,
    )
    rest = AgentRunEventRead.model_validate(event).model_dump(mode="json")
    sse = encode_agent_run_sse_event(event)
    return rest, sse


@pytest.mark.parametrize(
    "body", [None, [], "PRIVATE_BAD_PAYLOAD", {"status": "pending", "resume_message": "PRIVATE_BAD_PAYLOAD"}]
)
def test_malformed_private_pending_payload_is_not_exposed(body):
    envelope = {"kind": "runtime_pending_call", "artifact_id": 5, "requires_confirmation": False, "payload": body}
    before = deepcopy(envelope)
    for public in public_versions(envelope):
        assert "PRIVATE_BAD_PAYLOAD" not in json.dumps(public)
    assert envelope == before


def test_private_pending_envelope_extra_fields_are_not_public():
    envelope = {
        "kind": "runtime_pending_call",
        "artifact_id": 5,
        "requires_confirmation": False,
        "payload": {"status": "pending", "intent": "chapter.write"},
        "resume_message": {"project_path": "PRIVATE_ENVELOPE_PATH"},
        "context": "PRIVATE_ENVELOPE_CONTEXT",
    }
    before = deepcopy(envelope)
    for public in public_versions(envelope):
        rendered = json.dumps(public)
        assert "PRIVATE_ENVELOPE" not in rendered
    assert envelope == before


def test_missing_optional_envelope_fields_does_not_restore_private_pending_body():
    envelope = {
        "kind": "runtime_pending_call",
        "payload": {
            "status": "pending",
            "intent": "chapter.write",
            "resume_message": {"args": {"project_path": "PRIVATE_MISSING_METADATA"}},
        },
    }
    before = deepcopy(envelope)
    for public in public_versions(envelope):
        assert "PRIVATE_MISSING_METADATA" not in json.dumps(public)
    assert envelope == before


def test_public_resume_fields_cannot_rebind_private_project(session, tmp_path, monkeypatch):
    from chapter_check_test_support import chapter_check_reply
    from sqlalchemy import select
    from test_chapter_brief_source_binding import begin

    from app.domains.agent_runs.models import AgentArtifact
    from app.domains.agent_runs.service import handle_agent_control_message
    from app.domains.assistant import service as assistant_service

    project, foreign = tmp_path / "admitted", tmp_path / "foreign"
    for root, marker in ((project, "ADMITTED_MATERIAL"), (foreign, "FOREIGN_MATERIAL")):
        root.mkdir()
        (root / "setting.txt").write_text(marker, encoding="utf-8")
        (root / "第001章.md").write_text("", encoding="utf-8")

    def chat(_session, *, user_message, **_kwargs):
        if "整理成 Chapter Brief" in user_message:
            return {"reply": '{"goal":"建立冲突"}'}
        return chapter_check_reply(user_message, [])

    writers = []

    def writer(_source, *, user_prompt, **_kwargs):
        writers.append(user_prompt)
        assert "ADMITTED_MATERIAL" in user_prompt
        assert "FOREIGN_MATERIAL" not in user_prompt
        return {"content": "一" * 1800}

    monkeypatch.setattr(assistant_service, "chat_reply", chat)
    monkeypatch.setattr(assistant_service, "missing_book_generation_env", lambda: [])
    monkeypatch.setattr(assistant_service, "resolved_llm_env", lambda: {"STORYFORGE_LLM_MODEL": "fake-model"})
    monkeypatch.setattr(assistant_service, "_call_llm_streamed", writer)
    run, initial = begin(
        session,
        project,
        project / "第001章.md",
        {"project_root": str(project), "files": [{"relative_path": "setting.txt", "kind": "setting"}]},
    )
    pending = session.scalars(select(AgentArtifact).where(AgentArtifact.kind == "runtime_pending_call")).one()
    frozen = deepcopy(pending.payload)
    result = handle_agent_control_message(
        session,
        public_id=run.public_id,
        session_id=run.session_id,
        control_type="resume_run",
        payload={
            "chapter_brief": initial["agent_result"]["chapter_brief"],
            "project_path": str(foreign),
            "args": {"project_path": str(foreign)},
            "resume_message": {"args": {"project_path": str(foreign)}},
        },
    )
    assert result.resumed_result is not None
    assert len(writers) == 1
    session.refresh(pending)
    assert pending.payload == frozen
    assert (project / "第001章.md").read_text(encoding="utf-8") == ""
    assert (foreign / "第001章.md").read_text(encoding="utf-8") == ""


@pytest.mark.parametrize("field", ["artifact_id", "requires_confirmation"])
def test_invalid_envelope_metadata_cannot_smuggle_private_data(field):
    envelope = {
        "kind": "runtime_pending_call",
        "artifact_id": 5,
        "requires_confirmation": False,
        "payload": {"intent": "chapter.write", "status": "pending"},
    }
    envelope[field] = {"private": "PRIVATE_ENVELOPE_METADATA"}
    before = deepcopy(envelope)
    for public in public_versions(envelope):
        assert "PRIVATE_ENVELOPE_METADATA" not in json.dumps(public)
    assert envelope == before
