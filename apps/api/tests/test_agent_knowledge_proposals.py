from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest
from agent_loop_runtime_test_support import (
    _enable_loop_env,
    _fake_llm_script,
    _send_chat_message,
)
from fastapi.testclient import TestClient

from app.domains.agent_runs.fs import (
    FsToolError,
    KnowledgeEntry,
    KnowledgeSource,
    knowledge_claim_fingerprint,
    parse_knowledge_markdown,
    render_knowledge_entry,
)
from app.domains.agent_runs.fs.knowledge_proposals import build_knowledge_proposal_group

pytest_plugins = ("agent_loop_runtime_test_fixtures",)


def _proposal_arguments(*, claim: str = "天枢是固定架位，不是可携带物品。") -> dict[str, object]:
    return {
        "proposals": [
            {
                "target_path": "设定/天枢架.md",
                "operation": "create",
                "title": "天枢架位不可移动",
                "claim": claim,
                "kind": "world_rule",
                "confidence": "project_observed",
                "sources": [{"type": "project_file", "path": "正文/第01章.md"}],
                "related_knowledge_ids": [],
                "reason": "会影响后续所有涉及天枢的章节。",
            }
        ]
    }


def _proposal_tool_call(call_id: str, *, claim: str = "天枢是固定架位，不是可携带物品。") -> dict[str, object]:
    return {
        "id": call_id,
        "type": "function",
        "function": {
            "name": "knowledge_propose",
            "arguments": json.dumps(_proposal_arguments(claim=claim), ensure_ascii=False),
        },
    }


