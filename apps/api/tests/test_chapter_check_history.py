"""Read-only, project/conversation-bound check history and candidate association."""

from __future__ import annotations

import pytest
from agent_run_test_support import _seed_agent_run
from sqlalchemy import func, select

from app.domains.agent_runs.adapters.chapter_check_protocol import build_check
from app.domains.agent_runs.models import AgentArtifact
from app.domains.agent_runs.service import record_agent_artifact
from app.domains.assistant.schemas import AssistantSessionCreate
from app.domains.assistant.service import create_assistant_session


def _publish(session, conversation, *, run_id, content="候选稿" * 600, candidate=True):
    brief = {"brief_id": run_id, "target_path": "正文/第001章.md", "target_chars_min": 1000, "target_chars_max": 2600}
    run = _seed_agent_run(session, public_id=run_id)
    run.assistant_session_id = conversation.id
    run.status = "completed"
    session.commit()
    check = build_check(content, brief, "{}")
    record_agent_artifact(session, run, kind="chapter_brief", payload=brief, requires_confirmation=False)
    check_row = record_agent_artifact(session, run, kind="chapter_check", payload=check, requires_confirmation=False)
    candidate_row = None
    if candidate:
        candidate_row = record_agent_artifact(
            session,
            run,
            kind="chapter_candidate",
            payload={
                "target_path": brief["target_path"],
                "brief_id": brief["brief_id"],
                "brief_sha256": check["brief_sha256"],
                "content_sha256": check["content_sha256"],
                "content": content,
                "read_only": True,
                "execution_status": check["execution_status"],
                "manuscript_status": check["manuscript_status"],
            },
            requires_confirmation=False,
        )
    return run, check_row, candidate_row


def _query(client, project, conversation, **overrides):
    return client.post(
        "/api/agent-runs/chapter-checks/query",
        json={
            "project_root": str(project),
            "assistant_session_id": conversation.id,
            **overrides,
        },
    )


def test_public_history_restores_exact_candidate_without_provider_or_mutations(session, client, tmp_path):
    conversation = create_assistant_session(
        session,
        AssistantSessionCreate(title="检查记录", task_type="ide_agent_orchestration", project_path=str(tmp_path)),
    )
    run, check, candidate = _publish(session, conversation, run_id="history-own")
    count = session.scalar(select(func.count(AgentArtifact.id)))
    response = _query(client, tmp_path, conversation)
    assert response.status_code == 200
    result = response.json()
    assert result["assistant_session_id"] == conversation.id
    assert result["project_root"] == str(tmp_path)
    assert result["truncated"] is False
    assert len(result["entries"]) == 1
    entry = result["entries"][0]
    assert entry["run_id"] == run.public_id
    assert entry["check_artifact_id"] == check.id
    assert entry["check"] == check.payload
    assert entry["candidate"] == candidate.payload
    assert entry["candidate_artifact_id"] == candidate.id
    assert entry["target_path"] == "正文/第001章.md"
    assert entry["candidate_error"] is None
    assert _query(client, tmp_path / ".", conversation).status_code == 200
    assert session.scalar(select(func.count(AgentArtifact.id))) == count
    assert list(tmp_path.iterdir()) == []


def test_history_never_crosses_conversation_or_project_and_unbound_history_is_rejected(session, client, tmp_path):
    own = create_assistant_session(
        session,
        AssistantSessionCreate(title="检查记录", task_type="ide_agent_orchestration", project_path=str(tmp_path)),
    )
    other = create_assistant_session(
        session,
        AssistantSessionCreate(title="检查记录", task_type="ide_agent_orchestration", project_path=str(tmp_path)),
    )
    unbound = create_assistant_session(
        session, AssistantSessionCreate(title="旧会话", task_type="ide_agent_orchestration")
    )
    _publish(session, own, run_id="history-a")
    _publish(session, other, run_id="history-b", content="他人候选" * 450)
    own_result = _query(client, tmp_path, own)
    assert own_result.status_code == 200
    assert [entry["run_id"] for entry in own_result.json()["entries"]] == ["history-a"]
    assert _query(client, tmp_path / "other", own).status_code == 409
    assert _query(client, tmp_path, unbound).status_code == 409


