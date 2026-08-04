from __future__ import annotations

import hashlib
from pathlib import Path

from app.domains.agent_runs.fs import (
    KnowledgeEntry,
    KnowledgeSource,
    knowledge_claim_fingerprint,
    render_knowledge_entry,
    retrieve_project_knowledge,
)
from app.domains.agent_runs.llm_context import (
    build_llm_context_snapshot,
    llm_context_snapshot_to_prompt_context_bundle,
    llm_context_snapshot_trace_summary,
)
from app.domains.agent_runs.tools.runtime_arguments import llm_context_input_summary


def _entry(*, suffix: int, title: str, claim: str, status: str = "active") -> KnowledgeEntry:
    return KnowledgeEntry(
        id=f"pk_550e8400-e29b-41d4-a716-44665544{suffix:04d}",
        status=status,  # type: ignore[arg-type]
        kind="world_rule",
        evidence_state="current",
        title=title,
        claim=claim,
        sources=(KnowledgeSource(type="author_statement", agent_event_id=f"ake_{suffix}"),),
        claim_fingerprint=knowledge_claim_fingerprint(title, claim),
        created_at="2026-08-03T10:00:00Z",
        updated_at="2026-08-03T10:00:00Z",
        superseded_by=(
            "pk_550e8400-e29b-41d4-a716-446655449999" if status == "superseded" else None
        ),
    )


def test_retriever_prioritizes_pins_and_excludes_non_active_entries(tmp_path: Path) -> None:
    setting = tmp_path / "设定"
    setting.mkdir()
    pinned = _entry(suffix=1, title="灵脉规则", claim="灵脉断裂后无法恢复。")
    relevant = _entry(suffix=2, title="天枢架", claim="天枢是固定架位，不能移动。")
    retired = _entry(
        suffix=3,
        title="旧天枢规则",
        claim="天枢可以随身携带。",
        status="retired",
    )
    (setting / "灵脉.md").write_text(render_knowledge_entry(pinned), encoding="utf-8")
    (setting / "天枢.md").write_text(
        render_knowledge_entry(relevant) + "\n" + render_knowledge_entry(retired),
        encoding="utf-8",
    )

    result = retrieve_project_knowledge(
        str(tmp_path),
        query="本章主角试图搬走天枢架",
        pinned_paths=["设定/灵脉.md"],
    )

    assert [item.entry.id for item in result.items] == [pinned.id, relevant.id]
    assert [item.selection_source for item in result.items] == [
        "author_pinned",
        "auto_retrieved",
    ]
    assert retired.id not in {item.entry.id for item in result.items}
    assert result.total_chars <= 4000


def test_active_retrieval_enters_trusted_snapshot_with_safe_provenance(tmp_path: Path) -> None:
    setting = tmp_path / "设定"
    setting.mkdir()
    active = _entry(suffix=11, title="天枢架", claim="天枢架不能移动。ACTIVE_KNOWLEDGE_SENTINEL")
    retired = _entry(
        suffix=12,
        title="旧天枢架",
        claim="天枢架可以移动。RETIRED_KNOWLEDGE_SENTINEL",
        status="retired",
    )
    (setting / "天枢.md").write_text(
        render_knowledge_entry(active) + "\n" + render_knowledge_entry(retired),
        encoding="utf-8",
    )

    snapshot = build_llm_context_snapshot(
        run_state=None,
        intent="file.create",
        user_message="写主角试图搬走天枢架的场景",
        file_path="正文/第002章.md",
        content="",
        context_bundle={"project_root": str(tmp_path), "files": []},
    )

    knowledge = [item for item in snapshot["context_files"] if item.get("knowledge_id")]
    assert len(knowledge) == 1
    assert knowledge[0]["knowledge_id"] == active.id
    assert knowledge[0]["selection_source"] == "auto_retrieved"
    assert knowledge[0]["evidence_state"] == "current"
    prompt_bundle = llm_context_snapshot_to_prompt_context_bundle(snapshot)
    prompt = "\n".join(item["excerpt"] for item in prompt_bundle["files"])
    assert "ACTIVE_KNOWLEDGE_SENTINEL" in prompt
    assert "RETIRED_KNOWLEDGE_SENTINEL" not in prompt
    trace = llm_context_snapshot_trace_summary(snapshot)
    assert trace["knowledge_entries"] == [
        {
            "knowledge_id": active.id,
            "relative_path": "设定/天枢.md",
            "selection_source": "auto_retrieved",
            "evidence_state": "current",
            "warning_count": 0,
        }
    ]
    assert "ACTIVE_KNOWLEDGE_SENTINEL" not in str(trace)
    provenance = llm_context_input_summary(snapshot)["context_provenance"]
    assert provenance["knowledge_entries"] == [
        {
            **trace["knowledge_entries"][0],
            "snapshot_id": snapshot["snapshot_id"],
        }
    ]