def test_chat_loop_records_one_durable_project_knowledge_proposal_group(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    novel_project: Path,
) -> None:
    source_path = novel_project / "正文" / "第01章.md"
    source_hash = "sha256:" + hashlib.sha256(source_path.read_bytes()).hexdigest()
    target_path = novel_project / "设定" / "天枢架.md"
    _enable_loop_env(monkeypatch)
    _fake_llm_script(
        monkeypatch,
        [
            {
                "content": "",
                "tool_calls": [_proposal_tool_call("propose-knowledge")],
                "completion_tokens": 4,
            },
            {"content": "已放入知识收件箱。", "tool_calls": [], "completion_tokens": 4},
        ],
    )

    received = _send_chat_message(
        client,
        run_id="run-knowledge-proposal",
        project_path=str(novel_project),
        message="记住天枢架不能移动，后面都要遵守。",
        permission_profile="auto",
    )

    result = received[-1]
    assert result["type"] == "agent_result", result
    assert target_path.exists() is False
    proposal_trace = next(
        trace for trace in result["tool_trace"] if trace["tool_name"] == "knowledge.propose"
    )
    assert proposal_trace["status"] == "completed", proposal_trace

    response = client.post(
        "/api/agent-runs/knowledge-proposals/query",
        json={"project_root": str(novel_project)},
    )
    assert response.status_code == 200, response.text
    inbox = response.json()
    assert inbox["pending_count"] == 1
    assert len(inbox["items"]) == 1
    group = inbox["items"][0]
    assert group["state"] == "pending"
    assert group["run_id"] == "run-knowledge-proposal"
    assert group["revision"] == 1
    assert len(group["proposals"]) == 1
    proposal = group["proposals"][0]
    assert proposal["target_path"] == "设定/天枢架.md"
    assert proposal["knowledge_id"].startswith("pk_")
    assert proposal["sources"] == [
        {
            "type": "project_file",
            "path": "正文/第01章.md",
            "content_sha256": source_hash,
        }
    ]

    encoded_trace = json.dumps(result["tool_trace"], ensure_ascii=False, sort_keys=True)
    assert "天枢是固定架位" not in encoded_trace
    assert str(novel_project.resolve()) not in encoded_trace

    events = client.get("/api/agent-runs/run-knowledge-proposal/events").json()
    encoded_events = json.dumps(events, ensure_ascii=False, sort_keys=True)
    assert "天枢是固定架位" not in encoded_events
    assert str(novel_project.resolve()) not in encoded_events
    artifacts = client.get("/api/agent-runs/run-knowledge-proposal/artifacts").json()
    assert all(item["kind"] != "knowledge_proposal" for item in artifacts)

    materialized_response = client.post(
        "/api/agent-runs/knowledge-proposals/materialize",
        json={
            "project_root": str(novel_project),
            "artifact_id": group["artifact_id"],
            "revision": group["revision"],
            "proposal_id": proposal["proposal_id"],
        },
    )
    assert materialized_response.status_code == 200, materialized_response.text
    patch = materialized_response.json()
    assert patch["kind"] == "project_knowledge"
    assert patch["artifact_id"] == group["artifact_id"]
    assert patch["patch_class"] == "project_knowledge"
    assert patch["relative_path"] == "设定/天枢架.md"
    assert patch["requires_confirmation"] is True
    assert patch["before"] == ""
    assert "<!-- storyforge-knowledge:v1" in patch["after"]
    assert proposal["knowledge_id"] in patch["after"]
    assert patch["baseline_hash"] == "sha256:" + hashlib.sha256(b"").hexdigest()
    assert target_path.exists() is False

    revised_response = client.post(
        "/api/agent-runs/knowledge-proposals/revise",
        json={
            "project_root": str(novel_project),
            "artifact_id": group["artifact_id"],
            "revision": 1,
            "proposals": [
                {
                    "target_path": "设定/天枢架.md",
                    "operation": "create",
                    "title": "天枢架位不可移动",
                    "claim": "天枢是固定架位，任何角色都不能将它作为物品携带。",
                    "kind": "world_rule",
                    "confidence": "project_observed",
                    "sources": [{"type": "project_file", "path": "正文/第01章.md"}],
                    "related_knowledge_ids": [],
                    "reason": "会影响后续所有涉及天枢的章节。",
                }
            ],
        },
    )
    assert revised_response.status_code == 200, revised_response.text
    revised_inbox = revised_response.json()
    assert revised_inbox["pending_count"] == 1
    assert [item["state"] for item in revised_inbox["items"]] == ["invalidated", "pending"]
    revised_group = revised_inbox["items"][1]
    assert revised_group["revision"] == 2
    assert revised_group["artifact_id"] != group["artifact_id"]
    assert revised_group["proposals"][0]["knowledge_id"] != proposal["knowledge_id"]

    stale_materialize = client.post(
        "/api/agent-runs/knowledge-proposals/materialize",
        json={
            "project_root": str(novel_project),
            "artifact_id": group["artifact_id"],
            "revision": 1,
            "proposal_id": proposal["proposal_id"],
        },
    )
    assert stale_materialize.status_code == 409

    revised_proposal = revised_group["proposals"][0]
    rejection_payload = {
        "project_root": str(novel_project),
        "artifact_id": revised_group["artifact_id"],
        "revision": 2,
        "proposal_id": revised_proposal["proposal_id"],
        "resolution": "rejected",
    }
    rejected_response = client.post(
        "/api/agent-runs/knowledge-proposals/resolve",
        json=rejection_payload,
    )
    assert rejected_response.status_code == 200, rejected_response.text
    rejected_inbox = rejected_response.json()
    assert rejected_inbox["pending_count"] == 0
    assert rejected_inbox["items"][1]["state"] == "rejected"
    assert rejected_inbox["items"][1]["proposals"][0]["state"] == "rejected"

    repeated_rejection = client.post(
        "/api/agent-runs/knowledge-proposals/resolve",
        json=rejection_payload,
    )
    assert repeated_rejection.status_code == 200
    rejected_materialize = client.post(
        "/api/agent-runs/knowledge-proposals/materialize",
        json={
            "project_root": str(novel_project),
            "artifact_id": revised_group["artifact_id"],
            "revision": 2,
            "proposal_id": revised_proposal["proposal_id"],
        },
    )
    assert rejected_materialize.status_code == 409


def test_agent_run_persists_at_most_one_knowledge_proposal_group(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    novel_project: Path,
) -> None:
    _enable_loop_env(monkeypatch)
    _fake_llm_script(
        monkeypatch,
        [
            {
                "content": "",
                "tool_calls": [
                    _proposal_tool_call("proposal-first"),
                    _proposal_tool_call(
                        "proposal-second",
                        claim="天枢是固定架位，第二次重复调用也不能另建一组。",
                    ),
                ],
                "completion_tokens": 4,
            },
            {"content": "已提交一组知识提议。", "tool_calls": [], "completion_tokens": 4},
        ],
    )

    received = _send_chat_message(
        client,
        run_id="run-one-knowledge-group",
        project_path=str(novel_project),
        message="把长期规则放进知识收件箱。",
    )

    result = received[-1]
    proposal_traces = [trace for trace in result["tool_trace"] if trace["tool_name"] == "knowledge.propose"]
    assert [trace["status"] for trace in proposal_traces] == ["completed", "failed"]
    inbox = client.post(
        "/api/agent-runs/knowledge-proposals/query",
        json={"project_root": str(novel_project)},
    ).json()
    assert inbox["pending_count"] == 1
    assert len(inbox["items"]) == 1