def test_history_limit_is_latest_and_empty_is_success_not_failure(session, client, tmp_path):
    conversation = create_assistant_session(
        session,
        AssistantSessionCreate(title="检查记录", task_type="ide_agent_orchestration", project_path=str(tmp_path)),
    )
    empty = _query(client, tmp_path, conversation)
    assert empty.status_code == 200 and empty.json()["entries"] == []
    for index in range(3):
        _publish(session, conversation, run_id=f"history-{index}")
    limited = _query(client, tmp_path, conversation, limit=2).json()
    assert limited["truncated"] is True
    assert [entry["run_id"] for entry in limited["entries"]] == ["history-2", "history-1"]
    assert _query(client, tmp_path, conversation, limit=0).status_code == 422
    assert _query(client, tmp_path, conversation, limit=51).status_code == 422


def test_candidate_mismatch_or_duplicates_are_explicit_and_never_rebound(session, client, tmp_path):
    conversation = create_assistant_session(
        session,
        AssistantSessionCreate(title="检查记录", task_type="ide_agent_orchestration", project_path=str(tmp_path)),
    )
    run, _, candidate = _publish(session, conversation, run_id="history-bad-binding")
    candidate.payload = {**candidate.payload, "content_sha256": "0" * 64}
    session.commit()
    entry = _query(client, tmp_path, conversation).json()["entries"][0]
    assert entry["candidate"] is None and entry["candidate_error"]
    record_agent_artifact(
        session, run, kind="chapter_candidate", payload=candidate.payload, requires_confirmation=False
    )
    entry = _query(client, tmp_path, conversation).json()["entries"][0]
    assert entry["candidate"] is None and entry["candidate_error"]


def test_later_check_in_same_run_cannot_reuse_the_previous_candidate(session, client, tmp_path):
    conversation = create_assistant_session(
        session,
        AssistantSessionCreate(title="检查记录", task_type="ide_agent_orchestration", project_path=str(tmp_path)),
    )
    run, first, candidate = _publish(session, conversation, run_id="history-two-checks")
    second = record_agent_artifact(
        session, run, kind="chapter_check", payload=first.payload, requires_confirmation=False
    )
    entries = _query(client, tmp_path, conversation).json()["entries"]
    assert [entry["check_artifact_id"] for entry in entries] == [second.id, first.id]
    assert entries[0]["candidate"] is None
    assert entries[1]["candidate_artifact_id"] == candidate.id


@pytest.mark.parametrize("tamper", ["before", "after", "approval_action", "read_only", "content", "confirmation"])
def test_candidate_authority_or_content_tampering_is_not_displayed(session, client, tmp_path, tamper):
    conversation = create_assistant_session(
        session,
        AssistantSessionCreate(title="检查记录", task_type="ide_agent_orchestration", project_path=str(tmp_path)),
    )
    _, _, candidate = _publish(session, conversation, run_id=f"history-tamper-{tamper}")
    if tamper == "confirmation":
        candidate.requires_confirmation = True
    else:
        candidate.payload = {
            **candidate.payload,
            tamper: False if tamper == "read_only" else "未绑定正文或写权限",
        }
    session.commit()
    response = _query(client, tmp_path, conversation)
    assert response.status_code == 200
    entry = response.json()["entries"][0]
    assert entry["candidate"] is None and entry["candidate_error"]
    assert entry["candidate_artifact_id"] is None
    assert list(tmp_path.iterdir()) == []


def test_history_request_is_strict_and_requires_the_normal_api_key(session, client, tmp_path):
    conversation = create_assistant_session(
        session,
        AssistantSessionCreate(title="检查记录", task_type="ide_agent_orchestration", project_path=str(tmp_path)),
    )
    _publish(session, conversation, run_id="history-validation")
    for override in ({"assistant_session_id": True}, {"limit": True}, {"limit": "20"}, {"unknown": "field"}):
        assert _query(client, tmp_path, conversation, **override).status_code == 422
    response = client.post(
        "/api/agent-runs/chapter-checks/query",
        headers={"X-StoryForge-API-Key": "synthetic-wrong-key"},
        json={"project_root": str(tmp_path), "assistant_session_id": conversation.id},
    )
    assert response.status_code == 401
    assert list(tmp_path.iterdir()) == []


def test_legacy_check_remains_unverified_and_is_not_upgraded_on_read(session, client, tmp_path):
    conversation = create_assistant_session(
        session,
        AssistantSessionCreate(title="检查记录", task_type="ide_agent_orchestration", project_path=str(tmp_path)),
    )
    _, check, _ = _publish(session, conversation, run_id="history-legacy", candidate=False)
    check.payload = {"status": "pass", "findings": []}
    session.commit()
    entry = _query(client, tmp_path, conversation).json()["entries"][0]
    assert entry["check"] == {"status": "pass", "findings": []}
    assert entry["target_path"] is None
    assert entry["candidate"] is None