def test_source_hash_drift_warns_without_changing_active_lifecycle(tmp_path: Path) -> None:
    manuscript = tmp_path / "正文"
    manuscript.mkdir()
    source = manuscript / "第001章.md"
    source.write_text("天枢架固定在祭坛中央。", encoding="utf-8")
    source_hash = f"sha256:{hashlib.sha256(source.read_bytes()).hexdigest()}"
    title = "天枢架"
    claim = "天枢架不能移动。"
    entry = KnowledgeEntry(
        id="pk_550e8400-e29b-41d4-a716-446655440021",
        status="active",
        kind="world_rule",
        evidence_state="current",
        title=title,
        claim=claim,
        sources=(
            KnowledgeSource(
                type="project_file",
                path="正文/第001章.md",
                content_sha256=source_hash,
            ),
        ),
        claim_fingerprint=knowledge_claim_fingerprint(title, claim),
        created_at="2026-08-03T10:00:00Z",
        updated_at="2026-08-03T10:00:00Z",
    )
    setting = tmp_path / "设定"
    setting.mkdir()
    (setting / "天枢.md").write_text(render_knowledge_entry(entry), encoding="utf-8")
    source.write_text("作者修改了证据原文。", encoding="utf-8")

    result = retrieve_project_knowledge(str(tmp_path), query="天枢架")

    assert len(result.items) == 1
    assert result.items[0].entry.status == "active"
    assert result.items[0].evidence_state == "stale"
    assert any("evidence stale" in warning for warning in result.warnings)
    persisted = (setting / "天枢.md").read_text(encoding="utf-8")
    assert '"status":"active"' in persisted
    assert '"evidence_state":"current"' in persisted


def test_excluded_entry_is_not_retrieved_or_raw_injected(tmp_path: Path) -> None:
    setting = tmp_path / "设定"
    setting.mkdir()
    excluded = _entry(suffix=31, title="天枢架", claim="EXCLUDED_KNOWLEDGE_SENTINEL")
    path = setting / "天枢.md"
    path.write_text(render_knowledge_entry(excluded), encoding="utf-8")

    result = retrieve_project_knowledge(
        str(tmp_path),
        query="天枢架",
        pinned_paths=["设定/天枢.md"],
        excluded_ids=[excluded.id],
    )
    assert result.items == ()
    assert result.structured_paths == ("设定/天枢.md",)

    snapshot = build_llm_context_snapshot(
        run_state=None,
        intent="file.revise",
        user_message="重写天枢架场景",
        file_path="正文/第002章.md",
        content="",
        context_bundle={
            "project_root": str(tmp_path),
            "files": [
                {
                    "relative_path": "设定/天枢.md",
                    "kind": "knowledge",
                    "title": "天枢",
                    "excerpt": path.read_text(encoding="utf-8"),
                }
            ],
            "knowledge_exclusions": {"ids": [excluded.id]},
        },
    )
    prompt = str(llm_context_snapshot_to_prompt_context_bundle(snapshot))
    assert "EXCLUDED_KNOWLEDGE_SENTINEL" not in prompt
    assert llm_context_snapshot_trace_summary(snapshot)["knowledge_entries"] == []