def test_external_reference_hash_must_be_lowercase_sha256(novel_project: Path) -> None:
    proposal = _proposal_arguments()
    proposal["proposals"][0]["sources"] = [  # type: ignore[index]
        {
            "type": "external_reference",
            "locator": "https://example.com/reference",
            "title": "公开参考",
            "summary_sha256": f"sha256:{'g' * 64}",
        }
    ]

    with pytest.raises(FsToolError, match="summary 或 summary_sha256"):
        build_knowledge_proposal_group(str(novel_project), proposal)


def test_revising_mixed_group_preserves_terminal_items(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    novel_project: Path,
) -> None:
    arguments = _proposal_arguments()
    second = {
        **arguments["proposals"][0],  # type: ignore[index]
        "target_path": "设定/灵脉.md",
        "title": "灵脉不可修复",
        "claim": "灵脉断裂后无法恢复。",
    }
    arguments["proposals"].append(second)  # type: ignore[union-attr]
    _enable_loop_env(monkeypatch)
    _fake_llm_script(
        monkeypatch,
        [
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "proposal-mixed",
                        "type": "function",
                        "function": {
                            "name": "knowledge_propose",
                            "arguments": json.dumps(arguments, ensure_ascii=False),
                        },
                    }
                ],
                "completion_tokens": 4,
            },
            {"content": "已提交两条知识提议。", "tool_calls": [], "completion_tokens": 4},
        ],
    )
    _send_chat_message(
        client,
        run_id="run-mixed-knowledge-group",
        project_path=str(novel_project),
        message="记录天枢和灵脉两条长期规则。",
    )
    inbox = client.post(
        "/api/agent-runs/knowledge-proposals/query",
        json={"project_root": str(novel_project)},
    ).json()
    group = inbox["items"][0]
    first, second_proposal = group["proposals"]
    rejected = client.post(
        "/api/agent-runs/knowledge-proposals/resolve",
        json={
            "project_root": str(novel_project),
            "artifact_id": group["artifact_id"],
            "revision": 1,
            "proposal_id": first["proposal_id"],
            "resolution": "rejected",
        },
    )
    assert rejected.status_code == 200

    edits = [
        {
            "target_path": item["target_path"],
            "operation": item["operation"],
            "title": item["title"],
            "claim": "灵脉断裂后永久无法恢复。" if index == 1 else item["claim"],
            "kind": item["kind"],
            "confidence": item["confidence"],
            "sources": [{"type": "project_file", "path": "正文/第01章.md"}],
            "related_knowledge_ids": item["related_knowledge_ids"],
            "reason": item["reason"],
        }
        for index, item in enumerate(group["proposals"])
    ]
    revised = client.post(
        "/api/agent-runs/knowledge-proposals/revise",
        json={
            "project_root": str(novel_project),
            "artifact_id": group["artifact_id"],
            "revision": 1,
            "proposals": edits,
        },
    )
    assert revised.status_code == 200, revised.text
    items = revised.json()["items"]
    assert [item["state"] for item in items] == ["history", "pending"]
    assert [item["state"] for item in items[0]["proposals"]] == [
        "rejected",
        "invalidated",
    ]
    assert len(items[1]["proposals"]) == 1
    assert items[1]["proposals"][0]["claim"] == "灵脉断裂后永久无法恢复。"

    stale_materialize = client.post(
        "/api/agent-runs/knowledge-proposals/materialize",
        json={
            "project_root": str(novel_project),
            "artifact_id": group["artifact_id"],
            "revision": 1,
            "proposal_id": second_proposal["proposal_id"],
        },
    )
    assert stale_materialize.status_code == 409


def test_equivalent_project_knowledge_is_suppressed_before_inbox(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    novel_project: Path,
) -> None:
    title = "天枢架位不可移动"
    claim = "天枢是固定架位，不是可携带物品。"
    entry = KnowledgeEntry(
        id="pk_550e8400-e29b-41d4-a716-446655440010",
        status="active",
        kind="world_rule",
        evidence_state="current",
        title=title,
        claim=claim,
        sources=(KnowledgeSource(type="author_statement", agent_event_id="ake_existing"),),
        claim_fingerprint=knowledge_claim_fingerprint(title, claim),
        created_at="2026-08-03T10:00:00Z",
        updated_at="2026-08-03T10:00:00Z",
    )
    target = novel_project / "设定" / "天枢架.md"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(render_knowledge_entry(entry), encoding="utf-8")
    _enable_loop_env(monkeypatch)
    _fake_llm_script(
        monkeypatch,
        [
            {
                "content": "",
                "tool_calls": [_proposal_tool_call("proposal-duplicate")],
                "completion_tokens": 4,
            },
            {"content": "已有等价知识，不重复提议。", "tool_calls": [], "completion_tokens": 4},
        ],
    )

    received = _send_chat_message(
        client,
        run_id="run-suppress-known-knowledge",
        project_path=str(novel_project),
        message="记住天枢架不能移动。",
    )

    trace = next(
        item for item in received[-1]["tool_trace"] if item["tool_name"] == "knowledge.propose"
    )
    assert trace["status"] == "completed"
    assert trace["output_summary"]["proposal_count"] == 0
    assert trace["output_summary"]["suppressed_count"] == 1
    inbox = client.post(
        "/api/agent-runs/knowledge-proposals/query",
        json={"project_root": str(novel_project)},
    ).json()
    assert inbox == {"items": [], "pending_count": 0}


def test_accepted_resolution_requires_confirmed_writeback_on_disk(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    novel_project: Path,
) -> None:
    _enable_loop_env(monkeypatch)
    _fake_llm_script(
        monkeypatch,
        [
            {
                "content": "",
                "tool_calls": [_proposal_tool_call("proposal-to-accept")],
                "completion_tokens": 4,
            },
            {"content": "知识提议等待确认。", "tool_calls": [], "completion_tokens": 4},
        ],
    )
    _send_chat_message(
        client,
        run_id="run-accept-knowledge",
        project_path=str(novel_project),
        message="把天枢规则放进知识收件箱。",
        permission_profile="full",
    )
    inbox = client.post(
        "/api/agent-runs/knowledge-proposals/query",
        json={"project_root": str(novel_project)},
    ).json()
    group = inbox["items"][0]
    proposal = group["proposals"][0]
    patch = client.post(
        "/api/agent-runs/knowledge-proposals/materialize",
        json={
            "project_root": str(novel_project),
            "artifact_id": group["artifact_id"],
            "revision": group["revision"],
            "proposal_id": proposal["proposal_id"],
        },
    ).json()
    premature = client.post(
        "/api/agent-runs/knowledge-proposals/resolve",
        json={
            "project_root": str(novel_project),
            "artifact_id": group["artifact_id"],
            "revision": group["revision"],
            "proposal_id": proposal["proposal_id"],
            "resolution": "accepted",
            "patch_identity": patch["id"],
            "author_confirmation_event_id": patch["author_confirmation_event_id"],
        },
    )
    assert premature.status_code == 409

    target = novel_project / patch["relative_path"]
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(patch["after"], encoding="utf-8")
    accepted = client.post(
        "/api/agent-runs/knowledge-proposals/resolve",
        json={
            "project_root": str(novel_project),
            "artifact_id": group["artifact_id"],
            "revision": group["revision"],
            "proposal_id": proposal["proposal_id"],
            "resolution": "accepted",
            "patch_identity": patch["id"],
            "author_confirmation_event_id": patch["author_confirmation_event_id"],
        },
    )
    assert accepted.status_code == 200, accepted.text
    accepted_inbox = accepted.json()
    assert accepted_inbox["pending_count"] == 0
    assert accepted_inbox["items"][0]["state"] == "accepted"

    repeated = client.post(
        "/api/agent-runs/knowledge-proposals/resolve",
        json={
            "project_root": str(novel_project),
            "artifact_id": group["artifact_id"],
            "revision": group["revision"],
            "proposal_id": proposal["proposal_id"],
            "resolution": "accepted",
            "patch_identity": patch["id"],
            "author_confirmation_event_id": patch["author_confirmation_event_id"],
        },
    )
    assert repeated.status_code == 200

    source = novel_project / "正文" / "第01章.md"
    source.write_text("来源正文已被作者改写。", encoding="utf-8")
    stale = client.post(
        "/api/agent-runs/knowledge-proposals/refresh",
        json={"project_root": str(novel_project)},
    )
    assert stale.status_code == 200, stale.text
    stale_inbox = stale.json()
    assert stale_inbox["pending_count"] == 1
    assert stale_inbox["items"][0]["state"] == "stale"
    persisted = target.read_text(encoding="utf-8")
    assert '"status":"active"' in persisted
    assert '"evidence_state":"current"' in persisted


def test_conflict_requires_author_revision_before_single_file_supersede_patch(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    novel_project: Path,
) -> None:
    title = "天枢架位不可移动"
    old_claim = "天枢架可以由守架人拆下携带。"
    old_entry = KnowledgeEntry(
        id="pk_550e8400-e29b-41d4-a716-446655440020",
        status="active",
        kind="world_rule",
        evidence_state="current",
        title=title,
        claim=old_claim,
        sources=(KnowledgeSource(type="author_statement", agent_event_id="ake_old"),),
        claim_fingerprint=knowledge_claim_fingerprint(title, old_claim),
        created_at="2026-08-03T09:00:00Z",
        updated_at="2026-08-03T09:00:00Z",
    )
    target = novel_project / "设定" / "天枢架.md"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(render_knowledge_entry(old_entry), encoding="utf-8")
    _enable_loop_env(monkeypatch)
    _fake_llm_script(
        monkeypatch,
        [
            {
                "content": "",
                "tool_calls": [_proposal_tool_call("proposal-conflict")],
                "completion_tokens": 4,
            },
            {"content": "发现冲突，等待作者裁决。", "tool_calls": [], "completion_tokens": 4},
        ],
    )
    _send_chat_message(
        client,
        run_id="run-conflicting-knowledge",
        project_path=str(novel_project),
        message="天枢架绝对不能移动。",
    )
    inbox = client.post(
        "/api/agent-runs/knowledge-proposals/query",
        json={"project_root": str(novel_project)},
    ).json()
    group = inbox["items"][0]
    proposal = group["proposals"][0]
    assert group["state"] == "conflict"
    assert proposal["operation"] == "conflict"
    assert proposal["related_knowledge_ids"] == [old_entry.id]
    assert proposal["conflicts"] == [
        {
            "knowledge_id": old_entry.id,
            "relative_path": "设定/天枢架.md",
            "title": title,
            "claim": old_claim,
            "status": "active",
            "evidence_state": "current",
            "sources": [{"type": "author_statement", "agent_event_id": "ake_old"}],
        }
    ]

    unresolved = client.post(
        "/api/agent-runs/knowledge-proposals/materialize",
        json={
            "project_root": str(novel_project),
            "artifact_id": group["artifact_id"],
            "revision": 1,
            "proposal_id": proposal["proposal_id"],
        },
    )
    assert unresolved.status_code == 409

    revised = client.post(
        "/api/agent-runs/knowledge-proposals/revise",
        json={
            "project_root": str(novel_project),
            "artifact_id": group["artifact_id"],
            "revision": 1,
            "proposals": [
                {
                    **_proposal_arguments()["proposals"][0],
                    "operation": "supersede",
                    "related_knowledge_ids": [old_entry.id],
                }
            ],
        },
    ).json()
    revised_group = revised["items"][1]
    revised_proposal = revised_group["proposals"][0]
    materialized = client.post(
        "/api/agent-runs/knowledge-proposals/materialize",
        json={
            "project_root": str(novel_project),
            "artifact_id": revised_group["artifact_id"],
            "revision": 2,
            "proposal_id": revised_proposal["proposal_id"],
        },
    )
    assert materialized.status_code == 200, materialized.text
    patch = materialized.json()
    parsed = parse_knowledge_markdown(patch["after"])
    assert [entry.status for entry in parsed.entries] == ["superseded", "active"]
    assert parsed.entries[0].id == old_entry.id
    assert parsed.entries[0].superseded_by == revised_proposal["knowledge_id"]
    assert parsed.entries[1].id == revised_proposal["knowledge_id"]

    disputed = client.post(
        "/api/agent-runs/knowledge-proposals/revise",
        json={
            "project_root": str(novel_project),
            "artifact_id": revised_group["artifact_id"],
            "revision": 2,
            "proposals": [
                {
                    **_proposal_arguments()["proposals"][0],
                    "operation": "dispute",
                    "related_knowledge_ids": [old_entry.id],
                }
            ],
        },
    )
    assert disputed.status_code == 200, disputed.text
    disputed_group = disputed.json()["items"][-1]
    disputed_proposal = disputed_group["proposals"][0]
    disputed_patch = client.post(
        "/api/agent-runs/knowledge-proposals/materialize",
        json={
            "project_root": str(novel_project),
            "artifact_id": disputed_group["artifact_id"],
            "revision": 3,
            "proposal_id": disputed_proposal["proposal_id"],
        },
    )
    assert disputed_patch.status_code == 200, disputed_patch.text
    disputed_entries = parse_knowledge_markdown(disputed_patch.json()["after"]).entries
    assert [entry.status for entry in disputed_entries] == ["disputed", "disputed"]
    assert {entry.id for entry in disputed_entries} == {
        old_entry.id,
        disputed_proposal["knowledge_id"],
    }
